import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
let prismaClient: PrismaClient | undefined;

function createClient() {
  // Prisma CLI migrations use DATABASE_URL (direct Neon connection).
  // Runtime requests prefer DATABASE_URL_POOLED to avoid exhausting DB connections.
  const connectionString = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL or DATABASE_URL_POOLED is not configured");
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

/**
 * Create Prisma lazily. Vercel/Next.js evaluates route modules during build,
 * when production secrets are intentionally unavailable. Database credentials
 * are required only when a request actually accesses a Prisma delegate.
 */
function getClient() {
  const existing = prismaClient ?? globalForPrisma.prisma;
  if (existing) return existing;

  const created = createClient();
  prismaClient = created;
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = created;
  return created;
}

export const db = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getClient();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  }
});
