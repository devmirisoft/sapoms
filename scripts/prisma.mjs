import "dotenv/config";
import { PrismaClient as BasePrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 requires a driver adapter and no longer auto-loads .env.
export class PrismaClient extends BasePrismaClient {
  constructor(options = {}) {
    super({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
      ...options,
    });
  }
}
