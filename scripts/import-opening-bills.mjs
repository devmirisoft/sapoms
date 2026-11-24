// Loads the accountant's "Balance Amount Dealer list" (unpaid bills as of
// 31 Oct) as ledger bills, one per sheet row, so each bill runs its own
// credit-days clock. Dry run unless --apply; re-running skips bills already
// saved (same dealer + bill number).
//
//   DATABASE_URL=... node scripts/import-opening-bills.mjs "docs/Balance Amount Dealer list.xlsx" [--dealer "MODERN SCIENTIFIC STORE"] [--apply]
import { createRequire } from "node:module";
import { PrismaClient } from "./prisma.mjs";

const XLSX = createRequire(import.meta.url)("xlsx");
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const file = args[0];
const onlyDealer = flag("--dealer");
const apply = args.includes("--apply");
if (!file || file.startsWith("--")) throw new Error("Usage: import-opening-bills.mjs <xlsx> [--dealer <name>] [--apply]");

const CUTOFF = Date.UTC(2026, 9, 31); // the sheet's "31 OCT BAL"
const DAY = 86_400_000;
// Undated "25-26 opening diff" rows are carried over from FY 2025-26; dated its last day.
const FY_END = new Date(Date.UTC(2026, 2, 31));
// Typo in the sheet: CAMBAY bill 4108 (bill 4107 is 10 Oct 2026).
const DATE_FIXES = { "10/10/20264": "10/10/2026" };
const norm = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const iso = (d) => d.toISOString().slice(0, 10);
// Dealers the accounts team said to leave out of the opening balance.
const IGNORED = new Set(["SV Scientific Mujaffarnagar", "MODERN SCIENTIFIC STORE"].map(norm));

// Date cells arrive as Excel serials (no timezone); a few were typed as text, and
// their neighbouring bill numbers show those are dd/mm/yyyy.
function billDate(cell) {
  if (typeof cell === "number") return new Date(Date.UTC(1970, 0, 1) + (Math.floor(cell) - 25569) * DAY);
  const text = String(cell ?? "").trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(DATE_FIXES[text] ?? text);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return d.getUTCDate() === +m[1] ? d : null;
}

function parseSheet() {
  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  const dealers = [];
  for (const [, name, city, gst, bal, billNo, date, amt] of rows.slice(1)) {
    if (name && String(name).trim()) {
      const s = String(bal ?? "").trim().toUpperCase();
      const balance = s === "" ? null : s === "NIL" ? 0 : Number(s.replace("CR", "").trim()) * (s.endsWith("CR") ? -1 : 1);
      dealers.push({ name: String(name).trim(), city: String(city ?? ""), gst: gst ? String(gst).trim().toUpperCase() : null, balance, bills: [] });
    }
    if (billNo === null && amt === null) continue;
    const bill = { billNo: billNo === null ? "" : String(billNo).trim().slice(0, 60), rawDate: date, date: billDate(date), amount: Number(amt) };
    if (!bill.date && /DIFF/i.test(bill.billNo) && bill.amount > 0) Object.assign(bill, { date: FY_END, opening: true });
    // Same bill number on the same date is one invoice split over two lines.
    const twin = dealers.at(-1).bills.find((b) => b.billNo && b.billNo === bill.billNo && b.date?.getTime() === bill.date?.getTime());
    if (twin) Object.assign(twin, { amount: twin.amount + bill.amount, merged: true });
    else dealers.at(-1).bills.push(bill);
  }
  return dealers;
}

