/**
 * The NSM rows (admin_profiles) lead the combined staff list, so the staff
 * query has to skip whichever of them this page already consumed and shrink
 * its take by however many it shows.
 */
export function staffPageWindow(nsmCount: number, skip: number, take: number) {
  return {
    skip: Math.max(0, skip - nsmCount),
    take: take - Math.max(0, Math.min(take, nsmCount - skip)),
  };
}
