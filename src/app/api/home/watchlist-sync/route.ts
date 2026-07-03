import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { publishScopedWatchUpdates } from "@/server/realtime/watchUpdates";
import { mutateWatchlistItem } from "@/server/services/watchlistItemMutationService";

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

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Not signed in" },
      { status: 401 }
    );
  }
  try {
    getDb();
  } catch {
    return NextResponse.json(
      { code: "CONFIG_MISSING", message: "DATABASE_URL is required" },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const item = body?.item;
  if (
    !item ||
    (item.type !== "movie" && item.type !== "tv") ||
    !isPositiveInteger(item.id)
  ) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid payload" },
      { status: 400 }
    );
  }

  const result = await mutateWatchlistItem({
    userId,
    mediaType: item.type,
    tmdbId: item.id,
    isAnime: item.isAnime,
    insertIfMissing: false,
  });

  if (result.changed) {
    await publishScopedWatchUpdates(
      [
        {
          userId,
          revisionScopes: result.affectedIsAnime.map((scopeIsAnime) => ({
            mediaType: item.type,
            isAnime: item.type === "tv" ? scopeIsAnime : false,
          })),
        },
      ],
      "home_watchlist_sync",
    );
  }

  return NextResponse.json({ ok: true });
}
