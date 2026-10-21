// Live SMTP check for the order emails: renders every dealer and staff email from
// made-up order data and sends each to ONE address given on the command line,
// passing only if the mail server accepts it (SMTP 250).
// It never reads recipients from the database - DATABASE_URL is blanked before
// anything loads - so no real dealer or staff member can be emailed.
//
//   node -r dotenv/config scripts/verify-order-emails.mjs you@example.com
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const to = process.argv[2]?.trim();
if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
  console.error("Usage: node -r dotenv/config scripts/verify-order-emails.mjs <test address>");
  process.exit(2);
}
process.env.DATABASE_URL = "";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": path.join(ROOT, "src") } });
const { renderDealerEmail, renderStaffEmail } = await jiti.import(path.join(ROOT, "src/server/notify/dealer-email.ts"));
const { sendEmail } = await jiti.import(path.join(ROOT, "src/server/auth/email.ts"));

const link = `${(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "")}/orders/1`;
const order = { orderNumber: "OM/26-27/TEST-0001", dealerName: "Test Dealer", amountPaise: 1234550, link };
const shipment = { dispatchPartner: "BlueDart", trackingNumber: "AWB123456", trackingLink: "https://www.bluedart.com/" };

const emails = [
  ["staff rsm_review", renderStaffEmail("rsm_review", order)],
  ["staff staff_accept", renderStaffEmail("staff_accept", order)],
  ["staff cancel_request", renderStaffEmail("cancel_request", { ...order, note: "Ordered the wrong items" })],
  ["staff edit_request", renderStaffEmail("edit_request", { ...order, note: "Please add 10 more beakers" })],
  ...[
    { kind: "placed" },
    { kind: "accepted", note: "Will ship this week." },
    { kind: "declined", note: "Item 3 is discontinued." },
    { kind: "dispatched", full: false, shipment },
    { kind: "dispatched", full: true, shipment },
    { kind: "cancelled", reason: "Requested by dealer" },
    { kind: "discount_rejected", requestId: "42", note: "Discount above limit", partial: true },
  ].map((event) => [`dealer ${event.kind}${event.full === undefined ? "" : event.full ? " full" : " partial"}`, renderDealerEmail(event, { businessName: order.dealerName, orderNumber: order.orderNumber, link })]),
];

let failed = 0;
for (const [label, { subject, html }] of emails) {
  try {
    const info = await sendEmail(to, `[TEST] ${subject}`, html);
    const ok = info.accepted?.includes(to) && !info.rejected?.length && String(info.response).startsWith("250");
    if (!ok) failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(26)} ${info.response}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${label.padEnd(26)} ${error.message}`);
  }
}
console.log(`\n${emails.length - failed}/${emails.length} accepted by the mail server for ${to}`);
process.exit(failed ? 1 : 0);
