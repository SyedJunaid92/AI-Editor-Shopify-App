import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { RedisSessionStorage } from "@shopify/shopify-app-session-storage-redis";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import prisma from "./db.server";

/**
 * Shopify sessions (OAuth tokens) live in Prisma/Postgres by default.
 * On Vercel, set DATABASE_URL to a hosted Postgres database.
 *
 * REDIS_URL is optional. Use it (including Upstash rediss://) if you want
 * sessions in Redis instead of Postgres.
 */
export function createSessionStorage(): SessionStorage {
  const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL;
  if (redisUrl) {
    return new RedisSessionStorage(redisUrl);
  }
  return new PrismaSessionStorage(prisma);
}
