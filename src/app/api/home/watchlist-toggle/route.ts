import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchlistItems } from "@/server/db/schema";

const PROJECT_ID = "watch";

type Body = {
  action?: "add" | "remove";
  item?: {
    type: "movie" | "tv";
    id: number;
    title: string;
    year: string | null;
    releaseDate: string | null;
    posterPath: string | null;
    isAnime: boolean;
  };
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
  let db;
  try {
    db = getDb();
  } catch {
    return NextResponse.json(
      { code: "CONFIG_MISSING", message: "DATABASE_URL is required" },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const action = body?.action;
  const item = body?.item;

  if (!action || !item || (item.type !== "movie" && item.type !== "tv")) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid payload" },
      { status: 400 }
    );
  }

  if (action === "remove") {
    await db
      .delete(watchlistItems)
      .where(
        and(
          eq(watchlistItems.userId, userId),
          eq(watchlistItems.projectId, PROJECT_ID),
          eq(watchlistItems.mediaType, item.type),
          eq(watchlistItems.tmdbId, item.id)
        )
      );
    return NextResponse.json({ ok: true });
  }

  const existing = await db
    .select({ id: watchlistItems.id })
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, userId),
        eq(watchlistItems.projectId, PROJECT_ID),
        eq(watchlistItems.mediaType, item.type),
        eq(watchlistItems.tmdbId, item.id),
        eq(watchlistItems.isAnime, item.isAnime ? 1 : 0)
      )
    )
    .limit(1);

  if (existing.length === 0) {
    await db.insert(watchlistItems).values({
      userId,
      projectId: PROJECT_ID,
      mediaType: item.type,
      tmdbId: item.id,
      isAnime: item.isAnime ? 1 : 0,
    });
  }

  return NextResponse.json({ ok: true });
}
