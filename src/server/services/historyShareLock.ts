import { sql } from "drizzle-orm";

type TxLike = {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
};

type LockInput = {
  targetUserIds: string[];
  mediaType: "movie" | "tv";
  tmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
  watchedAt: string;
};

export async function lockSharedHistoryTargets(
  tx: TxLike,
  input: LockInput,
) {
  const sortedTargetUserIds = Array.from(new Set(input.targetUserIds)).sort();
  for (const targetUserId of sortedTargetUserIds) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`${targetUserId}:${input.mediaType}:${input.tmdbId}:${input.seasonNumber}:${input.episodeNumber}:${input.watchedAt}`}))`
    );
  }
}
