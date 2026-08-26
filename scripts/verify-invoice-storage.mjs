// Deployment check for the Cloudinary invoice/export migration.
// Verifies the new tables exist, the duplicate-billing guard actually fires,
// and the foreign keys are wired. Cleans up everything it creates.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

let createdIds = { invoice: [], export: [] };

try {
  // 1. Tables reachable through the generated client.
  const invCount = await prisma.invoice.count();
  const expCount = await prisma.orderExport.count();
  check("invoices table queryable", true, `${invCount} rows`);
  check("order_exports table queryable", true, `${expCount} rows`);

  // 2. Columns match the Prisma model (a drifted migration fails here).
  const cols = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'invoices' ORDER BY column_name`;
  const names = cols.map((c) => c.column_name);
  const expected = [
    "buyer_name", "cloudinary_public_id", "cloudinary_url", "created_at",
    "created_by_user_id", "dealer_id", "deleted_at", "file_bytes", "file_name",
    "id", "invoice_date", "invoice_number", "order_id", "order_number",
    "total_amount_paise", "updated_at",
  ];
  const missing = expected.filter((c) => !names.includes(c));
  check("invoices columns complete", missing.length === 0, missing.length ? `missing ${missing}` : `${names.length} columns`);

  // 3. Need a real dealer to satisfy the FK.
  const dealer = await prisma.dealerProfile.findFirst({ select: { id: true, businessName: true } });
  if (!dealer) {
    check("dealer available for FK test", false, "no dealer rows — skipping write tests");
  } else {
    check("dealer available for FK test", true, dealer.businessName);

    const marker = `ZZ-DEPLOYCHECK-${Date.now()}`;
    const base = {
      dealerId: dealer.id,
      invoiceNumber: marker,
      orderNumber: marker,
      buyerName: "Deployment Check",
      invoiceDate: new Date("2026-08-26T00:00:00.000Z"),
      totalAmountPaise: 12345n,
      cloudinaryUrl: "https://res.cloudinary.com/demo/raw/upload/deploycheck",
      cloudinaryPublicId: "sapoms/invoices/deploycheck",
      fileName: `${marker}.pdf`,
    };

    const created = await prisma.invoice.create({ data: base, select: { id: true, totalAmountPaise: true } });
    createdIds.invoice.push(created.id);
    check("invoice insert works", created.totalAmountPaise === 12345n, `id ${created.id}`);

    // 4. The unique index is what stops concurrent double-billing.
    let duplicateBlocked = false;
    let code = "";
    try {
      const dup = await prisma.invoice.create({ data: base, select: { id: true } });
      createdIds.invoice.push(dup.id);
    } catch (e) {
      duplicateBlocked = e.code === "P2002";
      code = e.code;
    }
    check("duplicate invoice number rejected", duplicateBlocked, `error code ${code || "none"}`);

    // 5. FK must reject a dealer that does not exist.
    let fkEnforced = false;
    try {
      const bad = await prisma.invoice.create({
        data: { ...base, invoiceNumber: `${marker}-FK`, dealerId: 999999999n },
        select: { id: true },
      });
      createdIds.invoice.push(bad.id);
    } catch (e) {
      fkEnforced = e.code === "P2003";
    }
    check("dealer foreign key enforced", fkEnforced);

    // 6. Order export round-trip.
    const exp = await prisma.orderExport.create({
      data: {
        dealerId: dealer.id,
        fileName: `${marker}.pdf`,
        cloudinaryUrl: "https://res.cloudinary.com/demo/raw/upload/deploycheck-export",
        cloudinaryPublicId: "sapoms/order-exports/deploycheck",
        orderCount: 7,
      },
      select: { id: true, orderCount: true },
    });
    createdIds.export.push(exp.id);
    check("order export insert works", exp.orderCount === 7, `id ${exp.id}`);

    // 7. Soft delete must hide the row from the active-list filter.
    await prisma.invoice.update({ where: { id: created.id }, data: { deletedAt: new Date() } });
    const stillListed = await prisma.invoice.findFirst({
      where: { id: created.id, deletedAt: null }, select: { id: true },
    });
    check("soft delete hides invoice from active list", stillListed === null);
  }
} catch (error) {
  check("unexpected failure", false, error.message);
} finally {
  // Remove everything this script created.
  if (createdIds.invoice.length) await prisma.invoice.deleteMany({ where: { id: { in: createdIds.invoice } } });
  if (createdIds.export.length) await prisma.orderExport.deleteMany({ where: { id: { in: createdIds.export } } });
  await prisma.$disconnect();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
