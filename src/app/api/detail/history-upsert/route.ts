import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { watchHistory } from "@/server/db/schema";
import { publishWatchUpdates } from "@/server/realtime/watchUpdates";

type Body = {
  mediaType?: "movie" | "tv";
  tmdbId?: number;
  season?: number;
  episode?: number;
  watchedAt?: string;
  originalDate?: string | null;
};

const toUtcDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

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
  const mediaType = body?.mediaType;
  const tmdbId = body?.tmdbId;
  const season = body?.season ?? 0;
  const episode = body?.episode ?? 0;
  const watchedAt = body?.watchedAt;
  const originalDate = body?.originalDate ?? null;

  if (
    (mediaType !== "movie" && mediaType !== "tv") ||
    !tmdbId ||
    !watchedAt ||
    !/^\d{4}-\d{2}-\d{2}$/.test(watchedAt)
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
  let didChange = false;

  if (
    originalDate &&
    originalDate !== watchedAt &&
    /^\d{4}-\d{2}-\d{2}$/.test(originalDate)
  ) {
    didChange = true;
    await db
      .delete(watchHistory)
      .where(
        and(
          eq(watchHistory.userId, userId),
          eq(watchHistory.projectId, "watch"),
          eq(watchHistory.mediaType, mediaType),
          eq(watchHistory.tmdbId, tmdbId),
          eq(watchHistory.seasonNumber, season),
          eq(watchHistory.episodeNumber, episode),
          eq(watchHistory.watchedAt, toUtcDate(originalDate))
        )
      );
  }

  const existing = await db
    .select({ id: watchHistory.id })
    .from(watchHistory)
    .where(
      and(
        eq(watchHistory.userId, userId),
        eq(watchHistory.projectId, "watch"),
        eq(watchHistory.mediaType, mediaType),
        eq(watchHistory.tmdbId, tmdbId),
        eq(watchHistory.seasonNumber, season),
        eq(watchHistory.episodeNumber, episode),
        eq(watchHistory.watchedAt, toUtcDate(watchedAt))
      )
    )
    .limit(1);

  if (existing.length === 0) {
    didChange = true;
    await db.insert(watchHistory).values({
      userId,
      projectId: "watch",
      mediaType,
      tmdbId,
      seasonNumber: season,
      episodeNumber: episode,
      watchedAt: toUtcDate(watchedAt),
    });
  }

  if (didChange) {
    publishWatchUpdates([userId], "history_upsert");
  }

  return NextResponse.json({ ok: true, duplicate: existing.length > 0 });
}
