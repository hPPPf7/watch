import {
  readManyTmdbCacheIncludingExpired,
  TMDB_CACHE_TTL,
  withTmdbInflight,
  withTmdbInflightGuarded,
  writeTmdbCache,
} from "@/server/tmdb/cache";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
// TMDB API 條款允許快取，但最長不能超過 6 個月。
const CALENDAR_METADATA_COMPLETE_TTL_MS = 150 * 24 * 60 * 60 * 1000;
// 名稱翻譯可能在 TMDB 後補；疑似只拿到原文時縮短快取週期。
const CALENDAR_METADATA_INCOMPLETE_TTL_MS = TMDB_CACHE_TTL.detail;

type MediaType = "movie" | "tv";

type MoviePayload = {
  title?: string;
  original_title?: string;
  original_language?: string;
};

type TvPayload = {
  name?: string;
  original_name?: string;
  original_language?: string;
  genres?: Array<{ id: number }>;
};

export type CalendarMetadata = {
  title: string | null;
  isAnime: boolean;
  titleNeedsRefresh?: boolean;
  titleRefreshReason?: "missing";
  titleRefreshAttempts?: number;
};

type CalendarMetadataCacheState = {
  payload: CalendarMetadata;
  expired: boolean;
  legacyTitleDue: boolean;
};

const getLegacyTitleRefreshReason = (metadata: CalendarMetadata) =>
  (metadata as unknown as { titleRefreshReason?: string }).titleRefreshReason;

export const buildCalendarMetadataKey = (type: MediaType, id: number) =>
  `tmdb:calendar-meta:${type}:${id}`;

const buildDetailUrl = (type: MediaType, id: number, language: string) => {
  const url = new URL(`${TMDB_BASE_URL}/${type}/${id}`);
  url.searchParams.set("api_key", process.env.TMDB_API_KEY ?? "");
  url.searchParams.set("language", language);
  return url.toString();
};

const hasCjkText = (value?: string | null) =>
  Boolean(value && /[\u3400-\u9fff\uf900-\ufaff]/.test(value));

const isChineseLanguage = (value?: string | null) =>
  Boolean(value && value.toLowerCase().startsWith("zh"));

const hasLocalizedTitle = (
  title: string | null | undefined,
  originalTitle: string | null | undefined,
  originalLanguage: string | null | undefined,
) => {
  const normalizedTitle = title?.trim();
  if (!normalizedTitle) return false;

  const normalizedOriginalTitle = originalTitle?.trim();
  if (!normalizedOriginalTitle) return hasCjkText(normalizedTitle);
  if (normalizedTitle !== normalizedOriginalTitle) return true;
  return isChineseLanguage(originalLanguage);
};

const normalizeTitleForCompare = (value?: string | null) =>
  value?.trim().toLocaleLowerCase() ?? "";

const getRefreshMetadataTtlMs = (attempts: number) =>
  Math.min(
    CALENDAR_METADATA_COMPLETE_TTL_MS,
    CALENDAR_METADATA_INCOMPLETE_TTL_MS * 2 ** Math.min(attempts, 16),
  );

const titleNeedsRefresh = (
  title: string | null,
  referenceTitles: Array<string | null | undefined>,
) => {
  if (!title?.trim()) return true;
  if (hasCjkText(title)) return false;

  const normalizedTitle = normalizeTitleForCompare(title);
  return referenceTitles.some(
    (value) =>
      normalizeTitleForCompare(value) &&
      normalizeTitleForCompare(value) === normalizedTitle,
  );
};

const buildAssessedCalendarMetadata = (
  metadata: CalendarMetadata,
  referenceTitles: Array<string | null | undefined>,
  previousAttempts: number,
  refreshReason?: "missing",
) => {
  const needsRefresh =
    refreshReason !== undefined ||
    titleNeedsRefresh(metadata.title, referenceTitles);
  if (!needsRefresh) {
    return {
      metadata: {
        ...metadata,
        titleNeedsRefresh: false,
        titleRefreshReason: undefined,
        titleRefreshAttempts: 0,
      } satisfies CalendarMetadata,
      ttlMs: CALENDAR_METADATA_COMPLETE_TTL_MS,
    };
  }

  const nextAttempts = Math.max(0, previousAttempts) + 1;
  return {
    metadata: {
      ...metadata,
      titleNeedsRefresh: true,
      titleRefreshReason: refreshReason ?? "missing",
      titleRefreshAttempts: nextAttempts,
    } satisfies CalendarMetadata,
    ttlMs: getRefreshMetadataTtlMs(previousAttempts),
  };
};

