import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { friends, watchlistItems } from "@/server/db/schema";

type Body = {
  mediaType?: "movie" | "tv";
  tmdbId?: number;
  isAnime?: boolean;
  includeFriends?: boolean;
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Not signed in" },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const mediaType = body?.mediaType;
  const tmdbId = body?.tmdbId;
  const isAnime = body?.isAnime === true;
  if ((mediaType !== "movie" && mediaType !== "tv") || !isPositiveInteger(tmdbId)) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid payload" },
      { status: 400 },
    );
  }

  let db;
  try {
    db = getDb();
  } catch {
    return NextResponse.json(
      { code: "CONFIG_MISSING", message: "DATABASE_URL is required" },
      { status: 500 },
    );
  }

  try {
    const [watchlistRows, friendRows] = await Promise.all([
      db
        .select({ id: watchlistItems.id })
        .from(watchlistItems)
        .where(
          and(
            eq(watchlistItems.userId, userId),
            eq(watchlistItems.mediaType, mediaType),
            eq(watchlistItems.tmdbId, tmdbId),
            mediaType === "tv"
              ? eq(watchlistItems.isAnime, isAnime ? 1 : 0)
              : eq(watchlistItems.isAnime, 0),
          ),
        )
        .limit(1),
      body?.includeFriends === true
        ? db
            .select({
              friend_id: friends.friendId,
              friend_nickname: friends.friendNickname,
            })
            .from(friends)
            .where(eq(friends.userId, userId))
            .orderBy(desc(friends.createdAt))
        : Promise.resolve(null),
    ]);

    return NextResponse.json({
      inWatchlist: watchlistRows.length > 0,
      ...(friendRows ? { friends: friendRows } : {}),
    });
  } catch (error) {
    console.error("[detail/bootstrap] failed", { userId, error });
    return NextResponse.json(
      { code: "DETAIL_BOOTSTRAP_FAILED", message: "Failed to load detail bootstrap data" },
      { status: 500 },
    );
  }
}
