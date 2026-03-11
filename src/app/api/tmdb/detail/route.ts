import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { tmdbJson } from "@/server/tmdb/cache";
import { getTmdbDetail } from "@/server/tmdb/detail";

function isPositiveIntegerString(value: string | null): value is string {
  return value !== null && /^[1-9]\d*$/.test(value);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const type = searchParams.get("type");
  const forceRefresh = searchParams.get("refresh") === "1";

  if (!isPositiveIntegerString(id) || (type !== "movie" && type !== "tv")) {
    return NextResponse.json(
      { error: "Missing or invalid parameters" },
      { status: 400 },
    );
  }

  if (forceRefresh) {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { code: "UNAUTHORIZED", message: "Not signed in" },
        { status: 401 },
      );
    }
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
