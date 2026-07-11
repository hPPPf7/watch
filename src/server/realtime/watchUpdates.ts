import crypto from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { getAuthDb, getDb } from "@/server/db/client";
import {
  publishWatchUpdateEvent,
  type WatchUpdateEvent,
} from "@/server/realtime/watchEventBus";
import { runDeferredPublish } from "@/server/realtime/deferredPublish";
import { readRedisJson, writeRedisJson } from "@/server/realtime/redis";
import { friends, profiles, tmdbCache } from "@/server/db/schema";

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

async function readDatabaseNow(db: ReturnType<typeof getDb>) {
  const result = (await db.execute(sql`SELECT NOW() AS now`)) as unknown as {
    rows?: Array<{ now?: Date | string }>;
  };
  const value = result.rows?.[0]?.now;
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new Error("DATABASE_NOW_UNAVAILABLE");
  }
  return date;
}

export async function readLatestWatchUpdate(userId: string) {
  // Redis 優先：這個 key 在每次 revision 檢查、SSE 連線建立時都會被讀，
  // 走 Redis 可以省掉大量 Neon query。miss 或 Redis 失敗時 fallback DB
  // （DB 仍是 source of truth；Redis 重啟遺失資料時不能誤判成「沒有更新」）。
  const cachedRecord = await readRedisJson<WatchUpdateRecord>(
    watchUpdateKey(userId),
  );
  if (cachedRecord && isWatchUpdateRecord(cachedRecord)) {
    return cachedRecord;
  }

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
  if (!isWatchUpdateRecord(row.payload)) return null;

  // 回填 Redis（沿用 DB 剩餘壽命），讓後續讀取不用再回 DB。失敗可忽略；
  // 用 ifAbsent 避免把剛被併發 publish 更新過的新紀錄蓋回舊值。
  void writeRedisJson(watchUpdateKey(userId), row.payload, expiresAt - Date.now(), {
    ifAbsent: true,
  });
  return row.payload;
}

export async function readFriendRevision(userId: string) {
  const db = getDb();
  const friendRows = await db
    .select({
      userId: friends.userId,
      friendId: friends.friendId,
      friendNickname: friends.friendNickname,
      createdAt: friends.createdAt,
    })
    .from(friends)
    .where(eq(friends.userId, userId));
  if (friendRows.length === 0) return "0";

  const authDb = getAuthDb();
  const profileRows = await authDb
    .select({
      id: profiles.id,
      nickname: profiles.nickname,
      avatarUrl: profiles.avatarUrl,
    })
    .from(profiles)
    .where(inArray(profiles.id, friendRows.map((friend) => friend.friendId)));
  const profileMap = new Map(
    profileRows.map((profile) => [profile.id, profile]),
  );
  const revisionSource = friendRows
    .map((friend) => {
      const profile = profileMap.get(friend.friendId);
      const createdAt =
        friend.createdAt instanceof Date
          ? friend.createdAt.toISOString()
          : String(friend.createdAt ?? "");
      return {
        userId: friend.userId,
        friendId: friend.friendId,
        nickname: profile?.nickname ?? friend.friendNickname ?? "",
        avatarUrl: profile?.avatarUrl ?? "",
        createdAt,
      };
    })
    .sort((a, b) =>
      a.friendId === b.friendId
        ? a.createdAt.localeCompare(b.createdAt)
        : a.friendId.localeCompare(b.friendId),
    );

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(revisionSource))
    .digest("hex");
}

export async function publishWatchUpdates(userIds: string[], reason: string) {
  return publishScopedWatchUpdates(userIds, reason);
}

export async function publishScopedWatchUpdates(
  userIds: string[],
  reason: string,
) {
  const normalizedUserIds = Array.from(new Set(userIds.filter(Boolean)));
  if (normalizedUserIds.length === 0) return;

  try {
    const db = getDb();
    const now = await readDatabaseNow(db);
    const at = now.getTime();
    const expiresAt = new Date(at + WATCH_UPDATE_TTL_MS);
    const publishedEvents: WatchUpdateEvent[] = [];
    await Promise.all(
      normalizedUserIds.map((userId) => {
        const nonce = Math.random().toString(36).slice(2);
        const payload: WatchUpdateRecord = {
          reason,
          at,
          nonce,
        };
        publishedEvents.push({ userId, ...payload });
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
          })
          // Redis 這份是讀取熱路徑用的快取；必須在 pub/sub 事件送出前寫完，
          // 否則客戶端收到事件後做 revision 檢查時可能讀到舊的 latest record，
          // 讓過期的 revision 簽章通過新鮮度檢查。
          .then(() =>
            writeRedisJson(watchUpdateKey(userId), payload, WATCH_UPDATE_TTL_MS),
          );
      })
    );
    runDeferredPublish(
      async () => {
        await Promise.all(
          publishedEvents.map((event) => publishWatchUpdateEvent(event)),
        );
      },
      (error) => {
        console.warn("publish watch update event failed", { reason, error });
      },
    );
  } catch (error) {
    console.warn("publish watch update failed", { reason, error });
  }
}
