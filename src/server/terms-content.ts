import { prisma } from "@/server/db/prisma";
import { DEFAULT_TERMS_BLOCKS, TERMS_BLOCK_TYPES, fillPlaceholders, type TermsBlock } from "@/components/terms/TermsDocument";

const KEY = "terms";

// A dealer's own document lives beside the global one; no row means they get the template.
const dealerKey = (dealerId: bigint) => `${KEY}:dealer:${dealerId}`;

// The document a dealer sees and when it last changed (null = built-in default, never edited).
export async function getDealerTerms(dealerId?: bigint): Promise<{ blocks: TermsBlock[]; updatedAt: Date | null }> {
  const own = dealerId === undefined ? null : await prisma.appSetting.findUnique({ where: { key: dealerKey(dealerId) } });
  const row = own ?? await prisma.appSetting.findUnique({ where: { key: KEY } });
  return { blocks: row ? (row.value as TermsBlock[]) : DEFAULT_TERMS_BLOCKS, updatedAt: row?.updatedAt ?? null };
}

export async function getTermsBlocks(dealerId?: bigint): Promise<TermsBlock[]> {
  return (await getDealerTerms(dealerId)).blocks;
}

// For display only: editors must get the raw placeholders, or saving would freeze today's values into the text.
export async function fillDealerFields(blocks: TermsBlock[], dealerId: bigint): Promise<TermsBlock[]> {
  const dealer = await prisma.dealerProfile.findUnique({
    where: { id: dealerId },
    select: {
      businessName: true, address: true, city: true, state: true, pincode: true, phone: true, gstin: true,
      discountPercent: true, annualTargetPaise: true, creditLimitPaise: true, creditDays: true,
    },
  });
  if (!dealer) return blocks;
  const rupees = (paise: bigint | null) => (paise === null ? null : `₹${(Number(paise) / 100).toLocaleString("en-IN")}`);
  return fillPlaceholders(blocks, {
    "[DEALER NAME]": dealer.businessName,
    "[DEALER ADDRESS]": [dealer.address, dealer.city, dealer.state, dealer.pincode].filter((part) => part?.trim()).join(", "),
    "[MOBILE NUMBER]": dealer.phone,
    "[DEALER GST]": dealer.gstin,
    // Characters 3-12 of a GSTIN are the holder's PAN.
    "[DEALER PAN]": dealer.gstin?.trim().length === 15 ? dealer.gstin.trim().slice(2, 12) : null,
    "[DISCOUNT]": dealer.discountPercent === null ? null : `${Number(dealer.discountPercent)}%`,
    "[TARGET]": rupees(dealer.annualTargetPaise),
    "[CREDIT LIMIT]": rupees(dealer.creditLimitPaise),
    "[CREDIT DAYS]": dealer.creditDays === null ? null : `${dealer.creditDays} DAYS`,
  });
}

// True when the document changed after the dealer accepted it; never-accepted dealers get the login modal instead.
export function isTermsUpdatedSinceAccepted(updatedAt: Date | null, acceptedAt: Date | null | undefined) {
  return Boolean(updatedAt && acceptedAt && updatedAt > acceptedAt);
}

export async function dealerTermsUpdatedAt(dealerId: bigint): Promise<Date | null> {
  const [{ updatedAt }, profile] = await Promise.all([
    getDealerTerms(dealerId),
    prisma.dealerProfile.findUnique({ where: { id: dealerId }, select: { termsAcceptedAt: true, termsActive: true } }),
  ]);
  if (profile?.termsActive === false) return null;
  return isTermsUpdatedSinceAccepted(updatedAt, profile?.termsAcceptedAt) ? updatedAt : null;
}

// Returns null when the payload isn't a list of known blocks; blank blocks are dropped.
export function parseTermsBlocks(input: unknown): TermsBlock[] | null {
  if (!Array.isArray(input) || input.length > 500) return null;
  const blocks: TermsBlock[] = [];
  for (const item of input) {
    const type = item?.type;
    const text = item?.text;
    if (!TERMS_BLOCK_TYPES.includes(type) || typeof text !== "string" || text.length > 20000) return null;
    if (text.trim()) blocks.push({ type, text: text.trim() });
  }
  return blocks;
}

export async function saveTermsBlocks(blocks: TermsBlock[], dealerId?: bigint) {
  const key = dealerId === undefined ? KEY : dealerKey(dealerId);
  // A no-op save must not bump updatedAt, or dealers get an "updated" notice for nothing.
  // Compared as tuples because jsonb doesn't keep key order.
  const flat = (list: TermsBlock[]) => JSON.stringify(list.map((block) => [block.type, block.text]));
  const current = await prisma.appSetting.findUnique({ where: { key } });
  if (current && flat(current.value as TermsBlock[]) === flat(blocks)) return;
  if (dealerId === undefined) await keepAcceptedVersion(current);
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: blocks },
    update: { value: blocks },
  });
}

// Before the template changes, every dealer who accepted it gets their own copy, so what
// they accepted never changes under them. updatedAt carries over, so a dealer who hadn't
// re-accepted the last edit still gets that "updated" notice and nobody gets a new one.
// Dealers who already have their own document are left alone (skipDuplicates).
// ponytail: a dealer accepting between this and the template write follows the new
// version; wrap both in one transaction if that window ever matters.
async function keepAcceptedVersion(template: { value: unknown; updatedAt: Date } | null) {
  const accepted = await prisma.dealerProfile.findMany({
    where: { termsAcceptedAt: { not: null } },
    select: { id: true, termsAcceptedAt: true },
  });
  if (!accepted.length) return;
  await prisma.appSetting.createMany({
    data: accepted.map((dealer) => ({
      key: dealerKey(dealer.id),
      value: template ? (template.value as TermsBlock[]) : DEFAULT_TERMS_BLOCKS,
      updatedAt: template?.updatedAt ?? dealer.termsAcceptedAt!,
    })),
    skipDuplicates: true,
  });
}
