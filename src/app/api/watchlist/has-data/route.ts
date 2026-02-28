import { NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchHistory, watchHistoryShares, watchlistItems } from "@/server/db/schema";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Not signed in" },
      { status: 401 }
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

  const hasWatchlistRows = await db
    .select({ id: watchlistItems.id })
    .from(watchlistItems)
    .where(
      and(eq(watchlistItems.userId, userId), eq(watchlistItems.projectId, "watch"))
    )
    .limit(1);

  const hasHistoryRows = await db
    .select({ id: watchHistory.id })
    .from(watchHistory)
    .where(and(eq(watchHistory.userId, userId), eq(watchHistory.projectId, "watch")))
    .limit(1);

  const hasSharedHistoryRows = await db
    .select({ id: watchHistoryShares.id })
    .from(watchHistoryShares)
    .where(
      or(
        and(
          eq(watchHistoryShares.targetUserId, userId),
          eq(watchHistoryShares.projectId, "watch")
        ),
        and(
          eq(watchHistoryShares.ownerId, userId),
          eq(watchHistoryShares.projectId, "watch")
        )
      )
    )
    .limit(1);

  const hasAnyData =
    hasWatchlistRows.length > 0 ||
    hasHistoryRows.length > 0 ||
    hasSharedHistoryRows.length > 0;

  return NextResponse.json({ hasAnyData });
}
