/**
 * Seeds the NSM -> RSM -> ASM -> SM -> Staff test hierarchy in Haryana/Ambala.
 * Password of each account is its own email, verbatim (case-sensitive).
 * Re-running deletes and recreates the four accounts.
 *
 * Note: the schema has no "reports to SM" link. A Staff (staffRoleType "2")
 * hangs off an RSM directly, so Staff Test is parented to RSM Test.
 *
 * Usage: node scripts/seed-hierarchy-test-users.mjs
 */
import { PrismaClient } from './prisma.mjs';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';

const places = JSON.parse(readFileSync(new URL('../public/data/places.json', import.meta.url), 'utf8'));
const regions = [...(places.states ?? []), ...(places.union_territories ?? [])];
const citiesForStates = (states) => regions.filter((r) => states.includes(r.name)).flatMap((r) => r.cities ?? []);
const statesForCities = (cities, withinStates) => withinStates.filter((state) =>
  (regions.find((r) => r.name === state)?.cities ?? []).some((city) => cities.includes(city)));

const prisma = new PrismaClient();
const scrypt = promisify(scryptCallback);

async function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  return `scrypt:${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
}

const common = {
  location: 'Ambala',
  nationality: 'Indian',
  qualification: 'Graduate',
  permanentAddressCity: 'Ambala, Haryana',
};

const people = [
  {
    email: 'rsmtest@rsmtest.com', name: 'RSM Test', designation: 'RSM', role: 'RSM', staffRoleType: 'RSM',
    mobileNo: '9876501001', alternateNo: '9876502001', gender: 'Male', dob: '1990-05-15', maritalStatus: 'Married',
    emergencyContactNo1: '9876503001', emergencyContactNo2: '9876504001',
    permanentAddress: `RSM Test, ${common.permanentAddressCity}`, localAddress: 'Ambala Cantt, Haryana',
    salesRegion: 'NORTH_1', assignedStates: ['Haryana'],
  },
  {
    email: 'asmtest@asmtest.com', name: 'ASM Test', designation: 'ASM', role: 'ASM', staffRoleType: 'ASM',
    mobileNo: '9876501002', alternateNo: '9876502002', gender: 'Male', dob: '1992-07-20', maritalStatus: 'Single',
    emergencyContactNo1: '9876503002', emergencyContactNo2: '9876504002',
    permanentAddress: `ASM Test, ${common.permanentAddressCity}`, localAddress: 'Ambala City, Haryana',
    assignedStates: ['Haryana'],
  },
  {
    email: 'smtest@smtest.com', name: 'SM Test', designation: 'SM', role: 'STAFF', staffRoleType: '1',
    mobileNo: '9876501003', alternateNo: '9876502003', gender: 'Male', dob: '1994-03-10', maritalStatus: 'Single',
    emergencyContactNo1: '9876503003', emergencyContactNo2: '9876504003',
    permanentAddress: `SM Test, ${common.permanentAddressCity}`, localAddress: 'Ambala Cantt, Haryana',
    assignedCities: ['Ambala'],
  },
  {
    email: 'stest@stest.com', name: 'Staff Test', designation: 'Staff', role: 'STAFF', staffRoleType: '2',
    mobileNo: '9876501004', alternateNo: '9876502004', gender: 'Female', dob: '1996-11-25', maritalStatus: 'Single',
    emergencyContactNo1: '9876503004', emergencyContactNo2: '9876504004',
    permanentAddress: `Staff Test, ${common.permanentAddressCity}`, localAddress: 'Ambala City, Haryana',
    warehouse: 'AMBALA',
  },
];

async function createOne(tx, person, { parentRsmId = null, parentAsmId = null, reportingManagerId = null }) {
  const normalizedEmail = person.email.trim().toLowerCase();
  const user = await tx.user.create({
    data: {
      email: normalizedEmail,
      normalizedEmail,
      username: normalizedEmail,
      normalizedUsername: normalizedEmail,
      passwordHash: await hashPassword(person.email),
      role: person.role,
      status: 'ACTIVE',
    },
  });
  return tx.staffProfile.create({
    data: {
      userId: user.id,
      parentRsmId,
      parentAsmId,
      reportingManagerId,
      displayName: person.name,
      designation: person.designation,
      location: common.location,
      mobileNo: person.mobileNo,
      alternateNo: person.alternateNo,
      permanentAddress: person.permanentAddress,
      localAddress: person.localAddress,
      gender: person.gender,
      dob: new Date(`${person.dob}T00:00:00.000Z`),
      nationality: common.nationality,
      maritalStatus: person.maritalStatus,
      qualification: common.qualification,
      emergencyContactNo1: person.emergencyContactNo1,
      emergencyContactNo2: person.emergencyContactNo2,
      staffRoleType: person.staffRoleType,
      salesRegion: person.salesRegion ?? null,
      warehouse: person.warehouse ?? null,
      assignedStates: person.assignedStates ?? [],
      assignedCities: person.assignedCities ?? [],
    },
  });
}

async function createNsm() {
  const email = 'nsmtest@nsmtest.com';
  const user = await prisma.user.upsert({
    where: { normalizedEmail: email },
    update: { role: 'NSM', status: 'ACTIVE', deletedAt: null, passwordHash: await hashPassword(email) },
    create: {
      email, normalizedEmail: email, username: email, normalizedUsername: email,
      passwordHash: await hashPassword(email), role: 'NSM', status: 'ACTIVE',
    },
  });
  const profile = await prisma.adminProfile.upsert({
    where: { userId: user.id },
    update: { displayName: 'NSM Test' },
    create: { userId: user.id, displayName: 'NSM Test', phone: '9876501000' },
    select: { id: true, displayName: true, user: { select: { email: true } } },
  });
  console.log(`NSM   ${email} created (no active NSM existed)`);
  return profile;
}

async function main() {
  const emails = people.map((p) => p.email.toLowerCase());

  // The RSM must report to an NSM; seed one when the instance has none.
  const nsm = await prisma.adminProfile.findFirst({
    where: { user: { role: 'NSM', status: 'ACTIVE', deletedAt: null } },
    select: { id: true, displayName: true, user: { select: { email: true } } },
  }) ?? await createNsm();

  await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findMany({ where: { normalizedEmail: { in: emails } }, select: { id: true } });
    const ids = existing.map((u) => u.id);
    if (ids.length) {
      await tx.authSession.deleteMany({ where: { userId: { in: ids } } });
      await tx.staffProfile.deleteMany({ where: { userId: { in: ids } } });
      await tx.user.deleteMany({ where: { id: { in: ids } } });
      console.log(`Removed ${ids.length} pre-existing test account(s)`);
    }

    const [rsmSpec, asmSpec, smSpec, staffSpec] = people;

    const rsm = await createOne(tx, rsmSpec, { reportingManagerId: nsm.id });
    console.log(`RSM   ${rsmSpec.email} -> NSM ${nsm.displayName} (${nsm.user.email})`);

    // ASM states must sit inside the RSM's states.
    const outside = asmSpec.assignedStates.filter((s) => !rsm.assignedStates.includes(s));
    if (outside.length) throw new Error(`ASM states outside RSM scope: ${outside.join(', ')}`);
    const asm = await createOne(tx, asmSpec, { parentRsmId: rsm.id });
    console.log(`ASM   ${asmSpec.email} -> RSM ${rsm.displayName}, states ${asm.assignedStates.join(', ')}`);

    // SM cities come out of the ASM's states; its RSM is resolved from the ASM.
    const allowed = citiesForStates(asm.assignedStates);
    const badCities = smSpec.assignedCities.filter((c) => !allowed.includes(c));
    if (badCities.length) throw new Error(`SM cities outside ASM scope: ${badCities.join(', ')}`);
    smSpec.assignedStates = statesForCities(smSpec.assignedCities, asm.assignedStates);
    const sm = await createOne(tx, smSpec, { parentAsmId: asm.id, parentRsmId: asm.parentRsmId });
    console.log(`SM    ${smSpec.email} -> ASM ${asm.displayName}, RSM auto-resolved ${sm.parentRsmId === rsm.id ? 'OK' : 'MISMATCH'}, cities ${sm.assignedCities.join(', ')}, states ${sm.assignedStates.join(', ')}`);

    const staff = await createOne(tx, staffSpec, { parentRsmId: rsm.id });
    console.log(`Staff ${staffSpec.email} -> RSM ${rsm.displayName} (schema has no SM parent link; profile ${staff.id})`);
  });

  console.log('\nAll four passwords are the email verbatim, including capitals.');
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
