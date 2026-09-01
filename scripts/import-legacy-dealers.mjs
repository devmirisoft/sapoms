#!/usr/bin/env node
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { PrismaClient } from './prisma.mjs';
import { parsePossiblyNoisyJson } from "./legacy-order-importer.mjs";

const scrypt = promisify(scryptCallback);
const BACKEND_URL = process.env.LEGACY_BACKEND_URL || process.env.BACKEND_URL || "https://mirisoft.co.in/sas/dealerapi/api";
const REPORT_PATH = "docs/legacy-dealer-mapping.json";
const LEGACY_DEALER_IDS = ["99", "73", "81", "50", "147", "218", "148", "230", "142"];

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function text(value) {
  return String(value ?? "").trim();
}

function normalizedEmail(value) {
  return text(value).toLowerCase();
}

function normalizedPhone(value) {
  return text(value).replace(/\D/g, "");
}

function statusFromLegacy(value) {
  return text(value) === "0" ? "INACTIVE" : "SUSPENDED";
}

function paise(value) {
  const number = Number(text(value).replace(/,/g, ""));
  return Number.isFinite(number) ? BigInt(Math.round(number * 100)) : null;
}

function decimalString(value) {
  const number = Number(text(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number.toFixed(4) : null;
}

async function disabledPasswordHash() {
  const salt = randomBytes(16).toString("base64url");
  const secret = randomBytes(32).toString("base64url");
  const derived = await scrypt(secret, salt, 64);
  return `scrypt:${salt}:${Buffer.from(derived).toString("hex")}`;
}

async function fetchJson(endpoint, params = {}) {
  const url = new URL(endpoint.replace(/^\/+/, ""), BACKEND_URL.endsWith("/") ? BACKEND_URL : `${BACKEND_URL}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${endpoint} failed with ${response.status}`);
  return parsePossiblyNoisyJson(await response.text());
}

async function loadLegacyDealers() {
  const dealerIds = argValue("dealer-ids", LEGACY_DEALER_IDS.join(",")).split(",").map((id) => id.trim()).filter(Boolean);
  const dealers = [];
  for (const id of dealerIds) {
    const payload = await fetchJson("getdealer", { id });
    if (payload?.data && typeof payload.data === "object") dealers.push(payload.data);
  }
  return dealers;
}

function classifyDealer(legacy, postgresDealers) {
  const legacyDealerId = text(legacy.Dealer_Id);
  const legacyDealerCode = text(legacy.Dealer_Dealercode);
  const email = normalizedEmail(legacy.Dealer_Email);
  const phone = normalizedPhone(legacy.Dealer_Number);
  const candidates = [];

  for (const dealer of postgresDealers) {
    if (dealer.legacyPhpId && dealer.legacyPhpId === legacyDealerId) candidates.push({ dealer, method: "legacyPhpId" });
    else if (legacyDealerCode && dealer.dealerCode === legacyDealerCode) candidates.push({ dealer, method: "dealerCode" });
    else if (email && dealer.user.normalizedEmail === email) candidates.push({ dealer, method: "normalizedEmail" });
    else if (phone && normalizedPhone(dealer.phone) === phone) candidates.push({ dealer, method: "normalizedPhone" });
  }

  const unique = new Map(candidates.map((candidate) => [candidate.dealer.id.toString(), candidate]));
  if (unique.size === 1) {
    const [{ dealer, method }] = unique.values();
    return { status: "EXACT_EXISTING", dealer, method, reason: `Matched by ${method}` };
  }
  if (unique.size > 1) return { status: "AMBIGUOUS", dealer: null, method: "", reason: "Multiple deterministic PostgreSQL matches" };
  if (!legacyDealerId || !legacyDealerCode || !email) return { status: "UNRESOLVED", dealer: null, method: "", reason: "Missing legacy id, dealer code, or email" };
  return { status: "SAFE_TO_IMPORT", dealer: null, method: "legacyPhpId", reason: "No existing deterministic match; legacy id, code, and email are present" };
}

async function main() {
  const prisma = new PrismaClient();
  const apply = hasFlag("apply");
  try {
    const legacyDealers = await loadLegacyDealers();
    const postgresDealers = await prisma.dealerProfile.findMany({
      select: {
        id: true,
        legacyPhpId: true,
        dealerCode: true,
        businessName: true,
        phone: true,
        userId: true,
        user: { select: { id: true, normalizedEmail: true } },
      },
    });
    const report = [];
    let imported = 0;

    for (const legacy of legacyDealers) {
      const classification = classifyDealer(legacy, postgresDealers);
      let dealer = classification.dealer;
      let status = classification.status;
      let reason = classification.reason;

      if (classification.status === "SAFE_TO_IMPORT" && apply) {
        const passwordHash = await disabledPasswordHash();
        dealer = await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email: text(legacy.Dealer_Email),
              normalizedEmail: normalizedEmail(legacy.Dealer_Email),
              username: text(legacy.Dealer_Username) || null,
              normalizedUsername: normalizedEmail(legacy.Dealer_Username) || null,
              passwordHash,
              role: "DEALER",
              status: statusFromLegacy(legacy.status),
            },
          });
          return tx.dealerProfile.create({
            data: {
              userId: user.id,
              legacyPhpId: text(legacy.Dealer_Id),
              dealerCode: text(legacy.Dealer_Dealercode),
              businessName: text(legacy.Dealer_Name),
              phone: text(legacy.Dealer_Number) || null,
              city: text(legacy.Dealer_City) || null,
              address: text(legacy.Dealer_Address) || null,
              pincode: text(legacy.Dealer_Pincode) || null,
              gstin: text(legacy.gst) || null,
              discountPercent: decimalString(legacy.discount),
              creditDays: Number(text(legacy.creditdays)) || null,
              creditLimitPaise: paise(legacy.currentlimit),
            },
            include: { user: true },
          });
        });
        postgresDealers.push({
          id: dealer.id,
          legacyPhpId: dealer.legacyPhpId,
          dealerCode: dealer.dealerCode,
          businessName: dealer.businessName,
          phone: dealer.phone,
          userId: dealer.userId,
          user: { id: dealer.user.id, normalizedEmail: dealer.user.normalizedEmail },
        });
        status = "IMPORTED";
        reason = "Imported inactive dealer account with preserved legacy identity; legacy password not migrated";
        imported += 1;
      }

      report.push({
        legacyDealerId: text(legacy.Dealer_Id),
        legacyDealerCode: text(legacy.Dealer_Dealercode),
        legacyName: text(legacy.Dealer_Name),
        status,
        postgresDealerProfileId: dealer?.id?.toString() ?? null,
        postgresUserId: (dealer?.user?.id ?? dealer?.userId)?.toString() ?? null,
        matchMethod: status === "IMPORTED" ? "createdFromLegacyPhpId" : classification.method,
        reason,
      });
    }

    await mkdir(dirname(REPORT_PATH), { recursive: true });
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({
      apply,
      legacyDealersDiscovered: legacyDealers.length,
      existingPostgreSQLMatches: report.filter((row) => row.status === "EXACT_EXISTING").length,
      dealersImported: imported,
      ambiguous: report.filter((row) => row.status === "AMBIGUOUS").length,
      unresolved: report.filter((row) => row.status === "UNRESOLVED").length,
      mappingReportPath: REPORT_PATH,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

await main();