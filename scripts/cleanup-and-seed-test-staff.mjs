/**
 * Cleanup script: Remove all staff (RSM/ASM/STAFF) users and their data,
 * keep NSM as-is, keep ADMIN and DEALER as-is,
 * then create test staff hierarchy for manual testing.
 *
 * Hierarchy:
 *   NSM (existing, id=76, asm@test.com)
 *     └── RSM: northrsm@test.com (NORTH_1)
 *           └── ASM: testasm@test.com
 *                 └── SM: testsm@test.com (staffRoleType=2)
 *                 └── Staff: teststaff@test.com (staffRoleType=1)
 *
 * Usage: node scripts/cleanup-and-seed-test-staff.mjs
 */

import { PrismaClient } from './prisma.mjs';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

const prisma = new PrismaClient();
const scrypt = promisify(scryptCallback);

function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

async function main() {
  console.log('=== Starting Staff Cleanup & Test Seed ===\n');

  // 1. Identify all RSM/ASM/STAFF users to delete
  const staffUsers = await prisma.user.findMany({
    where: { role: { in: ['RSM', 'ASM', 'STAFF'] }, deletedAt: null },
    include: { staffProfile: true },
  });

  const staffUserIds = staffUsers.map((u) => u.id);
  const staffProfileIds = staffUsers
    .filter((u) => u.staffProfile)
    .map((u) => u.staffProfile.id);

  console.log(`Found ${staffUsers.length} staff users to remove (RSM/ASM/STAFF)`);
  console.log(`Staff user IDs: [${staffUserIds.map(Number).join(', ')}]`);
  console.log(`Staff profile IDs: [${staffProfileIds.map(Number).join(', ')}]\n`);

  // 2. Clean up references and delete in correct order
  await prisma.$transaction(async (tx) => {
    // 2a. Nullify Order.assignedStaffId for orders referencing these staff profiles
    const ordersUpdated = await tx.order.updateMany({
      where: { assignedStaffId: { in: staffProfileIds } },
      data: { assignedStaffId: null },
    });
    console.log(`Nullified assignedStaffId on ${ordersUpdated.count} orders`);

    // 2b. Nullify CustomDiscountRequest.staffId
    const cdrsUpdated = await tx.customDiscountRequest.updateMany({
      where: { staffId: { in: staffProfileIds } },
      data: { staffId: null },
    });
    console.log(`Nullified staffId on ${cdrsUpdated.count} custom discount requests`);

    // 2c. Nullify CustomDiscountRequest.reviewedByUserId if reviewer is one of these staff users
    const cdrReviewUpdated = await tx.customDiscountRequest.updateMany({
      where: { reviewedByUserId: { in: staffUserIds } },
      data: { reviewedByUserId: null },
    });
    console.log(`Nullified reviewedByUserId on ${cdrReviewUpdated.count} custom discount requests`);

    // 2d. Delete DealerStaffAssignment records for these staff profiles
    const assignmentsDeleted = await tx.dealerStaffAssignment.deleteMany({
      where: { staffId: { in: staffProfileIds } },
    });
    console.log(`Deleted ${assignmentsDeleted.count} dealer-staff assignments`);

    // 2e. Nullify DealerProfile.rsmUserId for dealers that referenced these staff users
    const dealersUpdated = await tx.dealerProfile.updateMany({
      where: { rsmUserId: { in: staffUserIds } },
      data: { rsmUserId: null },
    });
    console.log(`Nullified rsmUserId on ${dealersUpdated.count} dealer profiles`);

    // 2f. Nullify OrderNote.actorUserId, OrderProductNote.actorUserId etc. for staff users
    await tx.orderNote.updateMany({
      where: { actorUserId: { in: staffUserIds } },
      data: { actorUserId: null },
    });
    await tx.orderProductNote.updateMany({
      where: { actorUserId: { in: staffUserIds } },
      data: { actorUserId: null },
    });
    await tx.orderSummaryOverride.updateMany({
      where: { actorUserId: { in: staffUserIds } },
      data: { actorUserId: null },
    });
    await tx.orderOverlay.updateMany({
      where: { actorUserId: { in: staffUserIds } },
      data: { actorUserId: null },
    });

    // 2g. Nullify Order.createdByUserId if created by staff
    await tx.order.updateMany({
      where: { createdByUserId: { in: staffUserIds } },
      data: { createdByUserId: null },
    });

    // 2h. Nullify DealerProfile.createdByUserId if created by staff
    await tx.dealerProfile.updateMany({
      where: { createdByUserId: { in: staffUserIds } },
      data: { createdByUserId: null },
    });

    // 2i. Nullify DealerStaffAssignment.assignedByUserId references (for any remaining assignments)
    await tx.dealerStaffAssignment.updateMany({
      where: { assignedByUserId: { in: staffUserIds } },
      data: { assignedByUserId: null },
    });

    // 2j. Delete AuthSession records for staff users
    const sessionsDeleted = await tx.authSession.deleteMany({
      where: { userId: { in: staffUserIds } },
    });
    console.log(`Deleted ${sessionsDeleted.count} auth sessions`);

    // 2k. Delete StaffProfiles
    const profilesDeleted = await tx.staffProfile.deleteMany({
      where: { id: { in: staffProfileIds } },
    });
    console.log(`Deleted ${profilesDeleted.count} staff profiles`);

    // 2l. Delete the User records
    const usersDeleted = await tx.user.deleteMany({
      where: { id: { in: staffUserIds } },
    });
    console.log(`Deleted ${usersDeleted.count} staff users`);

    console.log('\n=== Cleanup Complete ===\n');

    // 3. Create test staff hierarchy
    console.log('Creating test staff hierarchy...\n');

    // 3a. RSM: northrsm@test.com
    const rsmPassword = await hashPassword('northrsm@test.com');
    const rsmUser = await tx.user.create({
      data: {
        email: 'northrsm@test.com',
        normalizedEmail: normalizeEmail('northrsm@test.com'),
        passwordHash: rsmPassword,
        role: 'RSM',
        status: 'ACTIVE',
      },
    });
    const rsmProfile = await tx.staffProfile.create({
      data: {
        userId: rsmUser.id,
        displayName: 'North RSM (Test)',
        designation: 'Regional Sales Manager',
        location: 'Delhi',
        staffRoleType: 'RSM',
        salesRegion: 'NORTH_1',
        mobileNo: '9876543210',
      },
    });
    console.log(`Created RSM: northrsm@test.com (userId=${Number(rsmUser.id)}, staffProfileId=${Number(rsmProfile.id)})`);

    // 3b. ASM: testasm@test.com (parent RSM = northrsm)
    const asmPassword = await hashPassword('testasm@test.com');
    const asmUser = await tx.user.create({
      data: {
        email: 'testasm@test.com',
        normalizedEmail: normalizeEmail('testasm@test.com'),
        passwordHash: asmPassword,
        role: 'ASM',
        status: 'ACTIVE',
      },
    });
    const asmProfile = await tx.staffProfile.create({
      data: {
        userId: asmUser.id,
        displayName: 'Test ASM',
        designation: 'Area Sales Manager',
        location: 'Lucknow',
        staffRoleType: 'ASM',
        parentRsmId: rsmProfile.id,
        mobileNo: '9876543211',
      },
    });
    console.log(`Created ASM: testasm@test.com (userId=${Number(asmUser.id)}, staffProfileId=${Number(asmProfile.id)}, parentRsmId=${Number(rsmProfile.id)})`);

    // 3c. SM: testsm@test.com (parent ASM = testasm, parent RSM = northrsm)
    const smPassword = await hashPassword('testsm@test.com');
    const smUser = await tx.user.create({
      data: {
        email: 'testsm@test.com',
        normalizedEmail: normalizeEmail('testsm@test.com'),
        passwordHash: smPassword,
        role: 'STAFF',
        status: 'ACTIVE',
      },
    });
    const smProfile = await tx.staffProfile.create({
      data: {
        userId: smUser.id,
        displayName: 'Test SM',
        designation: 'Sales Manager',
        location: 'Lucknow',
        staffRoleType: '2', // SM = staffRoleType "2"
        parentRsmId: rsmProfile.id,
        parentAsmId: asmProfile.id,
        mobileNo: '9876543212',
      },
    });
    console.log(`Created SM: testsm@test.com (userId=${Number(smUser.id)}, staffProfileId=${Number(smProfile.id)}, parentRsmId=${Number(rsmProfile.id)}, parentAsmId=${Number(asmProfile.id)})`);

    // 3d. Staff/Executive: teststaff@test.com (parent ASM = testasm, parent RSM = northrsm)
    const staffPassword = await hashPassword('teststaff@test.com');
    const staffUser = await tx.user.create({
      data: {
        email: 'teststaff@test.com',
        normalizedEmail: normalizeEmail('teststaff@test.com'),
        passwordHash: staffPassword,
        role: 'STAFF',
        status: 'ACTIVE',
      },
    });
    const staffProfile = await tx.staffProfile.create({
      data: {
        userId: staffUser.id,
        displayName: 'Test Staff',
        designation: 'Sales Executive',
        location: 'Kanpur',
        staffRoleType: '1', // Executive/Staff = staffRoleType "1"
        parentRsmId: rsmProfile.id,
        parentAsmId: asmProfile.id,
        mobileNo: '9876543213',
      },
    });
    console.log(`Created Staff: teststaff@test.com (userId=${Number(staffUser.id)}, staffProfileId=${Number(staffProfile.id)}, parentRsmId=${Number(rsmProfile.id)}, parentAsmId=${Number(asmProfile.id)})`);

    console.log('\n=== Test Staff Seed Complete ===');
    console.log('\nTest Credentials:');
    console.log('  RSM:   northrsm@test.com / northrsm@test.com');
    console.log('  ASM:   testasm@test.com  / testasm@test.com');
    console.log('  SM:    testsm@test.com   / testsm@test.com');
    console.log('  Staff: teststaff@test.com / teststaff@test.com');
    console.log('\nNSM (unchanged): asm@test.com (userId=76)');
  });
}

main()
  .catch((e) => {
    console.error('ERROR:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
