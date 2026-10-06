import { prisma } from "@/server/db/prisma";
import { DEFAULT_TERMS_BLOCKS, TERMS_BLOCK_TYPES, type TermsBlock } from "@/components/terms/TermsDocument";

const KEY = "terms";

export async function getTermsBlocks(): Promise<TermsBlock[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  return row ? (row.value as TermsBlock[]) : DEFAULT_TERMS_BLOCKS;
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

export async function saveTermsBlocks(blocks: TermsBlock[]) {
  await prisma.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: blocks },
    update: { value: blocks },
  });
}
