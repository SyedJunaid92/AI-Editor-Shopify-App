import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
}

/**
 * Neon’s pooled host plus Prisma’s own pool times out on Vercel
 * (connection limit 5, pool timeout 10s). One connection per lambda,
 * with PgBouncer mode, is what this serverless runtime can hold.
 */
function serverlessDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    url.searchParams.delete("channel_binding");
    if (url.hostname.includes("-pooler")) {
      url.searchParams.set("pgbouncer", "true");
    }
    url.searchParams.set("connection_limit", "1");
    url.searchParams.set("pool_timeout", "20");
    if (!url.searchParams.has("sslmode")) {
      url.searchParams.set("sslmode", "require");
    }
    return url.toString();
  } catch {
    return raw;
  }
}

function createPrismaClient() {
  const url = serverlessDatabaseUrl();
  if (url) process.env.DATABASE_URL = url;
  return url
    ? new PrismaClient({ datasources: { db: { url } } })
    : new PrismaClient();
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = createPrismaClient();
  }
}

const prisma = global.prismaGlobal ?? createPrismaClient();

export default prisma;
