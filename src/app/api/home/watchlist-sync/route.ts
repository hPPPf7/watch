import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchlistItems } from "@/server/db/schema";

const PROJECT_ID = "watch";

type Body = {
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
  const item = body?.item;
  if (!item || (item.type !== "movie" && item.type !== "tv")) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid payload" },
      { status: 400 }
    );
  }

  const existing = await db
    .select({ id: watchlistItems.id })
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, userId),
        eq(watchlistItems.projectId, PROJECT_ID),
        eq(watchlistItems.mediaType, item.type),
        eq(watchlistItems.tmdbId, item.id)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(watchlistItems)
      .set({ isAnime: item.isAnime ? 1 : 0 })
      .where(eq(watchlistItems.id, existing[0].id));
  }

  return NextResponse.json({ ok: true });
}
