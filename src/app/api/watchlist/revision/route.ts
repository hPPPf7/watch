import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import {
  watchHistory,
  watchHistoryShares,
  watchlistItems,
} from "@/server/db/schema";

type RevisionRow = {
  revision: string | null;
};

export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Not signed in" },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  const mediaType = url.searchParams.get("mediaType");
  const isAnime = url.searchParams.get("isAnime") === "true";
  if (mediaType !== "movie" && mediaType !== "tv") {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid mediaType" },
      { status: 400 }
    );
  }
  const animeFlag = mediaType === "tv" && isAnime ? 1 : 0;

  let db;
  try {
    db = getDb();
  } catch {
    return NextResponse.json(
      { code: "CONFIG_MISSING", message: "DATABASE_URL is required" },
      { status: 500 }
    );
  }

  const result = await db.execute(sql`
    WITH items AS (
      SELECT
        COUNT(*)::text AS c,
        COALESCE(TO_CHAR(MAX(${watchlistItems.createdAt}), 'YYYYMMDDHH24MISS.US'), '0') AS m
      FROM ${watchlistItems}
      WHERE ${watchlistItems.userId} = ${userId}
        AND ${watchlistItems.projectId} = 'watch'
        AND ${watchlistItems.mediaType} = ${mediaType}
        AND ${watchlistItems.isAnime} = ${animeFlag}
    ),
    own_history AS (
      SELECT
        COUNT(*)::text AS c,
        COALESCE(TO_CHAR(MAX(${watchHistory.createdAt}), 'YYYYMMDDHH24MISS.US'), '0') AS m
      FROM ${watchHistory}
      WHERE ${watchHistory.userId} = ${userId}
        AND ${watchHistory.projectId} = 'watch'
        AND ${watchHistory.mediaType} = ${mediaType}
    ),
    shared_history AS (
      SELECT
        COUNT(DISTINCT ${watchHistory.id})::text AS c,
        COALESCE(TO_CHAR(MAX(${watchHistory.createdAt}), 'YYYYMMDDHH24MISS.US'), '0') AS m
      FROM ${watchHistoryShares}
      INNER JOIN ${watchHistory}
        ON ${watchHistory.id} = ${watchHistoryShares.watchHistoryId}
      WHERE ${watchHistoryShares.projectId} = 'watch'
        AND ${watchHistoryShares.targetUserId} = ${userId}
        AND ${watchHistory.projectId} = 'watch'
        AND ${watchHistory.mediaType} = ${mediaType}
    )
    SELECT CONCAT_WS(
      ':',
      (SELECT c FROM items), (SELECT m FROM items),
      (SELECT c FROM own_history), (SELECT m FROM own_history),
      (SELECT c FROM shared_history), (SELECT m FROM shared_history)
    ) AS revision;
  `);

  const revision =
    (result as unknown as { rows?: RevisionRow[] }).rows?.[0]?.revision ?? "0";

  return NextResponse.json({ revision });
}
