import { and, eq, inArray, sql } from "drizzle-orm";
import { runInTransaction } from "@/server/db/client";
import { watchlistItems } from "@/server/db/schema";

type TransactionCallback = Parameters<typeof runInTransaction>[0];
export type WatchlistMutationTransaction = Parameters<TransactionCallback>[0];

type MutateWatchlistItemInput = {
  userId: string;
  mediaType: "movie" | "tv";
  tmdbId: number;
  isAnime: boolean;
  insertIfMissing?: boolean;
  // 動畫/影集分類理論上由 TMDB 資料決定，同一部作品不該因人而異；
  // 只有使用者操作「自己的」清單時才可信任 caller 帶來的值去重分類。
  // 幫好友同步觀看紀錄（userId 是對方而非發起者）時必須關閉，
  // 避免發起同步的人用自己（可能過期）的判斷覆寫對方已存在的分類。
  allowReclassify?: boolean;
};

export async function acquireWatchlistItemLock(tx: WatchlistMutationTransaction, userId: string, tmdbId: number) {
  await acquireWatchlistItemLocks(tx, [userId], tmdbId);
}

export async function acquireWatchlistItemLocks(tx: WatchlistMutationTransaction, userIds: string[], tmdbId: number) {
  const keys = [...new Set(userIds.map(id => id.toLowerCase()))].sort().map(id => `watchlist:${id}:${tmdbId}`);
  if (keys.length === 0) return;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(lock_key))
    FROM unnest(ARRAY[${sql.join(keys.map(key => sql`${key}`), sql`, `)}]::text[])
      WITH ORDINALITY AS locks(lock_key, lock_order)
    ORDER BY lock_order`);
}

export async function mutateWatchlistItemInTransaction(
  tx: WatchlistMutationTransaction,
  {
    userId,
    mediaType,
    tmdbId,
    isAnime,
    insertIfMissing = true,
    allowReclassify = true,
  }: MutateWatchlistItemInput,
) {
  await acquireWatchlistItemLock(tx, userId, tmdbId);

  const existing = await tx
    .select({ id: watchlistItems.id, isAnime: watchlistItems.isAnime })
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, userId),
        eq(watchlistItems.mediaType, mediaType),
        eq(watchlistItems.tmdbId, tmdbId),
      ),
    );
  const nextIsAnime = mediaType === "tv" && isAnime ? 1 : 0;

  if (existing.length === 0) {
    if (!insertIfMissing) {
      return {
        existingCount: 0,
        changed: false,
        changeKind: null as "add" | "reclassify" | null,
        previousIsAnime: [] as boolean[],
        affectedIsAnime: [nextIsAnime === 1],
      };
    }

    const inserted = await tx
      .insert(watchlistItems)
      .values({
        userId,
        mediaType,
        tmdbId,
        isAnime: nextIsAnime,
      })
      .onConflictDoNothing({
        target: [
          watchlistItems.userId,
          watchlistItems.mediaType,
          watchlistItems.tmdbId,
          watchlistItems.isAnime,
        ],
      })
      .returning({ id: watchlistItems.id });

    return {
      existingCount: 0,
      changed: inserted.length > 0,
      changeKind: inserted.length > 0 ? ("add" as const) : null,
      previousIsAnime: [] as boolean[],
      affectedIsAnime: [nextIsAnime === 1],
    };
  }

  const previousIsAnime =
    mediaType === "tv"
      ? Array.from(new Set(existing.map((row) => row.isAnime === 1)))
      : [false];

  if (!allowReclassify) {
    // 項目已存在：保留原本分類，不因為第三方（例如同步觀看紀錄的好友）
    // 帶來不同的 isAnime 值而被改動。
    return {
      existingCount: existing.length,
      changed: false,
      changeKind: null as "add" | "reclassify" | null,
      previousIsAnime,
      affectedIsAnime: previousIsAnime,
    };
  }

  const keepRow =
    existing.find((row) => row.isAnime === nextIsAnime) ?? existing[0];
  const duplicateIds = existing
    .filter((row) => row.id !== keepRow.id)
    .map((row) => row.id);
  const needsUpdate = keepRow.isAnime !== nextIsAnime;

  if (needsUpdate) {
    await tx
      .update(watchlistItems)
      .set({ isAnime: nextIsAnime })
      .where(eq(watchlistItems.id, keepRow.id));
  }
  if (duplicateIds.length > 0) {
    await tx
      .delete(watchlistItems)
      .where(inArray(watchlistItems.id, duplicateIds));
  }

  const changed = needsUpdate || duplicateIds.length > 0;
  return {
    existingCount: existing.length,
    changed,
    changeKind: changed ? ("reclassify" as const) : null,
    previousIsAnime,
    affectedIsAnime:
      mediaType === "tv"
        ? Array.from(new Set([...previousIsAnime, isAnime]))
        : [false],
  };
}

export async function mutateWatchlistItem(input: MutateWatchlistItemInput) {
  return runInTransaction((tx) =>
    mutateWatchlistItemInTransaction(tx, input),
  );
}

/** 必須先取得所有參與者的 item lock；新增紀錄與清單成員資格一起提交。 */
export async function ensureHistoryWatchlistItem(tx: WatchlistMutationTransaction, userId: string, mediaType: "movie" | "tv", tmdbId: number, isAnime: boolean | null, ownerId = userId) {
  await ensureHistoryWatchlistItems(tx, [userId], mediaType, tmdbId, isAnime, ownerId);
}

export async function ensureHistoryWatchlistItems(tx: WatchlistMutationTransaction, userIds: string[], mediaType: "movie" | "tv", tmdbId: number, isAnime: boolean | null, ownerId: string) {
  const ids = [...new Set(userIds.map(id => id.toLowerCase()))].sort();
  if (ids.length === 0) return;
  await tx.execute(sql`
    INSERT INTO ${watchlistItems} (user_id, media_type, tmdb_id, is_anime)
    SELECT target.user_id, ${mediaType}, ${tmdbId},
      CASE WHEN ${mediaType} = 'movie' THEN 0 ELSE COALESCE(${isAnime === null ? null : isAnime ? 1 : 0}::integer,
        (SELECT is_anime FROM ${watchlistItems} WHERE user_id = ${ownerId}::uuid AND media_type = ${mediaType} AND tmdb_id = ${tmdbId} ORDER BY is_anime DESC LIMIT 1), 0) END
    FROM unnest(ARRAY[${sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)}]) AS target(user_id)
    WHERE NOT EXISTS (SELECT 1 FROM ${watchlistItems} WHERE user_id = target.user_id AND media_type = ${mediaType} AND tmdb_id = ${tmdbId})
    ORDER BY target.user_id
    ON CONFLICT DO NOTHING
  `);
}
