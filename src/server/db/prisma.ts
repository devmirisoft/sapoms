import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prismaGlobal = globalThis as typeof globalThis & {
  __omsonsPrisma?: PrismaClient;
};

export const prisma =
  prismaGlobal.__omsonsPrisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

if (process.env.NODE_ENV !== "production") {
  prismaGlobal.__omsonsPrisma = prisma;
}