const chooseLocalizedTitle = (
  traditionalTitle: string | null | undefined,
  originalTitle: string | null | undefined,
  originalLanguage: string | null | undefined,
) => {
  if (hasLocalizedTitle(traditionalTitle, originalTitle, originalLanguage)) {
    return {
      title: traditionalTitle?.trim() || null,
      refreshReason: undefined,
    };
  }

  return {
    title:
      originalTitle?.trim() ||
      traditionalTitle?.trim() ||
      null,
    refreshReason: isChineseLanguage(originalLanguage)
      ? undefined
      : ("missing" as const),
  };
};

const mergeMovieMetadata = (
  primary: MoviePayload,
): CalendarMetadata & { titleRefreshReason?: "missing" } => {
  const title = chooseLocalizedTitle(
    primary.title,
    primary.original_title,
    primary.original_language,
  );
  return {
    title: title.title,
    titleRefreshReason: title.refreshReason,
    isAnime: false,
  };
};

const mergeTvMetadata = (
  primary: TvPayload,
  fallback: TvPayload,
): CalendarMetadata & { titleRefreshReason?: "missing" } => {
  const primaryGenreIds = Array.isArray(primary.genres)
    ? primary.genres.map((genre) => genre.id)
    : [];
  const fallbackGenreIds = Array.isArray(fallback.genres)
    ? fallback.genres.map((genre) => genre.id)
    : [];
  const title = chooseLocalizedTitle(
    primary.name,
    primary.original_name,
    primary.original_language,
  );
  return {
    title: title.title,
    titleRefreshReason: title.refreshReason,
    isAnime:
      primaryGenreIds.includes(16) ||
      fallbackGenreIds.includes(16),
  };
};

const readCalendarMetadataCacheState = async (
  type: MediaType,
  id: number,
): Promise<CalendarMetadataCacheState | null> => {
  const cacheKey = buildCalendarMetadataKey(type, id);
  const entries = await readManyTmdbCacheIncludingExpired<CalendarMetadata>([
    cacheKey,
  ]);
  const cached = entries.get(cacheKey);
  if (!cached) return null;

  const updatedAt = cached.updatedAt ? new Date(cached.updatedAt).getTime() : 0;
  const obsoleteSimplifiedTitle =
    getLegacyTitleRefreshReason(cached.payload) === "simplified";
  const legacyTitleDue =
    obsoleteSimplifiedTitle ||
    (cached.payload.titleNeedsRefresh === undefined &&
      updatedAt > 0 &&
      Date.now() - updatedAt >= CALENDAR_METADATA_INCOMPLETE_TTL_MS);

  return {
    payload: cached.payload,
    expired: cached.expired,
    legacyTitleDue,
  };
};

export const readCalendarMetadata = async (
  type: MediaType,
  id: number,
): Promise<CalendarMetadata | null> => {
  const cached = await readCalendarMetadataCacheState(type, id);
  if (!cached || cached.expired || cached.legacyTitleDue) return null;
  return cached.payload;
};

const readCalendarMetadataAttempts = async (type: MediaType, id: number) => {
  const cacheKey = buildCalendarMetadataKey(type, id);
  const entries = await readManyTmdbCacheIncludingExpired<CalendarMetadata>([
    cacheKey,
  ]);
  const attempts = entries.get(cacheKey)?.payload.titleRefreshAttempts;
  return typeof attempts === "number" && Number.isFinite(attempts)
    ? Math.max(0, attempts)
    : 0;
};

export const writeCalendarMetadataFromDetail = async (
  type: MediaType,
  id: number,
  detail: {
    title?: string | null;
    original_title?: string | null;
    is_anime?: boolean | null;
  },
  options?: { titleRefreshReason?: "missing" },
) => {
  const metadata = {
    title: detail.title || detail.original_title || null,
    isAnime: type === "tv" ? Boolean(detail.is_anime) : false,
  } satisfies CalendarMetadata;
  const previousAttempts = await readCalendarMetadataAttempts(type, id);
  const assessed = buildAssessedCalendarMetadata(
    metadata,
    [detail.original_title],
    previousAttempts,
    options?.titleRefreshReason,
  );

  // 這個 key 只透過 readManyTmdbCacheIncludingExpired 讀取（stale-while-
  // revalidate 需要 Neon 保留過期列，刻意不走 Redis），鏡像進 Redis 不會
  // 被任何路徑讀到，純粹浪費 Upstash 指令額度，跳過。
  await writeTmdbCache(
    buildCalendarMetadataKey(type, id),
    assessed.metadata,
    assessed.ttlMs,
    { skipRedisMirror: true },
  );
};

