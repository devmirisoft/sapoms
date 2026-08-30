import "server-only";

import { createHash, randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { getProfileId, mapPostgresUserToLegacyProfile } from "@/server/auth/legacy-auth.mapper";
import type { AuthenticatedPostgresUser } from "@/server/auth/providers/postgres-auth.provider";
import type { AuthRole } from "./providers/types";

export const ACCESS_COOKIE = "omsons_access";
export const REFRESH_COOKIE = "omsons_refresh";
const ACCESS_TTL_SECONDS = 15 * 600;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

type UserWithProfiles = Awaited<ReturnType<typeof loadUserWithProfiles>>;

export type AuthActor = {
  userId: bigint;
  sessionId: string;
  role: AuthRole;
  profileId: bigint;
  adminId?: bigint;
  accountantId?: bigint;
  staffId?: bigint;
  dealerId?: bigint;
  email: string;
  displayName: string;
};

type AccessClaims = jwt.JwtPayload & {
  sub: string;
  role: AuthRole;
  sid: string;
  tokenVersion: number;
};

function jwtSecret() {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) throw new Error("JWT_SECRET is not configured");
  return secret;
}

function refreshPepper() {
  return process.env.AUTH_REFRESH_PEPPER?.trim() || jwtSecret();
}

function issuer() {
  return process.env.AUTH_JWT_ISSUER?.trim() || "omsons";
}

function audience() {
  return process.env.AUTH_JWT_AUDIENCE?.trim() || "omsons-web";
}

function requestIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

function userAgent(request: NextRequest) {
  return request.headers.get("user-agent");
}

export function hashRefreshToken(refreshToken: string) {
  return createHash("sha256").update(`${refreshToken}${refreshPepper()}`).digest("hex");
}

export function generateRefreshToken() {
  return randomBytes(48).toString("base64url");
}

function signAccessToken(input: { userId: bigint; sessionId: string; role: AuthRole; tokenVersion: number }) {
  return jwt.sign(
    {
      sub: input.userId.toString(),
      role: input.role,
      sid: input.sessionId,
      tokenVersion: input.tokenVersion,
    },
    jwtSecret(),
    {
      algorithm: "HS256",
      expiresIn: ACCESS_TTL_SECONDS,
      issuer: issuer(),
      audience: audience(),
    },
  );
}

function cookieOptions(maxAge: number, sameSite: "lax" | "strict", path: string) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite,
    path,
    maxAge,
  } as const;
}

export function setAuthCookies(response: NextResponse, accessToken: string, refreshToken: string) {
  response.cookies.set(ACCESS_COOKIE, accessToken, cookieOptions(ACCESS_TTL_SECONDS, "lax", "/"));
  response.cookies.set(REFRESH_COOKIE, refreshToken, cookieOptions(REFRESH_TTL_SECONDS, "strict", "/api/auth"));
}

export function clearAuthCookies(response: NextResponse) {
  response.cookies.set(ACCESS_COOKIE, "", { ...cookieOptions(0, "lax", "/"), expires: new Date(0) });
  response.cookies.set(REFRESH_COOKIE, "", { ...cookieOptions(0, "strict", "/api/auth"), expires: new Date(0) });
}

export async function writeAuthAuditLog(input: {
  sessionId?: string;
  userId?: bigint;
  role?: AuthRole;
  eventType: string;
  request?: NextRequest;
  metadata?: Record<string, unknown>;
}) {
  await prisma.authAuditLog.create({
    data: {
      sessionId: input.sessionId,
      role: input.role,
      eventType: input.eventType,
      ipAddress: input.request ? requestIp(input.request) : null,
      userAgent: input.request ? userAgent(input.request) : null,
      metadata: {
        ...(input.metadata ?? {}),
        ...(input.userId ? { userId: input.userId.toString() } : {}),
      },
    },
  }).catch(() => undefined);
}

export async function createSessionForUser(actor: AuthenticatedPostgresUser, request: NextRequest) {
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.authSession.create({
      data: {
        userId: actor.userId,
        refreshTokenHash,
        expiresAt,
        ipAddress: requestIp(request),
        userAgent: userAgent(request),
      },
    });

    await tx.user.update({
      where: { id: actor.userId },
      data: { lastLoginAt: new Date() },
    });

    await tx.authAuditLog.create({
      data: {
        sessionId: created.id,
        role: actor.role,
        eventType: "LOGIN_SUCCEEDED",
        ipAddress: requestIp(request),
        userAgent: userAgent(request),
        metadata: {
          userId: actor.userId.toString(),
          ...(actor.diagnosticPasswordId ? { diagnosticPasswordId: actor.diagnosticPasswordId.toString(), authMethod: "diagnosticPassword" } : {}),
        },
      },
    });

    return created;
  });

  return {
    session,
    accessToken: signAccessToken({
      userId: actor.userId,
      sessionId: session.id,
      role: actor.role,
      tokenVersion: actor.tokenVersion,
    }),
    refreshToken,
  };
}

