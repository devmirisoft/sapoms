import test from "node:test";
import assert from "node:assert/strict";

/*
 * The accountant's funding step, exercised against an in-memory stand-in for
 * the pieces it touches: the wallet ledger, the order table's unique
 * idempotency key, and the fund request row.
 *
 * What is being pinned down here is the part no unit test of the state machine
 * can reach — that crediting the wallet, placing the order, and marking the
 * request done cannot half-happen or happen twice.
 */

/* ── In-memory doubles ────────────────────────────────────────────────────── */

function createDb() {
  return {
    wallet: { status: "ACTIVE", balancePaise: 0, reservedPaise: 0 },
    walletTransactions: [],
    orders: [],
    request: null,
  };
}

/* Mirrors applyWalletChange: an idempotency key that has already been used
   returns the earlier transaction instead of moving money a second time. */
function applyWalletChange(db, type, amountPaise, { idempotencyKey }) {
  if (idempotencyKey) {
    const existing = db.walletTransactions.find((t) => t.idempotencyKey === idempotencyKey);
    if (existing) return { duplicate: true, transaction: existing };
  }
  const credit = type === "CREDIT" || type === "REFUND";
  const next = db.wallet.balancePaise + (credit ? amountPaise : -amountPaise);
  if (next < 0) {
    throw Object.assign(new Error("Insufficient wallet balance"), { status: 409, code: "insufficient_balance" });
  }
  const transaction = {
    id: String(db.walletTransactions.length + 1),
    type,
    amountPaise,
    balanceBeforePaise: db.wallet.balancePaise,
    balanceAfterPaise: next,
    idempotencyKey: idempotencyKey ?? null,
  };
  db.wallet.balancePaise = next;
  db.walletTransactions.push(transaction);
  return { duplicate: false, transaction };
}

/* Mirrors order.idempotencyKey being UNIQUE in Postgres. */
function createOrder(db, { idempotencyKey, finalPayableAmountPaise }) {
  const existing = db.orders.find((o) => o.idempotencyKey === idempotencyKey);
  if (existing) return { order: existing, duplicate: true };
  const order = {
    id: db.orders.length + 1,
    orderNumber: `OM/26-27/DMS-${String(db.orders.length + 1).padStart(3, "0")}`,
    idempotencyKey,
    finalPayableAmountPaise,
    status: "AWAITING_ACCEPTANCE",
  };
  db.orders.push(order);
  return { order, duplicate: false };
}

const STAGE_REQUIRES = { rsm: "REQUESTED", staff: "RSM_APPROVED", accountant: "STAFF_APPROVED" };

function assertStageTransition(stage, current) {
  if (current === STAGE_REQUIRES[stage]) return;
  if (current === "REJECTED") throw Object.assign(new Error("rejected"), { code: "request_rejected" });
  throw Object.assign(new Error("wrong stage"), { code: current === "FUNDED" || current === "COMPLETED" ? "already_actioned" : "wrong_stage" });
}

/* The funding routine under test, matching PATCH /api/dealer-fund-requests/[id]
   with action=fund. Written as one function so a thrown error rolls the whole
   thing back the way the surrounding $transaction does. */
function fundRequest(db) {
  const snapshot = JSON.parse(JSON.stringify({ wallet: db.wallet, walletTransactions: db.walletTransactions, orders: db.orders, request: db.request }));
  try {
    const existing = db.request;
    assertStageTransition("accountant", existing.status);

    const credit = applyWalletChange(db, "CREDIT", existing.amountPaise, {
      idempotencyKey: `fund-request:${existing.id}`,
    });

    db.request = { ...existing, status: "FUNDED", walletTransactionId: credit.transaction.id, fundedAt: "now" };

    if (existing.type === "ADVANCE_ORDER" && existing.orderFormSnapshot && !existing.orderId) {
      const { order } = createOrder(db, {
        idempotencyKey: `fund-request-order:${existing.id}`,
        finalPayableAmountPaise: existing.orderAmountPaise,
      });
      // The real path debits through applyWalletChange inside createDealerOrder.
      applyWalletChange(db, "ORDER_DEBIT", existing.orderAmountPaise, {
        idempotencyKey: `fund-request-order:${existing.id}:wallet`,
      });
      db.request = { ...db.request, status: "COMPLETED", orderId: order.id, orderNumber: order.orderNumber };
      return { placedOrder: order };
    }

    if (existing.type === "ADDITIONAL_FUNDS") {
      db.request = { ...db.request, status: "COMPLETED" };
    }
    return { placedOrder: null };
  } catch (error) {
    // Roll back, as the enclosing transaction would.
    db.wallet = snapshot.wallet;
    db.walletTransactions = snapshot.walletTransactions;
    db.orders = snapshot.orders;
    db.request = snapshot.request;
    throw error;
  }
}

function advanceOrderRequest(overrides = {}) {
  return {
    id: 7,
    type: "ADVANCE_ORDER",
    status: "STAFF_APPROVED",
    amountPaise: 350_00,
    orderAmountPaise: 750_00,
    walletBalancePaise: 400_00,
    orderFormSnapshot: { productorder: "[{}]" },
    orderId: null,
    ...overrides,
  };
}

/* ── Funding an advance order ─────────────────────────────────────────────── */

