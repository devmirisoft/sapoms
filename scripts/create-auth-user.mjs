import { PrismaClient } from './prisma.mjs';
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const prisma = new PrismaClient();
const scrypt = promisify(scryptCallback);
const ROLES = new Set(["ADMIN", "ACCOUNTANT", "STAFF", "DEALER"]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

function required(name, value) {
  if (!String(value ?? "").trim()) throw new Error(`Missing required ${name}`);
  return String(value).trim();
}

function intOrNull(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) throw new Error(`Invalid integer: ${value}`);
  return parsed;
}

const args = parseArgs(process.argv.slice(2));
const role = String(args.role ?? process.env.AUTH_USER_ROLE ?? "").trim().toUpperCase();
const email = required("email", args.email ?? process.env.AUTH_USER_EMAIL);
const normalizedEmail = normalizeEmail(email);
const password = required("password", args.password ?? process.env.AUTH_USER_PASSWORD);
const name = required("name", args.name ?? args.displayName ?? args.businessName ?? process.env.AUTH_USER_NAME);

if (!ROLES.has(role)) throw new Error("Role must be ADMIN, ACCOUNTANT, STAFF, or DEALER");

const existing = await prisma.user.findUnique({ where: { normalizedEmail } });
if (existing) throw new Error(`A user already exists for ${normalizedEmail}`);

const passwordHash = await hashPassword(password);

const result = await prisma.$transaction(async (tx) => {
  const user = await tx.user.create({
    data: {
      email: email.trim(),
      normalizedEmail,
      passwordHash,
      role,
      status: "ACTIVE",
    },
  });

  if (role === "ADMIN") {
    await tx.adminProfile.create({
      data: {
        userId: user.id,
        displayName: name,
        phone: args.phone ?? null,
        imageUrl: args.imageUrl ?? null,
      },
    });
  }

  if (role === "ACCOUNTANT") {
    await tx.accountantProfile.create({
      data: {
        userId: user.id,
        displayName: name,
        designation: args.designation ?? null,
      },
    });
  }

  if (role === "STAFF") {
    await tx.staffProfile.create({
      data: {
        userId: user.id,
        displayName: name,
        designation: args.designation ?? null,
        location: args.location ?? null,
        staffRoleType: args.staffRoleType ?? "1",
      },
    });
  }

  if (role === "DEALER") {
    await tx.dealerProfile.create({
      data: {
        userId: user.id,
        businessName: name,
        dealerCode: args.dealerCode ?? null,
        phone: args.phone ?? null,
        city: args.city ?? null,
        address: args.address ?? null,
        pincode: args.pincode ?? null,
        gstin: args.gstin ?? null,
        discountPercent: args.discountPercent ?? null,
        creditDays: intOrNull(args.creditDays),
      },
    });
  }

  return user;
});

console.log(JSON.stringify({ userId: result.id.toString(), role: result.role, email: result.email }, null, 2));
await prisma.$disconnect();