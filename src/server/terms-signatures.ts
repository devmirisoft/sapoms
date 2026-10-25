import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { AuthActor } from "@/server/auth/session";
import { isAdminLike, isStaffLike } from "@/server/auth/sales-scope";
import { fillDealerFields, getDealerTerms } from "@/server/terms-content";
import type { SignatureView, TermsBlock } from "@/components/terms/TermsDocument";

// Who signs a slot, read from its label: "Dealer signature" -> the dealer, "Sales person's signature" ->
// staff assigned to the dealer, anything else (e.g. "Authorized Signatory") -> an admin.
export function slotSigner(slot: string): "DEALER" | "SALES" | "ADMIN" {
  return /dealer/i.test(slot) ? "DEALER" : /sales/i.test(slot) ? "SALES" : "ADMIN";
}

function signatureSlots(blocks: TermsBlock[]) {
  const labels = blocks.filter((block) => block.type === "sign").flatMap((block) => block.text.split("\n"));
  return [...new Set(labels.map((label) => label.trim()).filter(Boolean))];
}

async function isAssignedStaff(actor: AuthActor, dealerId: bigint) {
  if (!isStaffLike(actor) || !actor.staffId) return false;
  const assignments = await prisma.dealerStaffAssignment.count({ where: { staffId: actor.staffId, dealerId, active: true, removedAt: null } });
  return assignments > 0;
}

// Admins see every agreement; staff only those of dealers assigned to them.
export async function canViewAgreement(actor: AuthActor, dealerId: bigint) {
  return isAdminLike(actor) || isAssignedStaff(actor, dealerId);
}

async function canSignSlot(actor: AuthActor, dealerId: bigint, slot: string) {
  const signer = slotSigner(slot);
  if (signer === "DEALER") return actor.role === "DEALER" && actor.dealerId === dealerId;
  if (signer === "SALES") return isAssignedStaff(actor, dealerId);
  return actor.role === "ADMIN";
}

// The newest signature per slot, ignoring any made before the document's last edit.
async function currentSignatures(dealerId: bigint, documentUpdatedAt: Date | null) {
  const rows = await prisma.termsSignature.findMany({
    where: { dealerId, ...(documentUpdatedAt ? { signedAt: { gt: documentUpdatedAt } } : {}) },
    orderBy: { signedAt: "desc" },
    select: { slot: true, image: true, signerName: true, signedAt: true },
  });
  const latest: Record<string, SignatureView> = {};
  for (const row of rows) latest[row.slot] ??= { image: row.image, signerName: row.signerName, signedAt: row.signedAt.toISOString() };
  return latest;
}

// A dealer's document as `actor` sees it: dealer values filled in, current signatures,
// and the unsigned slots `actor` may sign.
export async function agreementView(actor: AuthActor, dealerId: bigint) {
  const terms = await getDealerTerms(dealerId);
  const [blocks, signatures] = await Promise.all([fillDealerFields(terms.blocks, dealerId), currentSignatures(dealerId, terms.updatedAt)]);
  const open = signatureSlots(blocks).filter((slot) => !signatures[slot]);
  const allowed = await Promise.all(open.map((slot) => canSignSlot(actor, dealerId, slot)));
  return { blocks, signatures, signable: open.filter((_, i) => allowed[i]), updatedAt: terms.updatedAt };
}

// signature_pad's PNG export. The cap stops a scripted client from storing megabytes per row.
const SIGNATURE_PREFIX = "data:image/png;base64,";
export function parseSignatureImage(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 300_000 || !input.startsWith(SIGNATURE_PREFIX)) return null;
  return /^[A-Za-z0-9+/]+=*$/.test(input.slice(SIGNATURE_PREFIX.length)) ? input : null;
}

export async function recordSignatures(
  db: Pick<Prisma.TransactionClient, "termsSignature">,
  { actor, dealerId, slots, image, document, ip }: { actor: AuthActor; dealerId: bigint; slots: string[]; image: string; document: TermsBlock[]; ip: string | null },
) {
  await db.termsSignature.createMany({
    data: slots.map((slot) => ({
      dealerId,
      slot,
      signerUserId: actor.userId,
      signerRole: actor.role,
      signerName: actor.displayName,
      image,
      document,
      ip,
    })),
  });
}
