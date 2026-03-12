import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  readTmdbCache,
  TMDB_CACHE_KEYS,
  tmdbJson,
} from "@/server/tmdb/cache";
import { getTmdbDetail } from "@/server/tmdb/detail";
import { getOptionalTmdbUserId } from "@/server/tmdb/auth";
import { enforceTmdbProxyRateLimit } from "@/server/tmdb/rateLimit";

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

  let userId: string | null = null;
  let rateLimit: ReturnType<typeof enforceTmdbProxyRateLimit> | null = null;

  if (forceRefresh) {
    const session = await auth();
    userId = session?.user?.id ?? null;
    if (!userId) {
      return NextResponse.json(
        { code: "UNAUTHORIZED", message: "Not signed in" },
        { status: 401 },
      );
    }
    rateLimit = enforceTmdbProxyRateLimit(request, userId, "detail");
  } else {
    const cached = await readTmdbCache(TMDB_CACHE_KEYS.detail(type, id));
    if (cached) return tmdbJson(cached);
    userId = await getOptionalTmdbUserId();
    rateLimit = enforceTmdbProxyRateLimit(request, userId, "detail");
  }

  try {
    const merged = await getTmdbDetail(type, id, {
      forceRefresh,
      beforeStart: () => rateLimit?.beforeStart(),
    });
    return (rateLimit ?? enforceTmdbProxyRateLimit(request, userId, "detail")).apply(
      tmdbJson(merged),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "RATE_LIMITED" && rateLimit?.response) {
      return rateLimit.response;
    }
    if (message === "TMDB_API_KEY_MISSING") {
      return (rateLimit ?? enforceTmdbProxyRateLimit(request, userId, "detail")).apply(
        NextResponse.json({ error: "Missing TMDB_API_KEY" }, { status: 500 }),
      );
    }
    const status = message.startsWith("TMDB detail failed:")
      ? Number(message.split(":")[1] || 502)
      : 502;
    return (rateLimit ?? enforceTmdbProxyRateLimit(request, userId, "detail")).apply(
      NextResponse.json({ error: "TMDB detail failed" }, { status }),
    );
  }
}
