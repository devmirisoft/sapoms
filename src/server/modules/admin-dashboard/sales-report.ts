import fs from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";
import { prisma } from "@/server/db/prisma";
import { formatSalesRegionLabel, SALES_REGION_OPTIONS } from "@/lib/salesRegions";
import type { SalesFilters } from "@/server/modules/admin-dashboard/sales-summary";

// The dashboard's sales report is the sample workbook filled with live data: every sheet keeps
// the sample's styles, formulas, conditional formats and chart. A sheet's first body row is the
// pattern - its styles are reused and its formulas re-pointed for each generated row.

const TEMPLATE = path.join(process.cwd(), "public", "Omsons_Dealer_Sales_Report_SAMPLE.xlsx");
// Orders are booked ex-GST; the sample values them at 18% (its note says to confirm per HSN).
const GST_RATE = 0.18;
const DAY_MS = 86_400_000;
const ACTIVE_DAYS = 30;
const AT_RISK_DAYS = 60;
const HIGH_DISCOUNT = 0.1;

/** Excel's day number for the UTC day of `date`, the day the Sales page buckets by. */
const serial = (date: Date) => Math.floor(date.getTime() / DAY_MS) + 25569;
const weekday = (day: number) => (new Date((day - 25569) * DAY_MS).getUTCDay() + 6) % 7; // Monday = 0
const colName = (index: number): string => (index >= 26 ? colName(Math.floor(index / 26) - 1) : "") + String.fromCharCode(65 + (index % 26));
const titleCase = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());

type Value = string | number | null | { f: string };
type TplCell = { col: string; s: string; f?: string; raw: string };
type TplRow = { attrs: string; cells: TplCell[]; xml: string };

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (text: string) => text.replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function cell(ref: string, s: string, value: Value | undefined) {
  const style = s ? ` s="${s}"` : "";
  if (value == null || value === "" || (typeof value === "number" && !Number.isFinite(value))) return `<c r="${ref}"${style}/>`;
  if (typeof value === "number") return `<c r="${ref}"${style}><v>${value}</v></c>`;
  if (typeof value === "string") return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
  return `<c r="${ref}"${style}><f>${esc(value.f)}</f></c>`;
}

