import { NextResponse } from "next/server";
import { tmdbJson } from "@/server/tmdb/cache";
import { getTmdbDetail } from "@/server/tmdb/detail";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const type = searchParams.get("type");
  const forceRefresh = searchParams.get("refresh") === "1";

  if (!id || (type !== "movie" && type !== "tv")) {
    return NextResponse.json(
      { error: "Missing or invalid parameters" },
      { status: 400 },
    );
  }

  try {
    const merged = await getTmdbDetail(type, id, { forceRefresh });
    return tmdbJson(merged);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "TMDB_API_KEY_MISSING") {
      return NextResponse.json({ error: "Missing TMDB_API_KEY" }, { status: 500 });
    }
    const status = message.startsWith("TMDB detail failed:")
      ? Number(message.split(":")[1] || 502)
      : 502;
    return NextResponse.json({ error: "TMDB detail failed" }, { status });
  }
}
