import { NextResponse } from "next/server";
import { and, asc, desc, eq, gte, lt, notExists, or } from "drizzle-orm";
import { auth } from "@/auth";
import { extractDateOnlyKey } from "@/lib/calendarDate";
import { isValidDateOnly, toUtcDateOnly } from "@/lib/dateOnly";
import { isUuidString } from "@/lib/uuid";
import { getDb } from "@/server/db/client";
import { friends, watchHistory, watchHistoryShares } from "@/server/db/schema";

type Body = {
  selectedFriendId?: string;
  boundary?: string;
  direction?: -1 | 1;
};

const pickEdge = (
  a: string | null,
  b: string | null,
  direction: -1 | 1
): string | null => {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return direction === 1 ? (a < b ? a : b) : a > b ? a : b;
};

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Not signed in" },
      { status: 401 }
    );
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const selectedFriendId = body?.selectedFriendId ?? "all";
  const boundary = body?.boundary;
  const direction = body?.direction;

  if (
    typeof boundary !== "string" ||
    (direction !== 1 && direction !== -1) ||
    !isValidDateOnly(boundary) ||
    (selectedFriendId !== "all" &&
      selectedFriendId !== "self" &&
      !isUuidString(selectedFriendId))
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

  const viewerId = session.user.id;
  if (selectedFriendId !== "all" && selectedFriendId !== "self") {
    const friendRow = await db
      .select({ friend_id: friends.friendId })
      .from(friends)
      .where(
        and(
          eq(friends.projectId, "watch"),
          eq(friends.userId, viewerId),
          eq(friends.friendId, selectedFriendId),
        )
      )
      .limit(1);
    if (friendRow.length === 0) {
      return NextResponse.json(
        { code: "FORBIDDEN", message: "Friend is not accessible" },
        { status: 403 }
      );
    }
  }
  const boundaryAt = toUtcDateOnly(boundary);
  const sharedWithViewerScope = or(
    eq(watchHistoryShares.ownerId, viewerId),
    eq(watchHistoryShares.targetUserId, viewerId)
  );
  const ownEdgeWhere = and(
    eq(watchHistory.projectId, "watch"),
    eq(watchHistory.userId, viewerId),
    direction === 1
      ? gte(watchHistory.watchedAt, boundaryAt)
      : lt(watchHistory.watchedAt, boundaryAt)
  );
  // 這裡要和月資料查詢的「自己單獨看」篩選語意一致：
  // 只要個人觀看紀錄已分享給任何好友，就不再算作單獨觀看。
  const soloOwnEdgeWhere = and(
    eq(watchHistory.projectId, "watch"),
    eq(watchHistory.userId, viewerId),
    direction === 1
      ? gte(watchHistory.watchedAt, boundaryAt)
      : lt(watchHistory.watchedAt, boundaryAt),
    notExists(
      db
        .select({ id: watchHistoryShares.id })
        .from(watchHistoryShares)
        .where(
          and(
            eq(watchHistoryShares.projectId, "watch"),
            eq(watchHistoryShares.watchHistoryId, watchHistory.id),
            sharedWithViewerScope
          )
        )
    )
  );

  const ownEdgeRow = await db
    .select({ watched_at: watchHistory.watchedAt })
    .from(watchHistory)
    .where(
      selectedFriendId === "self"
        ? soloOwnEdgeWhere
        : selectedFriendId === "all"
        ? and(
            eq(watchHistory.projectId, "watch"),
            eq(watchHistory.userId, viewerId),
            direction === 1
              ? gte(watchHistory.watchedAt, boundaryAt)
              : lt(watchHistory.watchedAt, boundaryAt),
            notExists(
              db
                .select({ id: watchHistoryShares.id })
                .from(watchHistoryShares)
                .where(
                  and(
                    eq(watchHistoryShares.projectId, "watch"),
                    eq(watchHistoryShares.watchHistoryId, watchHistory.id),
                    sharedWithViewerScope
                  )
                )
            )
          )
        : ownEdgeWhere
    )
    .orderBy(direction === 1 ? asc(watchHistory.watchedAt) : desc(watchHistory.watchedAt))
    .limit(1);

  const ownEdge =
    ownEdgeRow.length > 0
      ? ownEdgeRow[0].watched_at instanceof Date
        ? ownEdgeRow[0].watched_at.toISOString().slice(0, 10)
        : (extractDateOnlyKey(String(ownEdgeRow[0].watched_at)) ??
            String(ownEdgeRow[0].watched_at).slice(0, 10))
      : null;

  let shareEdge: string | null = null;
  if (selectedFriendId !== "self") {
    const scope =
      selectedFriendId === "all"
        ? or(
            eq(watchHistoryShares.ownerId, viewerId),
            eq(watchHistoryShares.targetUserId, viewerId)
          )
        : or(
            and(
              eq(watchHistoryShares.ownerId, viewerId),
              eq(watchHistoryShares.targetUserId, selectedFriendId)
            ),
            and(
              eq(watchHistoryShares.ownerId, selectedFriendId),
              eq(watchHistoryShares.targetUserId, viewerId)
            )
          );

    const shareEdgeRow = await db
      .select({ watched_at: watchHistory.watchedAt })
      .from(watchHistoryShares)
      .innerJoin(
        watchHistory,
        eq(watchHistoryShares.watchHistoryId, watchHistory.id)
      )
      .where(
        and(
          eq(watchHistoryShares.projectId, "watch"),
          eq(watchHistory.projectId, "watch"),
          scope,
          direction === 1
            ? gte(watchHistory.watchedAt, boundaryAt)
            : lt(watchHistory.watchedAt, boundaryAt)
        )
      )
      .orderBy(direction === 1 ? asc(watchHistory.watchedAt) : desc(watchHistory.watchedAt))
      .limit(1);

    shareEdge =
      shareEdgeRow.length > 0
        ? shareEdgeRow[0].watched_at instanceof Date
          ? shareEdgeRow[0].watched_at.toISOString().slice(0, 10)
          : (extractDateOnlyKey(String(shareEdgeRow[0].watched_at)) ??
              String(shareEdgeRow[0].watched_at).slice(0, 10))
        : null;
  }

  const edge =
    selectedFriendId === "self"
      ? ownEdge
      : selectedFriendId === "all"
        ? pickEdge(ownEdge, shareEdge, direction)
        : shareEdge;

  return NextResponse.json({ edge });
}