export function verifyAccessToken(token: string): AccessClaims {
  const payload = jwt.verify(token, jwtSecret(), {
    algorithms: ["HS256"],
    issuer: issuer(),
    audience: audience(),
  });
  if (!payload || typeof payload !== "object") throw new Error("Invalid token");
  const claims = payload as AccessClaims;
  if (!claims.sub || !claims.sid || !claims.role || typeof claims.tokenVersion !== "number") throw new Error("Invalid token claims");
  if (!["ADMIN", "NSM", "ACCOUNTANT", "RSM", "ASM", "STAFF", "DEALER"].includes(claims.role)) throw new Error("Invalid token role");
  return claims;
}

async function loadUserWithProfiles(userId: bigint) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
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
    },
  });
}

function assertActiveUser(user: NonNullable<UserWithProfiles>, claims?: Pick<AccessClaims, "role" | "tokenVersion">) {
  if (user.deletedAt || user.status !== "ACTIVE") throw new Error("User is not active");
  if (claims && (user.role !== claims.role || user.tokenVersion !== claims.tokenVersion)) throw new Error("Token mismatch");
}

export async function loadActiveSession(claims: AccessClaims) {
  const userId = BigInt(claims.sub);
  const session = await prisma.authSession.findUnique({ where: { id: claims.sid } });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) throw new Error("Session is not active");
  if (session.userId !== userId) throw new Error("Session mismatch");

  const user = await loadUserWithProfiles(userId);
  if (!user) throw new Error("User not found");
  assertActiveUser(user, claims);
  getProfileId(user);
  return { session, user };
}

function actorFromUser(sessionId: string, user: NonNullable<UserWithProfiles>): AuthActor {
  const profile = mapPostgresUserToLegacyProfile(user) as Record<string, unknown>;
  const profileId = getProfileId(user);
  return {
    userId: user.id,
    sessionId,
    role: user.role,
    profileId,
    ...(user.role === "ADMIN" ? { adminId: profileId } : {}),
    ...(user.role === "ACCOUNTANT" ? { accountantId: profileId } : {}),
    ...(user.role === "STAFF" || user.role === "RSM" || user.role === "ASM" ? { staffId: profileId } : {}),
    ...(user.role === "DEALER" ? { dealerId: profileId } : {}),
    email: user.email,
    displayName: String(profile.name ?? profile.staff_name ?? profile.Dealer_Name ?? profile.ADMIN_NAME ?? ""),
  };
}

export async function requireAuth(): Promise<AuthActor> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_COOKIE)?.value;
  if (!token) throw new Error("Unauthenticated");
  const claims = verifyAccessToken(token);
  const { session, user } = await loadActiveSession(claims);
  return actorFromUser(session.id, user);
}

export async function requireRole(roles: AuthRole | AuthRole[]) {
  const actor = await requireAuth();
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!allowed.includes(actor.role)) throw new Error("Forbidden");
  return actor;
}

export async function currentProfileForAccessToken(token: string) {
  const claims = verifyAccessToken(token);
  const { user } = await loadActiveSession(claims);
  return mapPostgresUserToLegacyProfile(user);
}

export async function rotateRefreshToken(refreshToken: string, request?: NextRequest) {
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const session = await prisma.authSession.findUnique({ where: { refreshTokenHash } });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) throw new Error("Invalid refresh token");

  const user = await loadUserWithProfiles(session.userId);
  if (!user) throw new Error("User not found");
  assertActiveUser(user);
  getProfileId(user);

  const nextRefreshToken = generateRefreshToken();
  const nextRefreshTokenHash = hashRefreshToken(nextRefreshToken);
  const updated = await prisma.authSession.update({
    where: { id: session.id },
    data: {
      refreshTokenHash: nextRefreshTokenHash,
      lastUsedAt: new Date(),
    },
  });

  await writeAuthAuditLog({
    sessionId: updated.id,
    userId: user.id,
    role: user.role,
    eventType: "TOKEN_REFRESHED",
    request,
  });

  return {
    session: updated,
    accessToken: signAccessToken({ userId: user.id, sessionId: updated.id, role: user.role, tokenVersion: user.tokenVersion }),
    refreshToken: nextRefreshToken,
  };
}

export async function revokeSession(sessionId: string, request?: NextRequest) {
  const session = await prisma.authSession.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
    include: { user: true },
  });
  await writeAuthAuditLog({
    sessionId: session.id,
    userId: session.userId,
    role: session.user.role,
    eventType: "LOGOUT",
    request,
  });
}
