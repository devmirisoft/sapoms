import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

async function transpileToDataUrl(filePath, replacements = []) {
  let source = await fs.readFile(filePath, "utf8");
  for (const [from, to] of replacements) {
    source = source.replaceAll(from, to);
  }

  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  }).outputText;

  return `data:text/javascript;base64,${Buffer.from(transpiled, "utf8").toString("base64")}`;
}

async function loadDealerModules() {
  const dealerFormPath = path.resolve("src/lib/dealerForm.ts");
  const dealerFormUrl = await transpileToDataUrl(dealerFormPath);
  const dealerCodePath = path.resolve("src/lib/dealerCode.ts");
  const dealerCodeUrl = await transpileToDataUrl(dealerCodePath);
  const dealerRequestsPath = path.resolve("src/lib/dealerRequests.ts");
  const dealerRequestsUrl = await transpileToDataUrl(dealerRequestsPath, [
    ["@/lib/dealerForm", dealerFormUrl],
  ]);

  return {
    dealerCode: await import(dealerCodeUrl),
    dealerForm: await import(dealerFormUrl),
    dealerRequests: await import(dealerRequestsUrl),
  };
}

const { dealerCode, dealerForm, dealerRequests } = await loadDealerModules();

const snapshot = {
  name: "North Labs",
  email: "dealer@example.com",
  whatsapp: "9876543210",
  city: "Delhi",
  address: "Industrial Area",
  pincode: "110001",
  dealerCode: "1234",
  username: "northlabs",
  password: "secret123",
  gstNo: "07ABCDE1234F1Z5",
  discount: "12",
  creditDays: "30",
  annualTarget: "500000",
  currentLimit: "100000",
  notes: "Priority onboarding",
  assignedStaffIds: ["7", "11"],
  staffNames: "Aman,Neha",
};

test("dealer form validation keeps staff assignment and required fields intact", () => {
  assert.equal(dealerForm.validateDealerFormSnapshot(snapshot), null);
  assert.equal(
    dealerForm.validateDealerFormSnapshot({ ...snapshot, assignedStaffIds: [] }),
    "Please assign at least one staff member",
  );
  assert.equal(
    dealerForm.validateDealerFormSnapshot({ ...snapshot, email: "bad-email" }),
    "Enter a valid email address",
  );
  assert.equal(
    dealerForm.validateDealerFormSnapshot({ ...snapshot, dealerCode: "DLR-42" }),
    "Dealer code must be a unique 4-digit number",
  );
});

test("dealer code generator returns an unused 4-digit number", () => {
  assert.equal(dealerCode.isFourDigitDealerCode("1234"), true);
  assert.equal(dealerCode.isFourDigitDealerCode("DLR-42"), false);
  assert.deepEqual(
    Array.from(dealerCode.collectDealerCodes([
      { Dealer_Dealercode: "1234" },
      { formSnapshot: { dealerCode: "5678" } },
    ])).sort(),
    ["1234", "5678"],
  );
  assert.equal(
    dealerCode.generateUniqueFourDigitDealerCode(["1000", "1001"], () => 0),
    "1002",
  );
});

test("dealer PHP payload preserves the existing backend field names", () => {
  const formData = dealerForm.buildDealerPhpFormData(snapshot);
  const entries = Object.fromEntries(Array.from(formData.entries()));

  assert.equal(entries.Dealer_Name, "North Labs");
  assert.equal(entries.Dealer_Email, "dealer@example.com");
  assert.equal(entries.Dealer_Dealercode, "1234");
  assert.equal(entries.Dealer_Username, "northlabs");
  assert.equal(entries.Dealer_Password, "secret123");
  assert.equal(entries.assignedstaff, "7,11");
  assert.equal(entries.staffname, "Aman,Neha");
});

test("new dealer requests retain the full form snapshot and open-request identity", () => {
  const doc = dealerRequests.buildDealerRequestCreateDocument({
    actor: {
      role: "staff",
      actorId: "17",
      actorName: "Manpreet",
      roletype: "1",
    },
    snapshot,
    now: "2026-07-13T10:00:00.000Z",
  });

  assert.equal(doc.status, "pending");
  assert.equal(doc.dealerName, "North Labs");
  assert.equal(doc.formSnapshot.password, "secret123");
  assert.equal(doc.openRequestKey, dealerRequests.buildDealerRequestIdentityKey(snapshot, "17"));
  assert.equal(doc.auditTrail[0].action, "submitted");

  const secondaryContactDoc = dealerRequests.buildDealerRequestCreateDocument({
    actor: {
      role: "staff",
      actorId: "17",
      actorName: "Manpreet",
      roletype: "1",
    },
    snapshot: {
      ...snapshot,
      contactPerson: "secondary",
      secondaryContactName: "Operations Desk",
      secondaryContactPhone: "9123456789",
      secondaryContactEmail: "ops@example.com",
    },
    now: "2026-07-13T10:00:00.000Z",
  });

  assert.equal(secondaryContactDoc.contactEmail, "ops@example.com");
  assert.equal(secondaryContactDoc.contactPhone, "9123456789");
});