function templateRows(xml: string) {
  const rows = new Map<number, TplRow>();
  for (const [rowXml, attrs, inner = ""] of xml.matchAll(/<row ([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells = [...inner.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(([raw, col, cellAttrs, body = ""]) => {
      const formula = /<f[^>]*>([\s\S]*?)<\/f>/.exec(body)?.[1];
      return { col, s: /s="(\d+)"/.exec(cellAttrs)?.[1] ?? "", f: formula === undefined ? undefined : unesc(formula), raw };
    });
    rows.set(Number(/\br="(\d+)"/.exec(attrs)![1]), { attrs, cells, xml: rowXml });
  }
  return rows;
}

/** Re-points same-sheet refs with a relative row: {4: 9} turns A4 and $A4 into A9 and $A9, never $A$4. */
const shift = (formula: string, map: Record<number, number>) =>
  formula.replace(/(^|[^A-Za-z_\d$])(\$?[A-Z]{1,3})(\d+)(?![\d(])/g, (_m, pre: string, col: string, row: string) => `${pre}${col}${map[Number(row)] ?? row}`);

const rowTag = (attrs: string, r: number) => `<row ${attrs.replace(/\br="\d+"/, `r="${r}"`)}>`;

/** Row `r` styled like template row `tplRow`: given values win, else the pattern's formula, else its constant. */
function emit(tpl: TplRow, tplRow: number, r: number, values: Record<string, Value>, map: Record<number, number> = {}, swap: [string, string][] = []) {
  const cells = tpl.cells.map(({ col, s, f, raw }) => {
    if (col in values) return cell(`${col}${r}`, s, values[col]);
    if (f !== undefined) return cell(`${col}${r}`, s, { f: swap.reduce((acc, [from, to]) => acc.split(from).join(to), shift(f, { [tplRow]: r, ...map })) });
    return raw.replace(/r="[A-Z]+\d+"/, `r="${col}${r}"`);
  });
  return `${rowTag(tpl.attrs, r)}${cells.join("")}</row>`;
}

const moveRow = (tpl: TplRow, r: number) => tpl.xml.replace(/(<row [^>]*?\br=")\d+/, `$1${r}`).replace(/(<c r="[A-Z]+)\d+"/g, `$1${r}"`);

/** Header rows kept, one body row per item, then the total row with its ranges re-pointed. */
function table(rows: Map<number, TplRow>, head: number[], bodyTpl: number, items: Record<string, Value>[], total?: { tpl: number; lastTpl: number }, swap: (totalRow: number) => [string, string][] = () => []) {
  const first = head[head.length - 1] + 1;
  const last = first + items.length - 1;
  const out = head.map((r) => rows.get(r)!.xml);
  items.forEach((values, i) => out.push(emit(rows.get(bodyTpl)!, bodyTpl, first + i, values, {}, swap(last + 1))));
  if (total) out.push(emit(rows.get(total.tpl)!, total.tpl, last + 1, {}, { [bodyTpl]: first, [total.lastTpl]: last }));
  return { rows: out, first, last: Math.max(last, first) };
}

function fill(xml: string, rows: string[], refs: Record<string, string> = {}) {
  const lastRow = /\br="(\d+)"/.exec(rows[rows.length - 1])![1];
  let out = xml
    .replace(/<sheetData>[\s\S]*<\/sheetData>/, `<sheetData>${rows.join("")}</sheetData>`)
    .replace(/<dimension ref="A1:([A-Z]+)\d+"\/>/, `<dimension ref="A1:$1${lastRow}"/>`);
  for (const [from, to] of Object.entries(refs)) out = out.split(`ref="${from}"`).join(`ref="${to}"`);
  return out;
}

export type SalesReportScope = { region: string; asm: string; city: string; range: string };

async function loadData(filters: SalesFilters) {
  const [dealerRows, asmRows] = await Promise.all([
    prisma.dealerProfile.findMany({
      where: { ...filters.dealer, OR: [{ deletedAt: null }, { orders: { some: {} } }] },
      select: {
        id: true, dealerCode: true, businessName: true, contactName: true, phone: true, city: true, state: true,
        region: true, createdAt: true, termsAcceptedAt: true, annualTargetPaise: true,
      },
      orderBy: { id: "asc" },
    }),
    prisma.staffProfile.findMany({
      where: { user: { role: "ASM" } },
      select: { id: true, displayName: true, salesRegion: true, assignedStates: true },
      orderBy: { displayName: "asc" },
    }),
  ]);
  const dealerIds = dealerRows.map((dealer) => dealer.id);
  const [orders, bills] = await Promise.all([
    // ponytail: every order of the dealers in scope, all dates, since lifetime, previous-period
    // and weekly figures recalculate from them. Page it if a filter ever spans tens of thousands.
    prisma.order.findMany({
      where: { dealerId: { in: dealerIds }, status: { not: "DRAFT" } },
      select: {
        orderNumber: true, orderDate: true, dealerId: true, status: true, rsmApprovalStatus: true, acceptanceStatus: true,
        fulfilmentStatus: true, acceptanceReviewedAt: true, acceptedAt: true, rsmNote: true, acceptanceNote: true, cancellationReason: true,
        items: {
          select: {
            catalogueNumberSnapshot: true, skuSnapshot: true, productNameSnapshot: true, categorySnapshot: true,
            totalPieces: true, unitPricePaise: true, discountPercent: true,
            product: { select: { category: { select: { name: true } } } },
          },
          orderBy: { id: "asc" },
        },
      },
      orderBy: [{ orderDate: "asc" }, { id: "asc" }],
    }),
    prisma.ledgerBill.groupBy({ by: ["dealerId"], where: { dealerId: { in: dealerIds } }, _sum: { billAmountPaise: true, paidAmountPaise: true } }),
  ]);

  // A dealer's ASM is the one covering its state, as the Sales page's ASM filter reads it.
  const covers = (asm: (typeof asmRows)[number], state: string | null) => !!state && asm.assignedStates.some((s) => s.trim().toLowerCase() === state.trim().toLowerCase());
  const outstanding = new Map(bills.map((bill) => [bill.dealerId, Number((bill._sum.billAmountPaise ?? BigInt(0)) - (bill._sum.paidAmountPaise ?? BigInt(0))) / 100]));
  const dealers = dealerRows.map((dealer) => {
    const asm = asmRows.find((a) => a.salesRegion === dealer.region && covers(a, dealer.state)) ?? asmRows.find((a) => covers(a, dealer.state));
    return {
      key: dealer.id,
      id: dealer.dealerCode || `D${dealer.id}`,
      name: dealer.businessName,
      contact: dealer.contactName ?? "",
      phone: dealer.phone ?? "",
      rawCity: dealer.city ?? "",
      city: titleCase(dealer.city ?? ""),
      state: dealer.state?.trim() ?? "",
      region: formatSalesRegionLabel(dealer.region),
      asmId: asm?.id ?? null,
      asm: asm?.displayName ?? "",
      onboarded: serial(dealer.createdAt),
      tnc: !!dealer.termsAcceptedAt,
      outstanding: outstanding.get(dealer.id) ?? 0,
      annualTarget: Number(dealer.annualTargetPaise ?? BigInt(0)) / 100,
    };
  });
  const dealerByKey = new Map(dealers.map((dealer) => [dealer.key, dealer]));

  const rows = orders.map((order) => {
    const status = order.status === "CANCELLED" ? "Deleted"
      : order.status === "DECLINED" || order.rsmApprovalStatus === "DECLINED" || order.acceptanceStatus === "DECLINED" ? "Rejected"
        : order.rsmApprovalStatus === "ACCEPTED" && order.acceptanceStatus === "ACCEPTED" ? "Accepted" : "Pending Approval";
    const reviewedAt = order.acceptanceReviewedAt ?? order.acceptedAt;
    const lines = order.items.map((item) => ({
      sku: item.catalogueNumberSnapshot || item.skuSnapshot || "",
      name: item.productNameSnapshot,
      category: item.categorySnapshot ?? item.product?.category?.name ?? "",
      qty: item.totalPieces,
      unit: Number(item.unitPricePaise) / 100,
      discount: Number(item.discountPercent) / 100,
    }));
    const gross = lines.reduce((sum, line) => sum + line.qty * line.unit, 0);
    const discount = lines.reduce((sum, line) => sum + line.qty * line.unit * line.discount, 0);
    return {
      id: order.orderNumber,
      date: serial(order.orderDate),
      dealer: dealerByKey.get(order.dealerId)!,
      status,
      fulfilment: status !== "Accepted" ? null
        : order.fulfilmentStatus === "COMPLETED" || order.status === "COMPLETED" ? "Delivered"
          : order.fulfilmentStatus === "DISPATCHED" || order.status === "DISPATCHED" ? "Dispatched" : "Not dispatched",
      hours: status === "Accepted" && reviewedAt ? Math.round((reviewedAt.getTime() - order.orderDate.getTime()) / 3_600_000) : null,
      reason: status === "Rejected" ? order.acceptanceNote || order.rsmNote || null : status === "Deleted" ? order.cancellationReason : null,
      lines,
      discountPct: gross ? discount / gross : 0,
      value: (gross - discount) * (1 + GST_RATE),
    };
  });

  const usedAsms = new Set(dealers.map((dealer) => dealer.asmId));
  const asms = asmRows.filter((asm) => (filters.asmId === null || asm.id === filters.asmId)
    && (usedAsms.has(asm.id) || (!filters.city && (!filters.region || asm.salesRegion === filters.region))));
  const regions = SALES_REGION_OPTIONS.filter((option) => !filters.region || option.value === filters.region).map((option) => option.label);

  return { dealers, orders: rows, asms, regions };
}

export async function buildSalesReport(filters: SalesFilters, scope: SalesReportScope) {
  const { dealers, orders, asms, regions } = await loadData(filters);
  const today = serial(new Date());
  const accepted = orders.filter((order) => order.status === "Accepted");
  const from = filters.from ? serial(filters.from) : accepted[0]?.date ?? today;
  const to = filters.to ? serial(filters.to) : today;
  const inPeriod = (day: number) => day >= from && day <= to;

  const zip = XLSX.CFB.read(await fs.readFile(TEMPLATE), { type: "buffer" });
  const entry = (name: string) => zip.FileIndex[zip.FullPaths.indexOf(`Root Entry/${name}`)];
  const read = (name: string) => Buffer.from(entry(name).content).toString("utf8");
  const write = (name: string, text: string) => {
    const file = entry(name);
    file.content = Buffer.from(text, "utf8");
    file.size = file.content.length;
  };
  const sheets: Record<number, string> = {};
  for (let i = 1; i <= 11; i++) sheets[i] = read(`xl/worksheets/sheet${i}.xml`);
  const tpl = (i: number) => templateRows(sheets[i]);

  // Summary: the report parameters and the filters it was run with.
  const setCell = (xml: string, ref: string, value: Value) =>
    xml.replace(new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`), (_m, attrs: string) => cell(ref, /s="(\d+)"/.exec(attrs)?.[1] ?? "", value));
  sheets[1] = [
    ["A1", "Omsons Dealer Sales Report"],
    ["A2", `Region: ${scope.region} · ASM: ${scope.asm} · City: ${scope.city} · ${scope.range}. Change the yellow cells; every other sheet recalculates from Orders and Order Lines.`],
    ["C5", from], ["C6", to], ["C7", to],
    ["E25", "• Targets prorate each dealer's annual target to the period; outstanding is billed minus paid in the ledger."],
  ].reduce((xml, [ref, value]) => setCell(xml, ref as string, value as Value), sheets[1]);

  // Region Summary
  const regionTable = table(tpl(2), [1, 2, 3], 4, regions.map((region) => ({
    A: region,
    B: [...new Set(dealers.filter((dealer) => dealer.region === region && dealer.state).map((dealer) => dealer.state))].join(", "),
  })), { tpl: 11, lastTpl: 10 }, (total) => [["$H$11", `$H$${total}`]]);
  sheets[2] = fill(sheets[2], regionTable.rows);

  // ASM Performance
  const periodShare = (to - from + 1) / 365;
  const asmTable = table(tpl(3), [1, 2, 3], 4, asms.map((asm) => ({
    A: asm.displayName,
    B: formatSalesRegionLabel(asm.salesRegion),
    C: asm.assignedStates.join(", "),
    D: Math.round(dealers.filter((dealer) => dealer.asmId === asm.id).reduce((sum, dealer) => sum + dealer.annualTarget, 0) * periodShare),
  })), { tpl: 12, lastTpl: 11 });
  sheets[3] = fill(sheets[3], asmTable.rows).replace('sqref="J4:J11"', `sqref="J${asmTable.first}:J${asmTable.last}"`);

  // City Summary
  const cities = new Map<string, (typeof dealers)[number]>();
  for (const dealer of dealers) if (dealer.city && !cities.has(dealer.city)) cities.set(dealer.city, dealer);
  const cityTable = table(tpl(4), [1, 2, 3], 4, [...cities.values()]
    .sort((a, b) => a.region.localeCompare(b.region) || a.city.localeCompare(b.city))
    .map((dealer) => ({ A: dealer.city, B: dealer.state, C: dealer.region, D: dealer.asm })), { tpl: 19, lastTpl: 18 }, (total) => [["$H$19", `$H$${total}`]]);
  sheets[4] = fill(sheets[4], cityTable.rows, { "A3:K18": `A3:K${cityTable.last}` });

  // Dealer Scorecard
  const dealerTable = table(tpl(5), [1], 2, dealers.map((dealer) => ({
    A: dealer.id, B: dealer.name, C: dealer.contact, D: dealer.phone, E: dealer.city, F: dealer.state, G: dealer.region,
    H: dealer.asm, I: dealer.onboarded, J: dealer.tnc ? "Yes" : "No", K: dealer.outstanding,
  })));
  sheets[5] = fill(sheets[5], dealerTable.rows, { "A1:X17": `A1:X${dealerTable.last}` }).replace('sqref="X2:X17"', `sqref="X2:X${dealerTable.last}"`);

  // Product Mix: every SKU the dealers in scope have ordered, at its latest price.
  const products = new Map<string, Record<string, Value>>();
  for (const order of orders) for (const line of order.lines) products.set(line.sku, { A: line.sku, B: line.name, C: line.category, D: line.unit });
  const productTable = table(tpl(6), [1, 2, 3], 4, [...products.values()]
    .sort((a, b) => String(a.C).localeCompare(String(b.C)) || String(a.A).localeCompare(String(b.A))), { tpl: 14, lastTpl: 13 },
  (total) => [["$J$14", `$J$${total}`], ["'Dealer Scorecard'!$A$2:$A$17", `'Dealer Scorecard'!$A$2:$A$${dealerTable.last}`]]);
  sheets[6] = fill(sheets[6], productTable.rows, { "A3:M13": `A3:M${productTable.last}` });

  // Time Series: one column per region, one row per week from the first to the last accepted order.
  const ts = tpl(8);
  const style = (row: number, col: string) => ts.get(row)!.cells.find((c) => c.col === col)!.s;
  const formula = (row: number, col: string) => ts.get(row)!.cells.find((c) => c.col === col)!.f!;
  const regionCols = regions.map((_, i) => colName(2 + i));
  const lastRegionCol = regionCols[regionCols.length - 1];
  const totalCol = colName(2 + regions.length);
  const countCol = colName(3 + regions.length);
  const firstWeek = (accepted[0]?.date ?? from) - weekday(accepted[0]?.date ?? from);
  const lastWeek = (accepted[accepted.length - 1]?.date ?? from);
  const weeks: number[] = [];
  for (let week = firstWeek; week <= lastWeek; week += 7) weeks.push(week);
  const weekLast = 3 + weeks.length;
  const tsRows = [
    ts.get(1)!.xml, ts.get(2)!.xml,
    `${rowTag(ts.get(3)!.attrs, 3)}${[
      cell("A3", style(3, "A"), "week start"), cell("B3", style(3, "B"), "week end"),
      ...regions.map((region, i) => cell(`${regionCols[i]}3`, style(3, "C"), region)),
      cell(`${totalCol}3`, style(3, "J"), "total booking"), cell(`${countCol}3`, style(3, "K"), "accepted orders"),
    ].join("")}</row>`,
    ...weeks.map((week, i) => {
      const r = 4 + i;
      return `${rowTag(ts.get(4)!.attrs, r)}${[
        cell(`A${r}`, style(4, "A"), week), cell(`B${r}`, style(4, "B"), { f: `A${r}+6` }),
        ...regionCols.map((col) => cell(`${col}${r}`, style(4, "C"), { f: shift(formula(4, "C").split("C$3").join(`${col}$3`), { 4: r }) })),
        cell(`${totalCol}${r}`, style(4, "J"), { f: `SUM(C${r}:${lastRegionCol}${r})` }),
        cell(`${countCol}${r}`, style(4, "K"), { f: shift(formula(4, "K"), { 4: r }) }),
      ].join("")}</row>`;
    }),
    `${rowTag(ts.get(17)!.attrs, weekLast + 1)}${[
      cell(`A${weekLast + 1}`, style(17, "A"), "Total"), cell(`B${weekLast + 1}`, style(17, "B"), null),
      ...[...regionCols, totalCol].map((col) => cell(`${col}${weekLast + 1}`, style(17, "C"), { f: `SUM(${col}4:${col}${weekLast})` })),
      cell(`${countCol}${weekLast + 1}`, style(17, "K"), { f: `SUM(${countCol}4:${countCol}${weekLast})` }),
    ].join("")}</row>`,
  ];
  const width = (min: number, max: number, w: number) => `<col min="${min}" max="${max}" width="${w}" customWidth="1"/>`;
  sheets[8] = fill(sheets[8], tsRows)
    .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${countCol}${weekLast + 1}"/>`)
    .replace(/<cols>[\s\S]*?<\/cols>/, `<cols>${width(1, 2, 13)}${width(3, 2 + regions.length, 12)}${width(3 + regions.length, 3 + regions.length, 14)}${width(4 + regions.length, 4 + regions.length, 9)}</cols>`);

  let chart = read("xl/charts/chart1.xml");
  const series = chart.match(/<c:ser>[\s\S]*?<\/c:ser>/g)!;
  const colors = series.map((ser) => /<a:srgbClr val="(\w+)"/.exec(ser)![1]);
  chart = chart.replace(/<c:ser>[\s\S]*<\/c:ser>/, regionCols.map((col, i) => series[0]
    .replace(/<c:(str|num)Cache>[\s\S]*?<\/c:\1Cache>/g, "")
    .replace(/<c:idx val="0"\/><c:order val="0"\/>/, `<c:idx val="${i}"/><c:order val="${i}"/>`)
    .replace("!C3<", `!${col}3<`)
    .replace("$A$4:$A$16", `$A$4:$A$${weekLast}`)
    .replace("$C$4:$C$16", `$${col}$4:$${col}$${weekLast}`)
    .replace(/<a:srgbClr val="\w+"/, `<a:srgbClr val="${colors[i % colors.length]}"`)).join(""));
  write("xl/charts/chart1.xml", chart);
  // The chart sits under the table, so it moves down as weeks are added.
  write("xl/drawings/drawing4.xml", read("xl/drawings/drawing4.xml")
    .replace(/(<xdr:from>[\s\S]*?<xdr:row>)\d+/, `$1${weekLast + 2}`)
    .replace(/(<xdr:to>[\s\S]*?<xdr:row>)\d+/, `$1${weekLast + 19}`));

  // Exceptions: a snapshot with the default thresholds, as the sample is.
  const ex = tpl(9);
  const exRows = [ex.get(1)!.xml, ex.get(2)!.xml];
  let r = 4;
  const section = (title: number, items: Record<string, Value>[]) => {
    const body = title + 2;
    exRows.push(moveRow(ex.get(title)!, r++), moveRow(ex.get(title + 1)!, r++));
    for (const values of items.length ? items : [{ B: "None" }]) {
      exRows.push(emit(ex.get(body)!, body, r++, Object.fromEntries([..."ABCDEFGH"].map((col) => [col, values[col] ?? null]))));
    }
    r++;
  };
  section(4, dealers.flatMap((dealer) => {
    const history = accepted.filter((order) => order.dealer === dealer && order.date <= to);
    const last = history[history.length - 1]?.date;
    const days = last === undefined ? null : to - last;
    const tnc = dealer.tnc ? "" : "; T&C not accepted";
    const action = days === null ? `Never ordered — onboarding call, share catalogue${tnc}`
      : days <= ACTIVE_DAYS ? null
        : days <= AT_RISK_DAYS ? "At-risk — ASM follow-up this week" : "Dormant — ASM visit, reactivation offer";
    return action ? [{ A: dealer.id, B: dealer.name, C: dealer.city, D: dealer.asm, E: dealer.phone, F: last ?? null, G: days, H: action }] : [];
  }));
  section(17, orders
    .filter((order) => inPeriod(order.date) && (order.status === "Accepted" || order.status === "Pending Approval") && order.discountPct > HIGH_DISCOUNT)
    .map((order) => ({ A: order.id, B: order.dealer.name, C: order.date, D: order.dealer.asm, E: order.status, F: order.value, G: order.discountPct, H: "Check discount approval trail" })));
  section(22, orders
    .filter((order) => inPeriod(order.date) && (order.status === "Rejected" || order.status === "Deleted"))
    .map((order) => ({ A: order.id, B: order.dealer.name, C: order.date, D: order.dealer.asm, E: order.status, F: order.value, H: order.reason ?? "" })));
  const cityFixes = new Map<string, { raw: string; city: string; count: number }>();
  for (const dealer of dealers) {
    if (dealer.rawCity === dealer.city) continue;
    const fix = cityFixes.get(dealer.rawCity) ?? { raw: dealer.rawCity, city: dealer.city, count: 0 };
    cityFixes.set(dealer.rawCity, { ...fix, count: fix.count + 1 });
  }
  const noAsm = dealers.filter((dealer) => !dealer.asm).length;
  const noRegion = dealers.filter((dealer) => !dealer.region).length;
  section(27, [
    ...[...cityFixes.values()].map((fix) => ({ A: "city", B: fix.raw || "(blank)", C: fix.city || "—", D: fix.count, H: `Spelling/case variant of ${fix.city || "a city"} — store a city_id, not free text` })),
    ...(noAsm ? [{ A: "dealer", B: "(no ASM)", C: "—", D: noAsm, H: "Every dealer must map to an ASM (its state on an ASM) before it can appear in rollups" }] : []),
    ...(noRegion ? [{ A: "dealer", B: "(no region)", C: "—", D: noRegion, H: "Set the dealer's region so it rolls up on Region Summary" }] : []),
  ]);
  sheets[9] = fill(sheets[9], exRows);

  // Orders and Order Lines: the raw rows every other sheet recalculates from.
  const orderTable = table(tpl(10), [1], 2, orders.map((order) => ({
    A: order.id, B: order.date, C: order.dealer.id, D: order.dealer.name, E: order.dealer.city, F: order.dealer.state,
    G: order.dealer.region, H: order.dealer.asm, I: order.status, J: order.fulfilment, K: order.hours, L: order.reason,
  })));
  sheets[10] = fill(sheets[10], orderTable.rows, { "A1:T20": `A1:T${orderTable.last}` });
  let lineNo = 0;
  const lineTable = table(tpl(11), [1], 2, orders.flatMap((order) => order.lines.map((line) => ({
    A: `L${String(++lineNo).padStart(4, "0")}`, B: order.id, C: order.date, D: order.status, E: order.dealer.id, F: order.dealer.name,
    G: order.dealer.city, H: order.dealer.state, I: order.dealer.region, J: order.dealer.asm,
    K: line.sku, L: line.name, M: line.category, N: line.qty, O: line.unit, P: line.discount, T: GST_RATE,
  }))));
  sheets[11] = fill(sheets[11], lineTable.rows, { "A1:V40": `A1:V${lineTable.last}` });

  // The sample's formulas read rows 2-500 of the raw sheets; widen them when the data is longer.
  const span = Math.max(500, orderTable.last, lineTable.last, dealerTable.last);
  for (let i = 1; i <= 11; i++) {
    write(`xl/worksheets/sheet${i}.xml`, sheets[i]
      .replace(/(<f[^>]*>[^<]*<\/f>)<v>[^<]*<\/v>/g, "$1") // drop the sample's cached results
      .replace(/\$500\b/g, `$${span}`));
  }
  write("xl/workbook.xml", read("xl/workbook.xml")
    .replace("<calcPr ", "<calcPr fullCalcOnLoad=\"1\" ")
    .replace("$A$3:$K$18", `$A$3:$K$${cityTable.last}`)
    .replace("$A$1:$X$17", `$A$1:$X$${dealerTable.last}`)
    .replace("$A$1:$V$40", `$A$1:$V$${lineTable.last}`)
    .replace("$A$1:$T$20", `$A$1:$T$${orderTable.last}`)
    .replace("$A$3:$M$13", `$A$3:$M$${productTable.last}`));

  return XLSX.CFB.write(zip, { fileType: "zip", type: "buffer", compression: true }) as Buffer;
}
