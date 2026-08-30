import test from "node:test";
import assert from "node:assert/strict";

/*
 * Workflow rules for the Advance Dealer Order / Fund Request flow.
 *
 * Mirrors src/lib/dealerFundRequests.ts. Kept as plain JS because the suite
 * runs straight through node:test with no TypeScript build step, matching the
 * other *.test.mjs files in this directory.
 */

const STAGE_REQUIRES = {
  rsm: "REQUESTED",
  staff: "RSM_APPROVED",
  accountant: "STAFF_APPROVED",
};

const STAGE_APPROVES_TO = {
  rsm: "RSM_APPROVED",
  staff: "STAFF_APPROVED",
  accountant: "FUNDED",
};

const TERMINAL_STATUSES = ["COMPLETED", "REJECTED"];

function assertStageTransition(stage, current) {
  const required = STAGE_REQUIRES[stage];
  if (current === required) return;

  const alreadyDone = {
    rsm: ["RSM_APPROVED", "STAFF_APPROVED", "FUNDED", "COMPLETED"],
    staff: ["STAFF_APPROVED", "FUNDED", "COMPLETED"],
    accountant: ["FUNDED", "COMPLETED"],
  };

  if (current === "REJECTED") {
    throw Object.assign(new Error("This request was rejected and can no longer be actioned."), { status: 409, code: "request_rejected" });
  }
  if (alreadyDone[stage]?.includes(current)) {
    throw Object.assign(new Error("This request has already been actioned at this stage."), { status: 409, code: "already_actioned" });
  }
  throw Object.assign(new Error("This request is not yet at this approval stage."), { status: 409, code: "wrong_stage" });
}

function dealerStatusLabel(status, type, rejectedBy) {
  switch (status) {
    case "REQUESTED": return "Awaiting RSM Approval";
    case "RSM_APPROVED": return "Awaiting Staff Approval";
    case "STAFF_APPROVED": return "Awaiting Accountant";
    case "FUNDED": return type === "ADVANCE_ORDER" ? "Funds Added - Placing Order" : "Funds Added";
    case "COMPLETED": return type === "ADVANCE_ORDER" ? "Order Placed" : "Completed";
    case "REJECTED": return rejectedBy ? `Rejected by ${rejectedBy}` : "Rejected";
    default: return String(status);
  }
}

function tabWhere(stage, tab) {
  const clearedThisStage = stage === "rsm"
    ? ["RSM_APPROVED", "STAFF_APPROVED", "FUNDED", "COMPLETED"]
    : ["STAFF_APPROVED", "FUNDED", "COMPLETED"];

  switch (tab) {
    case "mine": return { status: STAGE_REQUIRES[stage] };
    case "approved": return { status: { in: clearedThisStage } };
    case "rejected": return { status: "REJECTED", rejectedBy: stage === "rsm" ? "RSM" : "STAFF" };
    case "pending":
    default: return { status: { notIn: TERMINAL_STATUSES } };
  }
}

/* ── Ordering behaviour: which dealers see Request Funds at all ───────────── */

/* Mirrors the gate shared by the order route and the Add Order screen: only an
   ACTIVE wallet (an advance dealer) is ever balance-checked. */
function orderAction(wallet, orderAmount) {
  if (wallet?.status !== "ACTIVE") return "place";
  const available = wallet.balancePaise - wallet.reservedPaise;
  return available < orderAmount ? "request_funds" : "place";
}

test("credit dealer ordering is untouched by the wallet balance", () => {
  assert.equal(orderAction(null, 500_00), "place");
  assert.equal(orderAction({ status: "INACTIVE", balancePaise: 0, reservedPaise: 0 }, 500_00), "place");
});

test("advance dealer with enough balance still places the order directly", () => {
  const wallet = { status: "ACTIVE", balancePaise: 1000_00, reservedPaise: 0 };
  assert.equal(orderAction(wallet, 750_00), "place");
  // Exactly covered is still sufficient, not a shortfall.
  assert.equal(orderAction(wallet, 1000_00), "place");
});

test("advance dealer short of the order amount is sent to Request Funds", () => {
  const wallet = { status: "ACTIVE", balancePaise: 400_00, reservedPaise: 0 };
  assert.equal(orderAction(wallet, 750_00), "request_funds");
});

test("reserved funds count against availability", () => {
  const wallet = { status: "ACTIVE", balancePaise: 1000_00, reservedPaise: 400_00 };
  assert.equal(orderAction(wallet, 750_00), "request_funds");
});

/* ── The happy path, stage by stage ───────────────────────────────────────── */

test("a request walks RSM -> Staff -> Accountant in order", () => {
  let status = "REQUESTED";

  assertStageTransition("rsm", status);
  status = STAGE_APPROVES_TO.rsm;
  assert.equal(status, "RSM_APPROVED");

  assertStageTransition("staff", status);
  status = STAGE_APPROVES_TO.staff;
  assert.equal(status, "STAFF_APPROVED");

  assertStageTransition("accountant", status);
  status = STAGE_APPROVES_TO.accountant;
  assert.equal(status, "FUNDED");
});

/* ── Illegal transitions ──────────────────────────────────────────────────── */

test("staff cannot approve before the RSM has", () => {
  assert.throws(() => assertStageTransition("staff", "REQUESTED"), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.code, "wrong_stage");
    return true;
  });
});

