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
    // 單一多列 upsert：時間戳一律由 DB 端 now() 產生（維持跨 instance 的
    // 時鐘一致性語意），payload 直接在 SQL 端組出，再用 RETURNING 取回
    // 實際寫入的紀錄來建 pub/sub 事件。這讓原本「先 SELECT NOW() 再逐一
    // upsert」的兩段串行往返縮成一趟——publish 位於每次觀看紀錄 / 清單
    // 寫入的關鍵路徑上，省一趟就是每次操作都省。
    const rows = normalizedUserIds.map((userId) => ({
      key: watchUpdateKey(userId),
      payload: sql`jsonb_build_object(
        'reason', ${reason}::text,
        'at', (extract(epoch FROM now()) * 1000)::bigint,
        'nonce', ${Math.random().toString(36).slice(2)}::text
      )`,
      expiresAt: sql`now() + make_interval(secs => ${WATCH_UPDATE_TTL_MS / 1000})`,
      updatedAt: sql`now()`,
    }));
    const returned = await db
      .insert(tmdbCache)
      .values(rows)
      .onConflictDoUpdate({
        target: tmdbCache.key,
        set: {
          payload: sql`excluded.payload`,
          expiresAt: sql`excluded.expires_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
      .returning({ key: tmdbCache.key, payload: tmdbCache.payload });

    const keyPrefix = watchUpdateKey("");
    const publishedEvents: WatchUpdateEvent[] = [];
    for (const row of returned) {
      if (!row.key.startsWith(keyPrefix)) continue;
      if (!isWatchUpdateRecord(row.payload)) continue;
      publishedEvents.push({
        userId: row.key.slice(keyPrefix.length),
        ...row.payload,
      });
    }
    runDeferredPublish(
      async () => {
        // Redis 這份是讀取熱路徑用的快取，必須在 pub/sub 事件送出前寫完，
        // 否則客戶端收到事件後做 revision 檢查時可能讀到舊的 latest record，
        // 讓過期的 revision 簽章通過新鮮度檢查。放在 deferred 區塊（DB 寫入
        // 成功後才會執行）可維持「Redis 寫在 pub/sub 前、且僅在 DB 成功後」
        // 的順序，同時把 Redis 寫入移出使用者 mutation 的關鍵路徑，避免
        // Redis 退化時（commandTimeout 1s）拖慢每一次觀看紀錄 / 清單寫入。
        await Promise.all(
          publishedEvents.map((event) =>
            writeRedisJson(
              watchUpdateKey(event.userId),
              {
                reason: event.reason,
                at: event.at,
                nonce: event.nonce,
              } satisfies WatchUpdateRecord,
              WATCH_UPDATE_TTL_MS,
            ),
          ),
        );
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