test("funding credits the wallet, places the order, and completes the request", () => {
  const db = createDb();
  db.wallet.balancePaise = 400_00;
  db.request = advanceOrderRequest();

  const { placedOrder } = fundRequest(db);

  assert.ok(placedOrder, "an order should have been placed");
  assert.equal(db.request.status, "COMPLETED");
  assert.equal(db.request.orderId, placedOrder.id);
  // Credit of the shortfall, then the order debit: the wallet lands on zero.
  assert.equal(db.wallet.balancePaise, 0);
  assert.equal(db.walletTransactions.length, 2);
  assert.equal(db.walletTransactions[0].type, "CREDIT");
  assert.equal(db.walletTransactions[0].amountPaise, 350_00);
  assert.equal(db.walletTransactions[1].type, "ORDER_DEBIT");
  assert.equal(db.walletTransactions[1].amountPaise, 750_00);
});

test("the placed order is worth exactly the approved order amount", () => {
  const db = createDb();
  db.wallet.balancePaise = 400_00;
  db.request = advanceOrderRequest();

  const { placedOrder } = fundRequest(db);
  assert.equal(placedOrder.finalPayableAmountPaise, 750_00);
  assert.equal(placedOrder.status, "AWAITING_ACCEPTANCE");
});

/* ── Double-funding protection ────────────────────────────────────────────── */

test("a second fund call cannot credit the wallet or place a second order", () => {
  const db = createDb();
  db.wallet.balancePaise = 400_00;
  db.request = advanceOrderRequest();

  fundRequest(db);
  const balanceAfterFirst = db.wallet.balancePaise;
  const ordersAfterFirst = db.orders.length;
  const txnsAfterFirst = db.walletTransactions.length;

  assert.throws(() => fundRequest(db), (error) => {
    assert.equal(error.code, "already_actioned");
    return true;
  });

  assert.equal(db.wallet.balancePaise, balanceAfterFirst, "balance must not move again");
  assert.equal(db.orders.length, ordersAfterFirst, "no second order");
  assert.equal(db.walletTransactions.length, txnsAfterFirst, "no extra ledger rows");
});

test("even bypassing the stage guard, the idempotency keys prevent double money", () => {
  // Simulates two funding calls racing past the status check together: the
  // unique keys on the wallet transaction and the order are the real backstop.
  const db = createDb();
  db.wallet.balancePaise = 400_00;
  db.request = advanceOrderRequest();

  fundRequest(db);
  // Force the row back as if the second caller had read it before the update.
  db.request = { ...db.request, status: "STAFF_APPROVED", orderId: null };
  fundRequest(db);

  const credits = db.walletTransactions.filter((t) => t.type === "CREDIT");
  const debits = db.walletTransactions.filter((t) => t.type === "ORDER_DEBIT");
  assert.equal(credits.length, 1, "wallet credited exactly once");
  assert.equal(debits.length, 1, "order debited exactly once");
  assert.equal(db.orders.length, 1, "exactly one order exists");
  assert.equal(db.wallet.balancePaise, 0);
});

/* ── Ledger top-ups ───────────────────────────────────────────────────────── */

test("an additional-funds request completes with no order", () => {
  const db = createDb();
  db.wallet.balancePaise = 100_00;
  db.request = {
    id: 9,
    type: "ADDITIONAL_FUNDS",
    status: "STAFF_APPROVED",
    amountPaise: 500_00,
    orderAmountPaise: null,
    orderFormSnapshot: null,
    orderId: null,
  };

  const { placedOrder } = fundRequest(db);

  assert.equal(placedOrder, null, "a ledger top-up places no order");
  assert.equal(db.orders.length, 0);
  assert.equal(db.request.status, "COMPLETED");
  assert.equal(db.wallet.balancePaise, 600_00, "the funds stay in the wallet");
  assert.equal(db.walletTransactions.length, 1);
  assert.equal(db.walletTransactions[0].type, "CREDIT");
});

/* ── Nothing partially applies ────────────────────────────────────────────── */

test("a request that has not cleared both approvals moves no money", () => {
  for (const status of ["REQUESTED", "RSM_APPROVED", "REJECTED"]) {
    const db = createDb();
    db.wallet.balancePaise = 400_00;
    db.request = advanceOrderRequest({ status });

    assert.throws(() => fundRequest(db));

    assert.equal(db.wallet.balancePaise, 400_00, `${status}: balance untouched`);
    assert.equal(db.walletTransactions.length, 0, `${status}: no ledger rows`);
    assert.equal(db.orders.length, 0, `${status}: no order`);
    assert.equal(db.request.status, status, `${status}: request unchanged`);
  }
});

test("a failure during placement rolls back the credit too", () => {
  const db = createDb();
  db.wallet.balancePaise = 400_00;
  // An order larger than credit + balance: the debit fails, so the whole
  // funding attempt must leave nothing behind.
  db.request = advanceOrderRequest({ amountPaise: 100_00, orderAmountPaise: 750_00 });

  assert.throws(() => fundRequest(db), (error) => {
    assert.equal(error.code, "insufficient_balance");
    return true;
  });

  assert.equal(db.wallet.balancePaise, 400_00, "credit rolled back");
  assert.equal(db.walletTransactions.length, 0, "no ledger rows survive");
  assert.equal(db.orders.length, 0, "no order survives");
  assert.equal(db.request.status, "STAFF_APPROVED", "request stays awaiting funds");
});
