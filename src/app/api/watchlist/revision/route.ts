import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { getWatchlistRevision } from "@/server/services/watchlistRevisionService";

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

  try {
    getDb();
  } catch {
    return NextResponse.json(
      { code: "CONFIG_MISSING", message: "DATABASE_URL is required" },
      { status: 500 }
    );
  }

  try {
    const revision = await getWatchlistRevision(userId, mediaType, isAnime);
    return NextResponse.json({ revision });
  } catch (error) {
    console.error("[watchlist/revision] failed", {
      userId,
      mediaType,
      isAnime,
      error,
    });
    return NextResponse.json(
      { code: "REVISION_FAILED", message: "Failed to load revision" },
      { status: 500 }
    );
  }
}
