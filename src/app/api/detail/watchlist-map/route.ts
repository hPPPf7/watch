import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchlistItems } from "@/server/db/schema";

type Body = {
  mediaType?: "movie" | "tv";
  tmdbIds?: number[];
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
  const mediaType = body?.mediaType;
  const tmdbIds = Array.isArray(body?.tmdbIds) ? body!.tmdbIds : [];

  if (
    (mediaType !== "movie" && mediaType !== "tv") ||
    tmdbIds.some((id) => typeof id !== "number")
  ) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid payload" },
      { status: 400 }
    );
  }

  if (tmdbIds.length === 0) {
    return NextResponse.json({ ids: [] as number[] });
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

  const rows = await db
    .select({ tmdbId: watchlistItems.tmdbId })
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, session.user.id),
        eq(watchlistItems.projectId, "watch"),
        eq(watchlistItems.mediaType, mediaType),
        inArray(watchlistItems.tmdbId, tmdbIds)
      )
    );

  return NextResponse.json({ ids: rows.map((row) => row.tmdbId) });
}
