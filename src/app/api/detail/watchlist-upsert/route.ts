import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { publishScopedWatchUpdates } from "@/server/realtime/watchUpdates";
import { runBestEffortPublish } from "@/server/realtime/safePublish";
import { mutateWatchlistItem } from "@/server/services/watchlistItemMutationService";

type Body = {
  mediaType?: "movie" | "tv";
  tmdbId?: number;
  isAnime?: boolean;
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

  const body = (await request.json().catch(() => null)) as Body | null;
  const mediaType = body?.mediaType;
  const tmdbId = body?.tmdbId;
  const isAnime = mediaType === "tv" && body?.isAnime === true;

  if ((mediaType !== "movie" && mediaType !== "tv") || !isPositiveInteger(tmdbId)) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid payload" },
      { status: 400 }
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

  const result = await mutateWatchlistItem({
    userId,
    mediaType,
    tmdbId,
    isAnime,
  });

  if (result.changed) {
    await runBestEffortPublish(
      `detail/watchlist-upsert:${result.changeKind}`,
      async () => {
        await publishScopedWatchUpdates([userId], "watchlist_upsert");
      },
    );
  }

  return NextResponse.json({
    ok: true,
    duplicate: result.existingCount > 0,
    affectedIsAnime: result.affectedIsAnime,
  });
}
