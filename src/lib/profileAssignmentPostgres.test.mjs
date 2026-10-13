import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const dealerProfileRoute = read("src/app/api/dealer/profile/route.ts");
const staffProfileRoute = read("src/app/api/staff/profile/route.ts");
const staffDealersRoute = read("src/app/api/staff/dealers/route.ts");
const staffDealerDetailRoute = read("src/app/api/staff/dealers/[dealerId]/route.ts");
const targetPages = [
  "src/app/dashboard/dealer/profile/page.tsx",
  "src/app/dashboard/staff/profile/page.tsx",
  "src/app/dashboard/staff/page.tsx",
  "src/app/dashboard/staff/dealerlist/page.tsx",
  "src/app/dashboard/staff/dealer/[id]/page.tsx",
].map(read).join("\n");

test("dealer profile route is own-profile only and session authorized", () => {
  assert.match(dealerProfileRoute, /requireAuth()/);
  assert.match(dealerProfileRoute, /actor.role !== "DEALER"/);
  assert.match(dealerProfileRoute, /actor.dealerId/);
  assert.match(dealerProfileRoute, /where: { id: actor.dealerId }/);
  assert.match(dealerProfileRoute, /hashPassword/);
  assert.doesNotMatch(dealerProfileRoute, /php-compat|getdealer|dealerinfo|updateDealer|actorFromRequestHeaders|x-omsons-actor/i);
});

test("staff profile route is own-profile only and session authorized", () => {
  assert.match(staffProfileRoute, /requireAuth()/);
  assert.match(staffProfileRoute, /!\["STAFF", "RSM"\]\.includes\(actor\.role\)/);
  assert.match(staffProfileRoute, /actor.staffId/);
  assert.match(staffProfileRoute, /where: { id: actor.staffId }/);
  assert.match(staffProfileRoute, /hashPassword/);
  assert.doesNotMatch(staffProfileRoute, /php-compat|getstaff|staffinfo|staffUpdate|actorFromRequestHeaders|x-omsons-actor/i);
});

test("staff dealer APIs enforce active assignments", () => {
  assert.match(staffDealersRoute, /requireAuth()/);
  assert.match(staffDealersRoute, /staffId: actor.staffId/);
  assert.match(staffDealersRoute, /active: true/);
  assert.match(staffDealersRoute, /removedAt: null/);
  assert.match(staffDealersRoute, /user: { status: "ACTIVE" }/);
  assert.ok(staffDealerDetailRoute.includes("dealerId: BigInt(dealerId)"));
  assert.match(staffDealerDetailRoute, /staffId: actor.staffId/);
  assert.match(staffDealerDetailRoute, /Dealer not assigned to this staff account/);
  assert.doesNotMatch(staffDealersRoute + staffDealerDetailRoute, /php-compat|staffDealers|getdealer|dealerpegination|actorFromRequestHeaders|x-omsons-actor/i);
});

test("profile and staff dealer pages use migrated APIs and no PHP profile calls", () => {
  assert.ok(targetPages.includes("/api/dealer/profile"));
  assert.ok(targetPages.includes("/api/staff/profile"));
  assert.ok(targetPages.includes("/api/staff/dealers"));
  assert.doesNotMatch(targetPages, /php-compat|getdealer|dealerinfo|updateDealer|staffDealers|getstaff|staffinfo|staffUpdate|dealerpegination/);
});

test("legacy UI aliases are preserved", () => {
  const aliases = read("src/server/modules/profiles/profile-aliases.ts");
  for (const alias of ["Dealer_Id", "Dealer_Name", "Dealer_Email", "Dealer_Number", "staffname", "staff_id", "staff_name"]) {
    assert.match(aliases, new RegExp(alias));
  }
});

test("staff dealer list resolves staff access from the current-user session", () => {
  const staffDealerListPage = read("src/app/dashboard/staff/dealerlist/page.tsx");
  assert.match(staffDealerListPage, /getCurrentSession\(\)/);
  assert.match(staffDealerListPage, /auth\.role !== "staff"/);
  assert.doesNotMatch(staffDealerListPage, /localStorage/);
});
