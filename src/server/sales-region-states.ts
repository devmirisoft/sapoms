import type { Prisma } from "@prisma/client";

// A region's states. With an RSM, they are that RSM's allotted states (Manage
// Regions edits the RSM row). A region with no RSM keeps its list here, so ASMs
// and Sales Managers can still be given territory there before an RSM exists.
const KEY = "sales_region_states";

type Db = Pick<Prisma.TransactionClient, "appSetting" | "staffProfile">;
export type RegionStates = Record<string, string[]>;

export async function getRegionStates(db: Db): Promise<RegionStates> {
  const [row, rsms] = await Promise.all([
    db.appSetting.findUnique({ where: { key: KEY } }),
    // A deactivated RSM still holds its region, so its states still define it.
    db.staffProfile.findMany({
      where: { salesRegion: { not: null }, user: { role: "RSM", deletedAt: null } },
      select: { salesRegion: true, assignedStates: true },
    }),
  ]);
  const states: RegionStates = { ...((row?.value ?? {}) as RegionStates) };
  for (const rsm of rsms) if (rsm.salesRegion) states[rsm.salesRegion] = rsm.assignedStates;
  return states;
}

export async function saveRegionStates(db: Pick<Prisma.TransactionClient, "appSetting">, region: string, states: string[]) {
  const row = await db.appSetting.findUnique({ where: { key: KEY } });
  const value = { ...((row?.value ?? {}) as RegionStates), [region]: states };
  await db.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}
