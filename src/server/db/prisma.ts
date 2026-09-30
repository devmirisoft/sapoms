import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prismaGlobal = globalThis as typeof globalThis & {
  __omsonsPrisma?: PrismaClient;
};

export const prisma =
  prismaGlobal.__omsonsPrisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    // ponytail: dev talks to the Render DB at ~270ms/round trip, and discount approval
    // (~70 round trips) takes ~21s. Same-region prod is ms. Drop this once dev uses a local DB.
    transactionOptions: { maxWait: 10_000, timeout: 60_000 },
  });

if (process.env.NODE_ENV !== "production") {
  prismaGlobal.__omsonsPrisma = prisma;
}
