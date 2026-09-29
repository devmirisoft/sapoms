import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const source = await fs.readFile(path.resolve("src/lib/missedActivity.ts"), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { buildMissedActivity } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const since = new Date("2026-09-01T10:00:00Z");
const until = new Date("2026-09-02T10:00:00Z");
const inside = new Date("2026-09-01T12:00:00Z");
const before = new Date("2026-09-01T09:00:00Z");
const order = (patch) => ({
  id: "1", orderNumber: "ORD-1", dealerName: "Acme Labs", createdAt: before,
  rsmApprovalStatus: "AWAITING", rsmReviewedAt: null, rsmReviewedByName: null,
  acceptanceStatus: "AWAITING", acceptanceReviewedAt: null, acceptanceReviewedByName: null,
  dispatchedAt: null, ...patch,
});

test("each role only hears its own hop of the order flow, inside the logged-out window", () => {
  const orders = [
    order({ id: "1", createdAt: inside }),
    order({ id: "2", createdAt: before, rsmApprovalStatus: "ACCEPTED", rsmReviewedAt: inside, rsmReviewedByName: "Ravi" }),
    order({ id: "3", acceptanceStatus: "DECLINED", acceptanceReviewedAt: inside, dispatchedAt: until }),
    order({ id: "4", createdAt: until }),
    order({ id: "5", rsmApprovalStatus: "ACCEPTED", rsmReviewedAt: before, dispatchedAt: before }),
  ];

  assert.deepEqual(buildMissedActivity("RSM", orders, since, until).map((i) => i.orderId), ["4", "1"]);

  const staff = buildMissedActivity("STAFF", orders, since, until);
  assert.deepEqual(staff.map((i) => [i.orderId, i.type, i.description]), [["2", "success", "Ravi · Acme Labs"]]);

  const dealer = buildMissedActivity("DEALER", orders, since, until);
  assert.deepEqual(dealer.map((i) => [i.orderId, i.type, i.title]), [
    ["3", "success", "Order ORD-1 dispatched"],
    ["3", "error", "Order ORD-1 declined"],
  ]);

  assert.deepEqual(buildMissedActivity("ADMIN", orders, since, until), []);
});
