import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { mapPostgresUserToLegacyProfile, getProfileId } from "@/server/auth/legacy-auth.mapper";
import { verifyPassword } from "@/server/auth/password";
import { LEGACY_ROLE_MAP, type AuthRole, type LegacyRoleType } from "./types";

export type AuthenticatedPostgresUser = {
  userId: bigint;
  role: AuthRole;
  email: string;
  displayName: string;
  tokenVersion: number;
  profileId: bigint;
  profile: Record<string, unknown>;
  diagnosticPasswordId?: bigint;
};

export interface PostgresAuthenticationProvider {
  authenticate(input: {
    email: string;
    password: string;
    roleType?: string;
  }): Promise<AuthenticatedPostgresUser>;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeLoginIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

// Dealers sign in with an email, a username, a dealer code, or a legacy PHP id;
// every lookup goes through this so OTP and password login accept the same set.
function loginIdentifierWhere(identifier: string): Prisma.UserWhereInput {
  const normalized = normalizeLoginIdentifier(identifier);
  return {
    OR: [
      { normalizedEmail: normalized },
      { normalizedUsername: normalized },
      { dealerProfile: { dealerCode: identifier.trim() } },
      { dealerProfile: { legacyPhpId: identifier.trim() } },
    ],
  };
}

const authUserInclude = {
  adminProfile: true,
  accountantProfile: true,
  staffProfile: {
    select: {
      id: true,
      displayName: true,
      designation: true,
      location: true,
      staffRoleType: true,
      salesRegion: true,
    },
  },
  dealerProfile: true,
} satisfies Prisma.UserInclude;

function displayNameFromProfile(profile: Record<string, unknown>, role: AuthRole) {
  const keys = role === "DEALER" ? ["Dealer_Name", "name"] : ["name", "staff_name", "ADMIN_NAME"];
  for (const key of keys) {
    const value = profile[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function toAuthenticatedPostgresUser(
  user: NonNullable<Awaited<ReturnType<typeof findPostgresUserByLoginIdentifier>>>,
  diagnosticPasswordId?: bigint,
): AuthenticatedPostgresUser {
  const profile = mapPostgresUserToLegacyProfile(user);
  const profileId = getProfileId(user);

  return {
    userId: user.id,
    role: user.role,
    email: user.email,
    displayName: displayNameFromProfile(profile, user.role),
    tokenVersion: user.tokenVersion,
    profileId,
    profile,
    diagnosticPasswordId,
  };
}

function findPostgresUserByLoginIdentifier(identifier: string) {
  return prisma.user.findFirst({ where: loginIdentifierWhere(identifier), include: authUserInclude });
}

export async function findActivePostgresUserByLoginIdentifier(identifier: string): Promise<AuthenticatedPostgresUser> {
  if (!normalizeLoginIdentifier(identifier)) throw new Error("Invalid credentials");

  const user = await findPostgresUserByLoginIdentifier(identifier);
  if (!user || user.deletedAt || user.status !== "ACTIVE") throw new Error("Invalid credentials");

  return toAuthenticatedPostgresUser(user);
}
export class PrismaPostgresAuthenticationProvider implements PostgresAuthenticationProvider {
  async authenticate(input: { email: string; password: string; roleType?: string }): Promise<AuthenticatedPostgresUser> {
    const expectedRole = input.roleType ? LEGACY_ROLE_MAP[input.roleType as LegacyRoleType] : undefined;
    if (!normalizeLoginIdentifier(input.email) || (input.roleType && !expectedRole)) throw new Error("Invalid credentials");

    const user = await findPostgresUserByLoginIdentifier(input.email);

    if (!user || user.deletedAt || user.status !== "ACTIVE") throw new Error("Invalid credentials");
    if (expectedRole && user.role !== expectedRole) throw new Error("Invalid credentials");

    let diagnosticPasswordId: bigint | undefined;
    // The account's own hash is always checked first; a temporary password is
    // only ever a fallback, and only for dealer and staff profiles.
    const passwordMatches = await verifyPassword(input.password, user.passwordHash);
    if (!passwordMatches) {
      const owner = user.dealerProfile?.id
        ? { dealerId: user.dealerProfile.id }
        : user.staffProfile?.id
          ? { staffId: user.staffProfile.id }
          : null;
      if (!owner) throw new Error("Invalid credentials");
      const now = new Date();
      const candidates = await prisma.diagnosticPassword.findMany({
        where: { ...owner, revokedAt: null, expiresAt: { gt: now } },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, passwordHash: true },
      });
      for (const candidate of candidates) {
        if (await verifyPassword(input.password, candidate.passwordHash)) {
          diagnosticPasswordId = candidate.id;
          await prisma.diagnosticPassword.update({ where: { id: candidate.id }, data: { lastUsedAt: now } });
          break;
        }
      }
      if (!diagnosticPasswordId) throw new Error("Invalid credentials");
    }

    return toAuthenticatedPostgresUser(user, diagnosticPasswordId);
  }
}

export const postgresAuthenticationProvider = new PrismaPostgresAuthenticationProvider();