test("request list rows hide the full form snapshot while detail rows retain it", () => {
  const record = {
    _id: { toString: () => "6872fbc0f3d9cf7d7a000123" },
    status: "rejected",
    dealerName: "North Labs",
    dealerCode: "1234",
    city: "Delhi",
    contactEmail: "dealer@example.com",
    contactPhone: "9876543210",
    assignedStaffIds: ["7"],
    assignedStaffNames: "Aman",
    submittedById: "17",
    submittedByName: "Manpreet",
    reviewedById: "admin-1",
    reviewedByName: "Admin",
    rejectionReason: "Dealer code is already reserved.",
    lastRejectionReason: "Dealer code is already reserved.",
    formSnapshot: snapshot,
    submittedAt: "2026-07-13T10:00:00.000Z",
    rejectedAt: "2026-07-13T11:00:00.000Z",
    createdAt: "2026-07-13T10:00:00.000Z",
    updatedAt: "2026-07-13T11:00:00.000Z",
    auditTrail: [],
  };

  const listItem = dealerRequests.toDealerRequestListItem(record);
  const detailItem = dealerRequests.toDealerRequestDetail(record);

  assert.equal("formSnapshot" in listItem, false);
  assert.equal(detailItem.formSnapshot.password, "secret123");
  assert.equal(listItem.requestReference, "DLR-7A000123");
});

test("status transitions enforce pending accept/reject and rejected resubmission only", () => {
  assert.equal(dealerRequests.ensureStatusTransition("pending", "accept"), null);
  assert.equal(dealerRequests.ensureStatusTransition("pending", "reject"), null);
  assert.equal(dealerRequests.ensureStatusTransition("rejected", "resubmit"), null);
  assert.equal(
    dealerRequests.ensureStatusTransition("accepted", "reject"),
    "Only pending requests can be rejected",
  );
  assert.equal(
    dealerRequests.ensureStatusTransition("pending", "resubmit"),
    "Only rejected requests can be resubmitted",
  );
});

test("source files keep the approval workflow on the shared dealer form and guarded API", async () => {
  const [formPageSource, formCardSource, listApiSource, detailApiSource, managementSource] = await Promise.all([
    fs.readFile(path.resolve("src/app/dashboard/admin/dealer/AddDealerForm/page.tsx"), "utf8"),
    fs.readFile(path.resolve("src/components/dealers/DealerFormCard.tsx"), "utf8"),
    fs.readFile(path.resolve("src/app/api/dealer-requests/route.ts"), "utf8"),
    fs.readFile(path.resolve("src/app/api/dealer-requests/[id]/route.ts"), "utf8"),
    fs.readFile(path.resolve("src/components/dealers/DealerRequestManagement.tsx"), "utf8"),
  ]);

  assert.match(formCardSource, /Send for Approval/);
  assert.match(formCardSource, /Accept Request/);
  assert.match(formPageSource, /Reject Request/);
  assert.match(formCardSource, /Resubmit for Approval/);
  assert.match(formPageSource, /\/api\/dealer-requests/);

  assert.match(listApiSource, /openRequestKey/);
  assert.match(listApiSource, /requireAuth\(\)/);
  assert.match(listApiSource, /isStaffLike\(authActor\)/);
  assert.match(listApiSource, /Only staff-like roles can submit dealer approval requests/);
  assert.doesNotMatch(listApiSource, /resolveDealerRequestActor\(\{[\s\S]*headers:/);

  assert.match(detailApiSource, /prisma\.\$transaction/);
  assert.match(detailApiSource, /createAdminDealer\(dealerInput, adminActor, tx\)/);
  assert.match(detailApiSource, /createdDealerId: createdDealer\.id/);
  assert.match(detailApiSource, /TransactionIsolationLevel\.Serializable/);
  assert.match(detailApiSource, /Rejection reason is required/);

  assert.match(managementSource, /Pending Approval/);
  assert.match(managementSource, /Accepted Dealers/);
  assert.match(managementSource, /Rejected Dealers/);
});

test("dealer-request acceptance route is PostgreSQL-only", async () => {
  const [detailApiSource, dealerRepositorySource] = await Promise.all([
    fs.readFile(path.resolve("src/app/api/dealer-requests/[id]/route.ts"), "utf8"),
    fs.readFile(path.resolve("src/server/modules/admin/dealers/dealers.repository.ts"), "utf8"),
  ]);
  const combined = `${detailApiSource}\n${dealerRepositorySource}`;

  for (const required of [
    /parseCreateAdminDealerInput/,
    /createAdminDealer\(dealerInput, adminActor, tx\)/,
    /tx\.user\.findUnique/,
    /tx\.dealerProfile\.findUnique/,
    /hashPassword/,
    /dealerStaffAssignment\.createMany/,
    /tx\.dealerRequest\.update/,
    /createdDealerId: createdDealer\.id/,
    /reviewedById: actor\.actorId/,
    /acceptedAt: now/,
  ]) {
    assert.match(combined, required);
  }

  for (const forbidden of [
    "lookupExistingDealer",
    "submitDealerDirect",
    "resolveCreatedDealerId",
    "dealerpegination",
    "formdata1",
    "php-compat",
    "@/lib/mongodb",
    "getDb",
    "mongodb",
    "MongoDB",
  ]) {
    assert.equal(detailApiSource.includes(forbidden), false, forbidden);
  }
});
