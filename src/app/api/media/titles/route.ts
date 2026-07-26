import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getCalendarMetadataBatch } from "@/server/tmdb/calendarMetadata";
import { enforceTmdbProxyRateLimit } from "@/server/tmdb/rateLimit";

// 共用的作品標題查詢：以 media_type + tmdb_id 為單位，不綁清單也不綁月份。
// 行事曆、清單卡片都指向同一份 tmdb_cache，繁中標題被 backoff 補上後，
// 兩邊會一起看到新名稱，不必等各自的整包回應過期。
type Body = {
  items?: Array<{ media_type?: unknown; tmdb_id?: unknown }>;
};

type TitleEntry = {
  title: string | null;
  is_anime: boolean;
  refresh_after_ms: number;
};

// 一次月曆最多 42 格，扣掉重複的作品遠不到這個數；設上限只是避免被當成批次查詢濫用。
const MAX_ITEMS = 200;
const METADATA_CONCURRENCY = 6;

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

const isMediaType = (value: unknown): value is "movie" | "tv" =>
  value === "movie" || value === "tv";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Not signed in" },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const rawItems = Array.isArray(body?.items) ? body.items : null;

  if (
    !rawItems ||
    rawItems.length > MAX_ITEMS ||
    rawItems.some(
      (item) => !isMediaType(item?.media_type) || !isPositiveInteger(item?.tmdb_id),
    )
  ) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid payload" },
      { status: 400 },
    );
  }

  // 同一份回應裡重複的 id 只查一次。
  const requested = new Map<string, { mediaType: "movie" | "tv"; tmdbId: number }>();
  rawItems.forEach((item) => {
    const mediaType = item.media_type as "movie" | "tv";
    const tmdbId = item.tmdb_id as number;
    requested.set(`${mediaType}:${tmdbId}`, { mediaType, tmdbId });
  });

  // 這支端點一個 request 會展開成多個作品查詢，因此按「去重後的作品數」消耗
  // 既有 detail 額度，而不是只把整批算一次。即使資料都已在 Neon 快取裡，
  // 也能限制惡意使用者反覆送任意 id 所造成的資料庫讀取。
  const rateLimit = enforceTmdbProxyRateLimit(
    request,
    session.user.id,
    "detail",
  );
  try {
    for (let index = 0; index < requested.size; index += 1) {
      rateLimit.beforeStart();
    }
  } catch {
    if (rateLimit.response) return rateLimit.response;
    return NextResponse.json(
      { code: "RATE_LIMITED", message: "Requests are too frequent." },
      { status: 429 },
    );
  }

  const titles: Record<string, TitleEntry> = {};
  const metadataByKey = await getCalendarMetadataBatch(
    Array.from(requested.values()),
    METADATA_CONCURRENCY,
  ).catch(() => new Map());
  metadataByKey.forEach(({ metadata, refreshAfterMs }, key) => {
    const title = metadata.title?.trim();
    titles[key] = {
      title: title ? title : null,
      is_anime: metadata.isAnime,
      refresh_after_ms: refreshAfterMs,
    };
  });

  return rateLimit.apply(NextResponse.json({ titles }));
}