const fetchAndWriteCalendarMetadata = async (
  type: MediaType,
  id: number,
  previousAttempts: number,
) => {
  const [primaryRes, fallbackRes] = await Promise.all([
    fetch(buildDetailUrl(type, id, "zh-TW"), { cache: "no-store" }),
    fetch(buildDetailUrl(type, id, "en-US"), { cache: "no-store" }),
  ]);

  if (!primaryRes.ok) {
    throw new Error(`TMDB calendar metadata failed:${primaryRes.status}`);
  }

  const primary = (await primaryRes.json()) as MoviePayload | TvPayload;
  const fallback = fallbackRes.ok
    ? ((await fallbackRes.json()) as MoviePayload | TvPayload)
    : {};

  if (type === "movie") {
    const moviePrimary = primary as MoviePayload;
    const movieFallback = fallback as MoviePayload;
    const metadata = mergeMovieMetadata(moviePrimary);
    return buildAssessedCalendarMetadata(
      metadata,
      [moviePrimary.original_title, movieFallback.original_title],
      previousAttempts,
      metadata.titleRefreshReason,
    );
  }

  const tvPrimary = primary as TvPayload;
  const tvFallback = fallback as TvPayload;
  const metadata = mergeTvMetadata(tvPrimary, tvFallback);
  return buildAssessedCalendarMetadata(
    metadata,
    [tvPrimary.original_name, tvFallback.original_name],
    previousAttempts,
    metadata.titleRefreshReason,
  );
};

export const refreshCalendarMetadataIfTitleNeedsRefresh = async (
  type: MediaType,
  id: number,
  options?: { beforeStart?: () => Promise<void> | void },
) => {
  const cacheKey = buildCalendarMetadataKey(type, id);
  const entries = await readManyTmdbCacheIncludingExpired<CalendarMetadata>([
    cacheKey,
  ]);
  const cached = entries.get(cacheKey);
  const updatedAt = cached?.updatedAt ? new Date(cached.updatedAt).getTime() : 0;
  const obsoleteSimplifiedTitle =
    cached?.payload != null &&
    getLegacyTitleRefreshReason(cached.payload) === "simplified";
  const legacyTitleDue =
    obsoleteSimplifiedTitle ||
    (cached?.payload.titleNeedsRefresh === undefined &&
      updatedAt > 0 &&
      Date.now() - updatedAt >= CALENDAR_METADATA_INCOMPLETE_TTL_MS);
  const shouldRefresh =
    !cached ||
    cached.expired ||
    legacyTitleDue;

  if (!shouldRefresh || !process.env.TMDB_API_KEY) return cached?.payload ?? null;

  try {
    const previousAttempts =
      typeof cached?.payload.titleRefreshAttempts === "number"
        ? Math.max(0, cached.payload.titleRefreshAttempts)
        : 0;
    const { metadata, ttlMs } = await withTmdbInflightGuarded(
      cacheKey,
      () => options?.beforeStart?.(),
      () => fetchAndWriteCalendarMetadata(type, id, previousAttempts),
    );
    // 同上：這個 key 只被 readManyTmdbCacheIncludingExpired 讀取，跳過鏡像。
    await writeTmdbCache(cacheKey, metadata, ttlMs, { skipRedisMirror: true });
    return metadata;
  } catch (error) {
    console.warn("calendar metadata refresh failed", { type, id, error });
    return cached?.payload ?? null;
  }
};

export const getCalendarMetadata = async (
  type: MediaType,
  id: number,
): Promise<CalendarMetadata | null> => {
  const cacheKey = buildCalendarMetadataKey(type, id);
  const cached = await readCalendarMetadataCacheState(type, id);
  if (cached && !cached.expired && !cached.legacyTitleDue) return cached.payload;
  if (!process.env.TMDB_API_KEY) {
    return cached && !cached.expired && !cached.legacyTitleDue
      ? cached.payload
      : null;
  }

  try {
    const { metadata, ttlMs } = await withTmdbInflight(cacheKey, async () => {
      const previousAttempts = await readCalendarMetadataAttempts(type, id);
      return fetchAndWriteCalendarMetadata(type, id, previousAttempts);
    });

    // 同上：這個 key 只被 readManyTmdbCacheIncludingExpired 讀取，跳過鏡像。
    await writeTmdbCache(cacheKey, metadata, ttlMs, { skipRedisMirror: true });
    return metadata;
  } catch (error) {
    console.warn("calendar metadata fetch failed", { type, id, error });
    return cached && !cached.expired ? cached.payload : null;
  }
};
