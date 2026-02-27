import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { tmdbCache } from "@/server/db/schema";

type WatchUpdateRecord = {
  reason: string;
  at: number;
  nonce: string;
};

const WATCH_UPDATE_TTL_MS = 24 * 60 * 60 * 1000;
const watchUpdateKey = (userId: string) => `watch:updates:${userId}`;

function isWatchUpdateRecord(value: unknown): value is WatchUpdateRecord {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.reason === "string" &&
    typeof obj.at === "number" &&
    typeof obj.nonce === "string"
  );
}

export async function readLatestWatchUpdate(userId: string) {
  const db = getDb();
  const rows = await db
    .select({
      payload: tmdbCache.payload,
      expiresAt: tmdbCache.expiresAt,
    })
    .from(tmdbCache)
    .where(eq(tmdbCache.key, watchUpdateKey(userId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const expiresAt = new Date(row.expiresAt).getTime();
  if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) return null;
  return isWatchUpdateRecord(row.payload) ? row.payload : null;
}

export function publishWatchUpdates(userIds: string[], reason: string) {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) return;

  void (async () => {
    try {
      const db = getDb();
      const now = new Date();
      const at = now.getTime();
      const expiresAt = new Date(at + WATCH_UPDATE_TTL_MS);
      await Promise.all(
        unique.map((userId) => {
          const payload: WatchUpdateRecord = {
            reason,
            at,
            nonce: `${at}:${Math.random().toString(36).slice(2)}`,
          };
          return db
            .insert(tmdbCache)
            .values({
              key: watchUpdateKey(userId),
              payload,
              expiresAt,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: tmdbCache.key,
              set: {
                payload,
                expiresAt,
                updatedAt: now,
              },
            });
        })
      );
    } catch (error) {
      console.warn("publish watch update failed", { reason, error });
    }
  })();
}
