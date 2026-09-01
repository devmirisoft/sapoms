#!/usr/bin/env node
import { PrismaClient } from './prisma.mjs';
import { DEFAULT_SOURCES, runImport } from "./legacy-order-importer.mjs";

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const backendUrl = argValue("backend-url", process.env.LEGACY_BACKEND_URL || process.env.BACKEND_URL || "");
if (!backendUrl) {
  console.error("Missing --backend-url or LEGACY_BACKEND_URL/BACKEND_URL.");
  process.exit(1);
}

const prisma = new PrismaClient();
const dryRun = hasFlag("dry-run") || !hasFlag("apply");
const limit = hasFlag("all") ? Number.POSITIVE_INFINITY : Number(argValue("limit", "50"));
const pageSize = Number(argValue("page-size", "200"));
const orderId = argValue("order-id", "");
const sourceArg = argValue("source", "");
const sources = sourceArg ? sourceArg.split(",").map((source) => source.trim()).filter(Boolean) : DEFAULT_SOURCES;

try {
  const summary = await runImport({ prisma, backendUrl, sources, limit, pageSize, dryRun, orderId });
  console.log(JSON.stringify({ dryRun, sources, orderId: orderId || undefined, ...summary }, null, 2));
} finally {
  await prisma.$disconnect();
}


