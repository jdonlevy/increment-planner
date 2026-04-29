import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { Pool } from "@neondatabase/serverless";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

function getConnectionString() {
  return (
    process.env.PRISMA_DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    ""
  );
}

function createClient() {
  const connectionString = getConnectionString();
  if (!connectionString) {
    throw new Error(
      `No DB connection string found. Checked: PRISMA_DATABASE_URL, POSTGRES_URL, DATABASE_URL`
    );
  }
  const pool = new Pool({ connectionString });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapter = new PrismaNeon(pool as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PrismaClient({ adapter } as any);
}

export const prisma = global.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") global.prisma = prisma;
