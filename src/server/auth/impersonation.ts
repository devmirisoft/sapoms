// Admin -> dealer impersonation as pause-and-resume of two real sessions.
//
// Start: the admin's session A is "parked" (its refresh hash swapped for one nobody holds, so it
// can't be refreshed and loadActiveSession refuses it), and an auth_impersonations row links A to
// the new dealer session B. The browser gets only an opaque restoration token; the row keeps its hash.
// Restore: the dealer session presents that token on logout; the row is claimed once, A and its
// admin are re-validated, and A gets a fresh refresh token. A's expiry is never extended.
//
// Only type imports, and every dependency is passed in, so tests run this against an in-memory db.
import type { PrismaClient } from "@prisma/client";
import type { AuthRole } from "./providers/types";

export const IMPERSONATION_TTL_MS = 12 * 60 * 60 * 1000;

export type ImpersonationDeps = {
  db: Pick<PrismaClient, "authSession" | "authImpersonation" | "user" | "$transaction">;
  hashToken: (token: string) => string;
  generateToken: () => string;
  issueAccessToken: (input: { userId: bigint; sessionId: string; role: AuthRole; tokenVersion: number }) => string;
  now?: () => Date;
};

export class ImpersonationError extends Error {
  readonly code: "admin_session_inactive" | "admin_session_changed";
  constructor(code: ImpersonationError["code"]) {
    super(code);
    this.code = code;
  }
}

export type RestoreFailureReason =
  | "invalid_or_used"
  | "session_revoked"
  | "session_expired"
  | "admin_inactive"
  | "role_changed"
  | "token_version_changed";

export type RestoreResult =
  | { ok: true; impersonationId: string; adminSessionId: string; adminUserId: bigint; adminRole: AuthRole; accessToken: string; refreshToken: string }
  | { ok: false; reason: RestoreFailureReason; impersonationId?: string; adminSessionId?: string; adminUserId?: bigint; adminRole?: AuthRole };

export async function startImpersonation(
  deps: ImpersonationDeps,
  input: { adminSessionId: string; adminRefreshToken: string; dealerSessionId: string },
) {
  const now = (deps.now ?? (() => new Date()))();
  const restorationToken = deps.generateToken();

  return deps.db.$transaction(async (tx) => {
    const admin = await tx.authSession.findUnique({ where: { id: input.adminSessionId } });
    if (!admin || admin.revokedAt || admin.expiresAt <= now) throw new ImpersonationError("admin_session_inactive");
    const adminUser = await tx.user.findUnique({ where: { id: admin.userId }, select: { tokenVersion: true } });
    if (!adminUser) throw new ImpersonationError("admin_session_inactive");

    // Compare-and-set on the refresh token this browser presented: proves it holds A, and a second
    // concurrent start (double click) finds the hash already parked and fails instead of forking A.
    const parked = await tx.authSession.updateMany({
      where: { id: admin.id, refreshTokenHash: deps.hashToken(input.adminRefreshToken), revokedAt: null, expiresAt: { gt: now } },
      data: { refreshTokenHash: deps.hashToken(deps.generateToken()) },
    });
    if (parked.count !== 1) throw new ImpersonationError("admin_session_changed");

    // The dealer session lives no longer than the impersonation, which never outlives A.
    const expiresAt = new Date(Math.min(admin.expiresAt.getTime(), now.getTime() + IMPERSONATION_TTL_MS));
    await tx.authSession.update({ where: { id: input.dealerSessionId }, data: { expiresAt } });

    const record = await tx.authImpersonation.create({
      data: {
        adminSessionId: admin.id,
        dealerSessionId: input.dealerSessionId,
        adminTokenVersion: adminUser.tokenVersion,
        restorationTokenHash: deps.hashToken(restorationToken),
        expiresAt,
      },
    });

    return { impersonationId: record.id, restorationToken, expiresAt };
  });
}

export async function restoreImpersonation(
  deps: ImpersonationDeps,
  input: { restorationToken: string; dealerSessionId: string },
): Promise<RestoreResult> {
  const now = (deps.now ?? (() => new Date()))();
  if (!input.restorationToken) return { ok: false, reason: "invalid_or_used" };
  const restorationTokenHash = deps.hashToken(input.restorationToken);

  // All or nothing. A genuine failure *returns*, committing the spent token and the revoked admin
  // session. An unexpected error (database or network) *throws*, rolling the claim back so the
  // same restoration token still works when logout is retried.
  return deps.db.$transaction(async (db): Promise<RestoreResult> => {
    // The claim is the single-use gate: one conditional UPDATE, so of two concurrent logouts only one
    // matches. A token from another dealer session, an expired row, or a used one matches nothing.
    const claimed = await db.authImpersonation.updateMany({
      where: { restorationTokenHash, dealerSessionId: input.dealerSessionId, endedAt: null, expiresAt: { gt: now } },
      data: { endedAt: now },
    });
    if (claimed.count !== 1) return { ok: false, reason: "invalid_or_used" };

    const record = await db.authImpersonation.findUnique({ where: { restorationTokenHash } });
    if (!record) return { ok: false, reason: "invalid_or_used" };
    const base = { impersonationId: record.id, adminSessionId: record.adminSessionId };

    const session = await db.authSession.findUnique({ where: { id: record.adminSessionId } });
    if (!session || session.revokedAt) return { ok: false, reason: "session_revoked", ...base };

    // A is parked and unusable; once restore genuinely fails it is revoked so nothing can revive it.
    const fail = async (reason: RestoreFailureReason, adminRole?: AuthRole): Promise<RestoreResult> => {
      await db.authSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: now } });
      return { ok: false, reason, ...base, adminUserId: session.userId, adminRole };
    };

    if (session.expiresAt <= now) return fail("session_expired");
    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: { id: true, role: true, status: true, deletedAt: true, tokenVersion: true },
    });
    if (!user || user.deletedAt || user.status !== "ACTIVE") return fail("admin_inactive", user?.role);
    if (user.role !== "ADMIN") return fail("role_changed", user.role);
    // A password change (or forced sign-out) during the impersonation bumps tokenVersion: log in again.
    if (user.tokenVersion !== record.adminTokenVersion) return fail("token_version_changed", user.role);

    const refreshToken = deps.generateToken();
    const unparked = await db.authSession.updateMany({
      where: { id: session.id, revokedAt: null, expiresAt: { gt: now } },
      data: { refreshTokenHash: deps.hashToken(refreshToken), lastUsedAt: now },
    });
    if (unparked.count !== 1) return { ok: false, reason: "session_revoked", ...base, adminUserId: user.id, adminRole: user.role };

    return {
      ok: true,
      ...base,
      adminUserId: user.id,
      adminRole: user.role,
      accessToken: deps.issueAccessToken({ userId: user.id, sessionId: session.id, role: user.role, tokenVersion: user.tokenVersion }),
      refreshToken,
    };
  });
}
