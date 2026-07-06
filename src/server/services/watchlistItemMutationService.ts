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

export async function acquireWatchlistItemLock(
  tx: WatchlistMutationTransaction,
  userId: string,
  tmdbId: number,
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`watchlist:${userId}:${tmdbId}`}))`,
  );
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
