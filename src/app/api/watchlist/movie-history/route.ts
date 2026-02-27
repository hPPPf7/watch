import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import {
  profiles,
  watchHistory,
  watchHistoryShares,
} from "@/server/db/schema";

type Body = {
  tmdbIds?: number[];
};

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Not signed in" },
      { status: 401 }
    );
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const tmdbIds = Array.isArray(body?.tmdbIds)
    ? body!.tmdbIds.filter((id): id is number => typeof id === "number")
    : [];
  if (tmdbIds.length === 0) {
    return NextResponse.json({ rows: [] });
  }

  let db;
  try {
    db = getDb();
  } catch {
    return NextResponse.json(
      { code: "CONFIG_MISSING", message: "DATABASE_URL is required" },
      { status: 500 }
    );
  }

  const ownRecords = await db
    .select({
      id: watchHistory.id,
      tmdb_id: watchHistory.tmdbId,
      watched_at: watchHistory.watchedAt,
      owner_id: watchHistory.userId,
    })
    .from(watchHistory)
    .where(
      and(
        eq(watchHistory.userId, userId),
        eq(watchHistory.projectId, "watch"),
        eq(watchHistory.mediaType, "movie"),
        inArray(watchHistory.tmdbId, tmdbIds)
      )
    )
    .orderBy(desc(watchHistory.watchedAt), desc(watchHistory.createdAt), desc(watchHistory.id));

  const sharedRecords = await db
    .select({
      id: watchHistory.id,
      tmdb_id: watchHistory.tmdbId,
      watched_at: watchHistory.watchedAt,
      owner_id: watchHistory.userId,
    })
    .from(watchHistoryShares)
    .innerJoin(
      watchHistory,
      eq(watchHistory.id, watchHistoryShares.watchHistoryId)
    )
    .where(
      and(
        eq(watchHistoryShares.projectId, "watch"),
        eq(watchHistoryShares.targetUserId, userId),
        eq(watchHistory.projectId, "watch"),
        eq(watchHistory.mediaType, "movie"),
        inArray(watchHistory.tmdbId, tmdbIds)
      )
    )
    .orderBy(desc(watchHistory.watchedAt), desc(watchHistory.createdAt), desc(watchHistory.id));

  const recordMap = new Map<
    string,
    {
      id: string;
      tmdb_id: number;
      watched_at: Date | string;
      owner_id: string;
    }
  >();
  [...ownRecords, ...sharedRecords].forEach((row) => {
    recordMap.set(row.id, row);
  });

  const records = Array.from(recordMap.values());

  const countMap: Record<number, number> = {};
  const latestRecordByTmdb = new Map<
    number,
    { id: string; owner_id: string; watched_at: string; watchedAtTs: number }
  >();
  records.forEach((row) => {
    const tmdbId = row.tmdb_id;
    countMap[tmdbId] = (countMap[tmdbId] ?? 0) + 1;
    const watchedAtDate =
      row.watched_at instanceof Date ? row.watched_at : new Date(row.watched_at);
    const watchedAtTs = watchedAtDate.getTime();
    const watchedAt = watchedAtDate.toISOString().slice(0, 10);
    const current = latestRecordByTmdb.get(tmdbId);
    const shouldReplace =
      !current ||
      watchedAtTs > current.watchedAtTs ||
      (watchedAtTs === current.watchedAtTs && row.id > current.id);
    if (shouldReplace) {
      latestRecordByTmdb.set(tmdbId, {
        id: row.id,
        owner_id: row.owner_id,
        watched_at: watchedAt,
        watchedAtTs,
      });
    }
  });

  const latestRecordIds = Array.from(
    new Set(Array.from(latestRecordByTmdb.values()).map((row) => row.id))
  );
  const shareRows =
    latestRecordIds.length === 0
      ? []
      : await db
          .select({
            watchHistoryId: watchHistoryShares.watchHistoryId,
            friendId: watchHistoryShares.targetUserId,
            friendNickname: profiles.nickname,
          })
          .from(watchHistoryShares)
          .leftJoin(profiles, eq(profiles.id, watchHistoryShares.targetUserId))
          .where(
            and(
              eq(watchHistoryShares.projectId, "watch"),
              inArray(watchHistoryShares.watchHistoryId, latestRecordIds)
            )
          );
  const sharesByRecord = new Map<
    string,
    Array<{ id: string; nickname: string | null }>
  >();
  shareRows.forEach((row) => {
    const list = sharesByRecord.get(row.watchHistoryId) ?? [];
    list.push({ id: row.friendId, nickname: row.friendNickname ?? null });
    sharesByRecord.set(row.watchHistoryId, list);
  });

  const ownerIds = Array.from(
    new Set(Array.from(latestRecordByTmdb.values()).map((row) => row.owner_id))
  );
  const ownerRows =
    ownerIds.length === 0
      ? []
      : await db
          .select({ id: profiles.id, nickname: profiles.nickname })
          .from(profiles)
          .where(inArray(profiles.id, ownerIds));
  const ownerNicknameById = new Map<string, string | null>();
  ownerRows.forEach((row) => ownerNicknameById.set(row.id, row.nickname ?? null));

  const rows = tmdbIds.flatMap((tmdbId) => {
    const latest = latestRecordByTmdb.get(tmdbId);
    if (!latest) return [];
    const participants = [
      {
        id: latest.owner_id,
        nickname: ownerNicknameById.get(latest.owner_id) ?? null,
        isOwner: true,
      },
      ...(sharesByRecord.get(latest.id) ?? [])
        .filter((share) => share.id !== latest.owner_id)
        .map((share) => ({
          id: share.id,
          nickname: share.nickname,
          isOwner: false,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ];
    return participants.map((participant) => ({
      tmdb_id: tmdbId,
      watched_at: latest.watched_at,
      owner_id: latest.owner_id,
      watch_count: countMap[tmdbId] ?? 0,
      friend_id: participant.id,
      friend_nickname: participant.nickname,
      is_owner: participant.isOwner,
    }));
  });

  return NextResponse.json({ rows });
}