async function findDealer(prisma, row) {
  const select = { id: true, businessName: true, city: true, gstin: true, creditDays: true, deletedAt: true, user: { select: { status: true } } };
  let found = row.gst ? await prisma.dealerProfile.findMany({ where: { gstin: { equals: row.gst, mode: "insensitive" } }, select }) : [];
  if (found.length === 0) found = (await prisma.dealerProfile.findMany({ select })).filter((d) => norm(d.businessName) === norm(row.name));
  if (found.length > 1) found = found.filter((d) => !d.deletedAt);
  // Branches sharing one GST (SRIKAAR Hyderabad / Vizag): the sheet's city decides.
  if (found.length > 1) found = found.filter((d) => norm(d.city).includes(norm(row.city)));
  return found.length === 1 ? found[0] : { error: found.length ? `${found.length} dealers match` : "no dealer matches" };
}

const prisma = new PrismaClient();
const target = new URL(process.env.DATABASE_URL);
console.log(`${apply ? "APPLY" : "DRY RUN"} -> ${target.hostname}${target.pathname}\n`);

let inserted = 0, problems = 0;
try {
  for (const row of parseSheet()) {
    if (onlyDealer && norm(row.name) !== norm(onlyDealer)) continue;
    if (IGNORED.has(norm(row.name))) { console.log(`${row.name}: ignored, as the accounts team asked\n`); continue; }
    if (row.bills.length === 0) {
      if (row.balance > 0) { problems++; console.log(`!! ${row.name}: balance ${row.balance} has no bills listed\n`); }
      continue;
    }

    const dealer = await findDealer(prisma, row);
    if (dealer.error) { problems++; console.log(`!! ${row.name}: ${dealer.error}\n`); continue; }
    const total = row.bills.reduce((t, b) => t + (b.amount || 0), 0);
    console.log(`${row.name} -> dealer ${dealer.id} "${dealer.businessName}"${dealer.deletedAt ? " [deleted]" : ""} login ${dealer.user?.status}, credit days ${dealer.creditDays ?? "none"}`);
    if (row.balance !== null && Math.abs(total - row.balance) > 1) console.log(`   note: sheet balance ${row.balance} != bills total ${total}`);

    const existing = new Set((await prisma.ledgerBill.findMany({ where: { dealerId: dealer.id }, select: { billNumber: true } })).map((b) => b.billNumber));
    const seen = new Set();
    const toCreate = [];
    for (const b of row.bills) {
      const where = `   bill ${b.billNo || "(none)"} ${b.rawDate ?? "(no date)"} Rs ${b.amount}${b.merged ? " (2 lines merged)" : ""}${b.opening ? " (FY 25-26 diff, dated 31 Mar)" : ""}`;
      const problem =
        !/^\d+$/.test(b.billNo) && !b.opening ? "not a bill number" :
        !b.date ? "unreadable date" :
        b.date.getTime() > CUTOFF ? `dated ${iso(b.date)}, after 31 Oct` :
        !(b.amount > 0) ? "no amount" :
        seen.has(b.billNo) ? "bill number repeated in sheet" : null;
      seen.add(b.billNo);
      if (problem) { problems++; console.log(`${where}  !! SKIP: ${problem}`); continue; }
      if (existing.has(b.billNo)) { console.log(`${where}  already saved, skip`); continue; }
      const due = dealer.creditDays === null ? null : new Date(b.date.getTime() + dealer.creditDays * DAY);
      const state = !due ? "no credit days" : due.getTime() < Date.now() ? `due ${iso(due)} OVERDUE` : `due ${iso(due)}`;
      console.log(`${where} -> ${iso(b.date)} ${state}`);
      toCreate.push({ dealerId: dealer.id, orderNumber: "", billNumber: b.billNo, billDate: b.date, billAmountPaise: BigInt(Math.round(b.amount * 100)) });
    }

    if (apply && toCreate.length) {
      await prisma.$transaction(toCreate.map((data) => prisma.ledgerBill.create({ data })));
      inserted += toCreate.length;
      console.log(`   saved ${toCreate.length} bill(s)`);
    }
    console.log();
  }
} finally {
  await prisma.$disconnect();
}
console.log(`${apply ? `inserted ${inserted}` : "nothing written"}; ${problems} row(s) need fixing in the sheet`);
