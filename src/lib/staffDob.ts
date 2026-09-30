export const MIN_STAFF_AGE = 18;

/** Latest yyyy-mm-dd a staff member can be born on and still be 18 today. */
export function adultDobCutoff(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  // Plain string, not a Date: a 29 Feb "today" must not roll over to 1 Mar.
  return `${now.getFullYear() - MIN_STAFF_AGE}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const isAdultDob = (isoDob: string, now = new Date()) => isoDob.slice(0, 10) <= adultDobCutoff(now);
