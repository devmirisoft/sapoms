import "server-only";

import { createHash, randomInt, timingSafeEqual } from "crypto";
import { prisma } from "@/server/db/prisma";
import type { AuthRole } from "@/server/auth/providers/types";

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 30 * 1000;

// Dealers and staff-profile roles get an emailed second factor; admins, NSMs and accountants use a password alone.
const EMAIL_OTP_ROLES = new Set<AuthRole>(["DEALER", "STAFF", "RSM", "ASM"]);

export function isEmailOtpEnabled() {
  return process.env.ENABLE_EMAIL_OTP === "true";
}

export function requiresEmailOtp(role: AuthRole) {
  return EMAIL_OTP_ROLES.has(role);
}

function otpPepper() {
  const pepper = process.env.AUTH_OTP_PEPPER?.trim();
  if (!pepper) throw new Error("AUTH_OTP_PEPPER is not configured");
  return pepper;
}

export function generateEmailOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashEmailOtp(userId: bigint, otp: string) {
  return createHash("sha256")
    .update(`${userId.toString()}:${otp}:${otpPepper()}`)
    .digest("hex");
}

export function isValidOtpFormat(otp: string) {
  return /^\d{6}$/.test(otp);
}

function hashesMatch(expectedHash: string, actualHash: string) {
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(actualHash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function createEmailOtpForUser(userId: bigint) {
  const now = new Date();
  const cooldownStart = new Date(now.getTime() - OTP_RESEND_COOLDOWN_MS);
  const recentOtp = await prisma.emailOtp.findFirst({
    where: {
      userId,
      usedAt: null,
      createdAt: { gt: cooldownStart },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  if (recentOtp) {
    const error = new Error("OTP resend cooldown is active");
    (error as { status?: number }).status = 429;
    throw error;
  }

  const otp = generateEmailOtp();
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS);

  const record = await prisma.$transaction(async (tx) => {
    await tx.emailOtp.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: now },
    });
    return tx.emailOtp.create({
      data: {
        userId,
        codeHash: hashEmailOtp(userId, otp),
        expiresAt,
      },
    });
  });

  return { otp, record };
}

export async function invalidateEmailOtp(id: string) {
  await prisma.emailOtp.update({
    where: { id },
    data: { usedAt: new Date() },
  }).catch(() => undefined);
}

export async function verifyEmailOtpForUser(userId: bigint, otp: string) {
  if (!isValidOtpFormat(otp)) throw new Error("Invalid verification code");

  const now = new Date();
  const record = await prisma.emailOtp.findFirst({
    where: { userId, usedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!record || record.expiresAt <= now || record.attempts >= OTP_MAX_ATTEMPTS) {
    throw new Error("Invalid verification code");
  }

  const codeHash = hashEmailOtp(userId, otp);
  if (!hashesMatch(record.codeHash, codeHash)) {
    const nextAttempts = record.attempts + 1;
    await prisma.emailOtp.update({
      where: { id: record.id },
      data: {
        attempts: nextAttempts,
        ...(nextAttempts >= OTP_MAX_ATTEMPTS ? { usedAt: now } : {}),
      },
    });
    throw new Error("Invalid verification code");
  }

  await prisma.emailOtp.update({
    where: { id: record.id },
    data: { usedAt: now },
  });
}