test("the accountant cannot fund before both approvals", () => {
  for (const status of ["REQUESTED", "RSM_APPROVED"]) {
    assert.throws(() => assertStageTransition("accountant", status), (error) => {
      assert.equal(error.code, "wrong_stage");
      return true;
    }, `accountant must not act on ${status}`);
  }
});

test("REQUESTED can never jump straight to the accountant stage", () => {
  assert.throws(() => assertStageTransition("accountant", "REQUESTED"), /not yet at this approval stage/);
});

/* ── Rejection stops the chain ────────────────────────────────────────────── */

test("an RSM rejection never reaches Staff or the Accountant", () => {
  const status = "REJECTED";
  for (const stage of ["staff", "accountant"]) {
    assert.throws(() => assertStageTransition(stage, status), (error) => {
      assert.equal(error.code, "request_rejected");
      return true;
    });
  }
});

test("a Staff rejection never reaches the Accountant", () => {
  assert.throws(() => assertStageTransition("accountant", "REJECTED"), (error) => {
    assert.equal(error.code, "request_rejected");
    return true;
  });
});

/* ── Double-action protection ─────────────────────────────────────────────── */

test("no stage can approve the same request twice", () => {
  assert.throws(() => assertStageTransition("rsm", "RSM_APPROVED"), (error) => {
    assert.equal(error.code, "already_actioned");
    return true;
  });
  assert.throws(() => assertStageTransition("staff", "STAFF_APPROVED"), (error) => {
    assert.equal(error.code, "already_actioned");
    return true;
  });
  assert.throws(() => assertStageTransition("accountant", "FUNDED"), (error) => {
    assert.equal(error.code, "already_actioned");
    return true;
  });
});

test("a completed request is closed to every stage", () => {
  for (const stage of ["rsm", "staff", "accountant"]) {
    assert.throws(() => assertStageTransition(stage, "COMPLETED"), (error) => {
      assert.equal(error.code, "already_actioned");
      return true;
    });
  }
});

test("an earlier stage cannot re-approve once the request has moved on", () => {
  // The RSM revisiting a request already with the accountant must fail.
  assert.throws(() => assertStageTransition("rsm", "STAFF_APPROVED"), /already been actioned/);
});

/* ── Queue tabs ───────────────────────────────────────────────────────────── */

test("My Approvals shows only what that stage can action now", () => {
  assert.deepEqual(tabWhere("rsm", "mine"), { status: "REQUESTED" });
  assert.deepEqual(tabWhere("staff", "mine"), { status: "RSM_APPROVED" });
});

test("Pending excludes finished requests", () => {
  assert.deepEqual(tabWhere("rsm", "pending"), { status: { notIn: ["COMPLETED", "REJECTED"] } });
});

test("Approved covers every state past that stage, not just the next one", () => {
  // An RSM's approved tab must keep showing a request after Staff and the
  // Accountant have moved it further along.
  assert.deepEqual(tabWhere("rsm", "approved"), {
    status: { in: ["RSM_APPROVED", "STAFF_APPROVED", "FUNDED", "COMPLETED"] },
  });
  assert.deepEqual(tabWhere("staff", "approved"), {
    status: { in: ["STAFF_APPROVED", "FUNDED", "COMPLETED"] },
  });
});

test("each stage's Rejected tab shows only its own rejections", () => {
  assert.deepEqual(tabWhere("rsm", "rejected"), { status: "REJECTED", rejectedBy: "RSM" });
  assert.deepEqual(tabWhere("staff", "rejected"), { status: "REJECTED", rejectedBy: "STAFF" });
});

/* ── Dealer-facing wording ────────────────────────────────────────────────── */

test("the dealer sees where the request is without internal detail", () => {
  assert.equal(dealerStatusLabel("REQUESTED", "ADVANCE_ORDER"), "Awaiting RSM Approval");
  assert.equal(dealerStatusLabel("RSM_APPROVED", "ADVANCE_ORDER"), "Awaiting Staff Approval");
  assert.equal(dealerStatusLabel("STAFF_APPROVED", "ADVANCE_ORDER"), "Awaiting Accountant");
  assert.equal(dealerStatusLabel("COMPLETED", "ADVANCE_ORDER"), "Order Placed");
});

test("a ledger top-up completes without an order", () => {
  assert.equal(dealerStatusLabel("FUNDED", "ADDITIONAL_FUNDS"), "Funds Added");
  assert.equal(dealerStatusLabel("COMPLETED", "ADDITIONAL_FUNDS"), "Completed");
});

test("a rejection names the stage that stopped it", () => {
  assert.equal(dealerStatusLabel("REJECTED", "ADVANCE_ORDER", "RSM"), "Rejected by RSM");
  assert.equal(dealerStatusLabel("REJECTED", "ADVANCE_ORDER", "STAFF"), "Rejected by STAFF");
});

/* ── Shortfall arithmetic ─────────────────────────────────────────────────── */

/* The amount requested is the gap, not the whole order: the wallet balance
   already in hand is still spent on the order when it is placed. */
function shortfallPaise(orderAmountPaise, availablePaise) {
  return orderAmountPaise - availablePaise;
}

test("the requested amount is the shortfall, and funding exactly covers the order", () => {
  const orderAmount = 750_00;
  const available = 400_00;
  const requested = shortfallPaise(orderAmount, available);
  assert.equal(requested, 350_00);
  // After the accountant credits the shortfall, the order debit lands the
  // wallet on zero rather than overdrawing it.
  assert.equal(available + requested - orderAmount, 0);
});
