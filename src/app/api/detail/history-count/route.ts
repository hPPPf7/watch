import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchHistory } from "@/server/db/schema";

type Body = {
  mediaType?: "movie" | "tv";
  tmdbId?: number;
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
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
  if ((mediaType !== "movie" && mediaType !== "tv") || !isPositiveInteger(tmdbId)) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid payload" },
      { status: 400 }
    );
  }
  const validatedTmdbId = tmdbId;

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
    .select({ count: sql<number>`count(*)` })
    .from(watchHistory)
    .where(
      and(
        eq(watchHistory.userId, session.user.id),
        eq(watchHistory.projectId, "watch"),
        eq(watchHistory.mediaType, mediaType),
        eq(watchHistory.tmdbId, validatedTmdbId)
      )
    );

  return NextResponse.json({ count: Number(rows[0]?.count ?? 0) });
}
