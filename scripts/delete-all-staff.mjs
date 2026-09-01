/**
 * Delete every staff-directory user (NSM/RSM/ASM/STAFF) and their profiles.
 * ADMIN, ACCOUNTANT and DEALER users are untouched.
 *
 * Only dealer_staff_assignments (RESTRICT) and admin_profiles (RESTRICT, where
 * NSM profiles live) need explicit deletes -- every other FK to users/staff_profiles
 * is ON DELETE SET NULL or CASCADE, so orders, notes and discount requests are
 * kept with their staff reference nulled by Postgres.
 *
 * Usage: node scripts/delete-all-staff.mjs
 */
import { PrismaClient } from './prisma.mjs';

const prisma = new PrismaClient();
const ROLES = ['NSM', 'RSM', 'ASM', 'STAFF'];

async function main() {
  const userIds = (await prisma.user.findMany({ where: { role: { in: ROLES } }, select: { id: true } })).map((u) => u.id);
  console.log(`Deleting ${userIds.length} staff users`);
  if (!userIds.length) return;

  await prisma.$transaction(async (tx) => {
    const profileIds = (await tx.staffProfile.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((p) => p.id);
    console.log('assignments:   ', (await tx.dealerStaffAssignment.deleteMany({ where: { staffId: { in: profileIds } } })).count);
    console.log('staff profiles:', (await tx.staffProfile.deleteMany({ where: { userId: { in: userIds } } })).count);
    console.log('nsm profiles:  ', (await tx.adminProfile.deleteMany({ where: { userId: { in: userIds } } })).count);
    console.log('users:         ', (await tx.user.deleteMany({ where: { id: { in: userIds } } })).count);
  });
}

main()
  .catch((e) => { console.error('ERROR:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
