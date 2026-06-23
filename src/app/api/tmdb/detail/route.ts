import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  readTmdbCache,
  TMDB_CACHE_KEYS,
  tmdbJson,
} from "@/server/tmdb/cache";
import { getTmdbDetail, type DetailResponse } from "@/server/tmdb/detail";
import {
  readCalendarMetadata,
  refreshCalendarMetadataIfTitleNeedsRefresh,
} from "@/server/tmdb/calendarMetadata";
import { getOptionalTmdbUserId } from "@/server/tmdb/auth";
import { enforceTmdbProxyRateLimit } from "@/server/tmdb/rateLimit";

function isPositiveIntegerString(value: string | null): value is string {
  return value !== null && /^[1-9]\d*$/.test(value);
}

const hasCjkText = (value?: string | null) =>
  Boolean(value && /[\u3400-\u9fff\uf900-\ufaff]/.test(value));

const isChineseLanguage = (value?: string | null) =>
  Boolean(value && value.toLowerCase().startsWith("zh"));

const isOriginalTitleFallback = (detail: DetailResponse) => {
  const title = detail.title?.trim();
  const originalTitle = detail.original_title?.trim();
  return Boolean(
    title &&
      originalTitle &&
      title === originalTitle &&
      !isChineseLanguage(detail.original_language),
  );
};

const cachedDetailNeedsTitleRefresh = (detail: DetailResponse) =>
  !detail.title?.trim() ||
  !hasCjkText(detail.title) ||
  isOriginalTitleFallback(detail);

const cachedDetailShouldRefreshNow = async (
  type: "movie" | "tv",
  id: number,
  cached: DetailResponse,
) => {
  const calendarMetadata = await readCalendarMetadata(type, id);
  const cachedTitle = cached.title?.trim();
  const calendarTitle = calendarMetadata?.title?.trim();

  if (calendarTitle && calendarTitle !== cachedTitle && hasCjkText(calendarTitle)) {
    return true;
  }
  if (calendarMetadata === null) return true;

  return cachedDetailNeedsTitleRefresh(cached);
};

const refreshCalendarMetadataInBackground = (
  type: "movie" | "tv",
  id: number,
  beforeStart: () => Promise<void> | void,
) => {
  void refreshCalendarMetadataIfTitleNeedsRefresh(type, id, {
    beforeStart,
  }).catch((error) => {
    console.warn("[tmdb/detail] calendar metadata refresh failed", {
      type,
      id,
      error,
    });
  });
};

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
    const cached = await readTmdbCache<DetailResponse>(TMDB_CACHE_KEYS.detail(type, id));
    if (cached) {
      userId = await getOptionalTmdbUserId();
      rateLimit = enforceTmdbProxyRateLimit(request, userId, "detail");
      if (await cachedDetailShouldRefreshNow(type, Number(id), cached)) {
        try {
          const refreshed = await getTmdbDetail(type, id, {
            forceRefresh: true,
            beforeStart: () => rateLimit?.beforeStart(),
          });
          return rateLimit.apply(tmdbJson(refreshed));
        } catch (error) {
          console.warn("[tmdb/detail] cached detail text refresh failed", {
            type,
            id,
            error,
          });
        }
      }
      refreshCalendarMetadataInBackground(type, Number(id), () =>
        rateLimit?.beforeStart(),
      );
      return rateLimit.apply(tmdbJson(cached));
    }
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
