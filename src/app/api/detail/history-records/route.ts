import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { friends, watchHistory, watchHistoryShares } from "@/server/db/schema";

type Body = {
  mediaType?: "movie" | "tv";
  tmdbId?: number;
  season?: number;
  episode?: number;
};

type HistoryRecordRow = {
  watched_at: string;
  owner_id: string;
  friend_id: string | null;
  friend_nickname: string | null;
  is_owner: boolean;
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Not signed in" },
      { status: 401 }
    );
  }
  const body = (await request.json().catch(() => null)) as Body | null;
  const mediaType = body?.mediaType;
  const tmdbId = body?.tmdbId;
  const season = body?.season ?? 0;
  const episode = body?.episode ?? 0;
  const hasInvalidMovieEpisodeScope =
    mediaType === "movie" && (season !== 0 || episode !== 0);

  if (
    (mediaType !== "movie" && mediaType !== "tv") ||
    !isPositiveInteger(tmdbId) ||
    !isNonNegativeInteger(season) ||
    !isNonNegativeInteger(episode) ||
    hasInvalidMovieEpisodeScope
  ) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid payload" },
      { status: 400 }
    );
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
  try {
    const ownRows = await db
      .select({
        id: watchHistory.id,
        watchedAt: watchHistory.watchedAt,
        ownerId: watchHistory.userId,
      })
      .from(watchHistory)
      .where(
        and(
          eq(watchHistory.userId, session.user.id),
          eq(watchHistory.projectId, "watch"),
          eq(watchHistory.mediaType, mediaType),
          eq(watchHistory.tmdbId, tmdbId),
          eq(watchHistory.seasonNumber, season),
          eq(watchHistory.episodeNumber, episode)
        )
      )
      .orderBy(watchHistory.watchedAt);

    const sharedRows = await db
      .select({
        id: watchHistory.id,
        watchedAt: watchHistory.watchedAt,
        ownerId: watchHistory.userId,
      })
      .from(watchHistoryShares)
      .innerJoin(
        watchHistory,
        eq(watchHistory.id, watchHistoryShares.watchHistoryId)
      )
      .where(
        and(
          eq(watchHistoryShares.projectId, "watch"),
          eq(watchHistoryShares.targetUserId, session.user.id),
          eq(watchHistory.projectId, "watch"),
          eq(watchHistory.mediaType, mediaType),
          eq(watchHistory.tmdbId, tmdbId),
          eq(watchHistory.seasonNumber, season),
          eq(watchHistory.episodeNumber, episode)
        )
      )
      .orderBy(watchHistory.watchedAt);

    const recordMap = new Map<
      string,
      { id: string; watchedAt: Date | string; ownerId: string }
    >();
    [...ownRows, ...sharedRows].forEach((row) => {
      recordMap.set(row.id, { id: row.id, watchedAt: row.watchedAt, ownerId: row.ownerId });
    });
    const recordIds = Array.from(recordMap.keys());

    const shareRows =
      recordIds.length === 0
        ? []
        : await db
            .select({
              watchHistoryId: watchHistoryShares.watchHistoryId,
              friendId: watchHistoryShares.targetUserId,
            })
            .from(watchHistoryShares)
            .where(
              and(
                eq(watchHistoryShares.projectId, "watch"),
                inArray(watchHistoryShares.watchHistoryId, recordIds)
              )
            );

    const participantIds = Array.from(
      new Set([
        session.user.id,
        ...Array.from(recordMap.values()).map((row) => row.ownerId),
        ...shareRows.map((row) => row.friendId),
      ]),
    );
    const friendRows =
      participantIds.length === 0
        ? []
        : await db
            .select({
              friendId: friends.friendId,
              friendNickname: friends.friendNickname,
            })
            .from(friends)
            .where(
              and(
                eq(friends.projectId, "watch"),
                eq(friends.userId, session.user.id),
                inArray(friends.friendId, participantIds)
              )
            );
    const visibleNicknameById = new Map<string, string | null>();
    friendRows.forEach((row) =>
      visibleNicknameById.set(row.friendId, row.friendNickname ?? null),
    );
    const visibleParticipantIds = new Set<string>([
      session.user.id,
      ...friendRows.map((row) => row.friendId),
    ]);

    const sharesByRecord = new Map<
      string,
      Array<{ friendId: string; friendNickname: string | null }>
    >();
    shareRows.forEach((row) => {
      const list = sharesByRecord.get(row.watchHistoryId) ?? [];
      list.push({ friendId: row.friendId, friendNickname: null });
      sharesByRecord.set(row.watchHistoryId, list);
    });

    const normalized: HistoryRecordRow[] = Array.from(recordMap.values())
      .flatMap<HistoryRecordRow>((row) => {
        const shares = sharesByRecord.get(row.id) ?? [];
        const value = row.watchedAt as unknown;
        const watchedAt =
          value instanceof Date
            ? value.toISOString().slice(0, 10)
            : String(value).slice(0, 10);
        const participants = [
          ...(visibleParticipantIds.has(row.ownerId)
            ? [
                {
                  friend_id: row.ownerId,
                  friend_nickname:
                    row.ownerId === session.user.id
                      ? null
                      : (visibleNicknameById.get(row.ownerId) ?? null),
                  is_owner: true,
                },
              ]
            : []),
          ...shares
            .filter(
              (share) =>
                share.friendId !== row.ownerId &&
                visibleParticipantIds.has(share.friendId),
            )
            .map((share) => ({
              friend_id: share.friendId,
              friend_nickname:
                share.friendId === session.user.id
                  ? null
                  : (visibleNicknameById.get(share.friendId) ?? null),
              is_owner: false,
            })),
        ];

        return participants.map((participant) => ({
          watched_at: watchedAt,
          owner_id: row.ownerId,
          friend_id: participant.friend_id,
          friend_nickname: participant.friend_nickname,
          is_owner: participant.is_owner,
        }));
      })
      .sort((a, b) => b.watched_at.localeCompare(a.watched_at));

    return NextResponse.json({ rows: normalized });
  } catch (error) {
    console.error("[detail/history-records] failed", {
      userId: session.user.id,
      mediaType,
      tmdbId,
      season,
      episode,
      error,
    });
    return NextResponse.json(
      { code: "HISTORY_RECORDS_FAILED", message: "Failed to load history records" },
      { status: 500 }
    );
  }
}
