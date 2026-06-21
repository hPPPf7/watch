import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { session } from "electron";

const DAY_MS = 24 * 60 * 60 * 1000;
const TMDB_MAX_CACHE_MS = 180 * DAY_MS;
const USER_DATA_CACHE_MS = 10 * 365 * DAY_MS;
const IDENTITY_CACHE_MS = 10 * 60 * 1000;
const DAILY_REVALIDATE_MS = DAY_MS;
const ENDED_DETAIL_REVALIDATE_STEPS_MS = [
  7 * DAY_MS,
  30 * DAY_MS,
  90 * DAY_MS,
];

const CACHEABLE_WATCHLIST_PATHS = new Set([
  "/api/watchlist/section-data",
  "/api/watchlist/items",
  "/api/watchlist/has-data",
]);

const CACHEABLE_GENERAL_PATHS = new Set([
  "/api/calendar/month-data",
  "/api/detail/bootstrap",
  "/api/detail/history-count",
  "/api/detail/history-episodes",
  "/api/detail/history-records",
  "/api/detail/history-season-records",
  "/api/detail/watchlist-map",
  "/api/detail/watchlist-state",
  "/api/home/watchlist-map",
  "/api/tmdb/detail",
  "/api/tmdb/season",
  "/api/watchlist/movie-history",
  "/api/watchlist/tv-history",
  "/api/watchlist/tv-states",
]);

const USER_HISTORY_ONLY_PATHS = new Set([
  "/api/detail/history-count",
  "/api/detail/history-episodes",
  "/api/detail/history-records",
  "/api/detail/history-season-records",
  "/api/watchlist/movie-history",
  "/api/watchlist/tv-history",
]);

const FRIEND_SCOPED_CACHE_PATHS = new Set([
  "/api/calendar/month-data",
  "/api/detail/bootstrap",
  "/api/detail/history-count",
  "/api/detail/history-episodes",
  "/api/detail/history-records",
  "/api/detail/history-season-records",
  "/api/watchlist/movie-history",
  "/api/watchlist/section-data",
  "/api/watchlist/tv-history",
]);

const MUTATING_USER_PATHS = [
  "/api/detail/history-delete",
  "/api/detail/history-sync-shares",
  "/api/detail/history-sync-watchlist",
  "/api/detail/history-upsert",
  "/api/detail/watchlist-delete",
  "/api/detail/watchlist-upsert",
  "/api/home/watchlist-sync",
  "/api/home/watchlist-toggle",
  "/api/profile/me",
  "/api/watchlist/tv-states/upsert",
];

const AUTH_PATH_PREFIX = "/api/auth/";
const FRIENDS_PATH_PREFIX = "/api/friends/";
const CALENDAR_MONTH_DATA_PATH = "/api/calendar/month-data";

const LOCAL_HISTORY_STORE_PATHS = new Set([
  "/api/watchlist/section-data",
  "/api/watchlist/movie-history",
  "/api/watchlist/tv-history",
  "/api/watchlist/tv-states",
]);

const hash = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

const getHeader = (headers, name) => {
  const lowerName = name.toLowerCase();
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === lowerName);
  return key ? headers[key] : undefined;
};

const responseHeadersToObject = (headers) => {
  const result = {};
  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey === "content-encoding" ||
      lowerKey === "content-length" ||
      lowerKey === "transfer-encoding"
    ) {
      return;
    }
    result[key] = value;
  });
  return result;
};

const sanitizeRequestHeaders = (headers) => {
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey === "content-length" ||
      lowerKey === "host" ||
      lowerKey === "accept-encoding"
    ) {
      continue;
    }
    result[key] = value;
  }
  return result;
};

const uploadBodyBuffer = (request) => {
  const uploadData = request.uploadData ?? [];
  if (uploadData.length === 0) return null;
  const chunks = [];
  for (const part of uploadData) {
    if (part.bytes) {
      chunks.push(part.bytes);
    }
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : null;
};

const makeJsonResponse = (payload, statusCode = 200, extraHeaders = {}) => ({
  statusCode,
  mimeType: "application/json",
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-watch-desktop-cache": "hit",
    ...extraHeaders,
  },
  data: Buffer.from(payload),
});

const toProtocolResponse = async (response, extraHeaders = {}) => {
  const data = Buffer.from(await response.arrayBuffer());
  return {
    statusCode: response.status,
    headers: {
      ...responseHeadersToObject(response.headers),
      ...extraHeaders,
    },
    data,
  };
};

const buildRevisionUrl = (appOrigin, requestUrl) => {
  const mediaType = requestUrl.searchParams.get("mediaType");
  if (mediaType !== "movie" && mediaType !== "tv") return null;
  if (mediaType === "tv" && !requestUrl.searchParams.has("isAnime")) return null;
  const revisionUrl = new URL("/api/watchlist/revision", appOrigin);
  revisionUrl.searchParams.set("mediaType", mediaType);
  revisionUrl.searchParams.set("isAnime", String(requestUrl.searchParams.get("isAnime") === "true"));
  return revisionUrl.toString();
};

const buildRevisionUrlFromScope = (appOrigin, scope) => {
  if (!scope || (scope.mediaType !== "movie" && scope.mediaType !== "tv")) return null;
  if (scope.mediaType === "tv" && typeof scope.isAnime !== "boolean") return null;
  const revisionUrl = new URL("/api/watchlist/revision", appOrigin);
  revisionUrl.searchParams.set("mediaType", scope.mediaType);
  revisionUrl.searchParams.set("isAnime", String(scope.isAnime === true));
  return revisionUrl.toString();
};

const buildFriendsRevisionUrl = (appOrigin, requestUrl) =>
  FRIEND_SCOPED_CACHE_PATHS.has(requestUrl.pathname)
    ? new URL("/api/friends/revision", appOrigin).toString()
    : null;

const isWatchlistCacheable = (requestUrl, method) =>
  method === "GET" && CACHEABLE_WATCHLIST_PATHS.has(requestUrl.pathname);

const isGeneralCacheable = (requestUrl, method) =>
  (method === "GET" || method === "POST") &&
  CACHEABLE_GENERAL_PATHS.has(requestUrl.pathname);

const isExplicitRefreshRequest = (requestUrl) => requestUrl.searchParams.get("refresh") === "1";

const isUserHistoryOnlyRequest = (requestUrl) =>
  USER_HISTORY_ONLY_PATHS.has(requestUrl.pathname);

const isTmdbDetailRequest = (requestUrl) =>
  requestUrl.pathname === "/api/tmdb/detail";

const isTvDetailRefreshRequest = (requestUrl) =>
  isTmdbDetailRequest(requestUrl) &&
  requestUrl.searchParams.get("type") === "tv" &&
  requestUrl.searchParams.get("refresh") === "1" &&
  /^\d+$/.test(requestUrl.searchParams.get("id") ?? "");

const normalizeWithoutRefresh = (requestUrl) => {
  const normalized = new URL(requestUrl.toString());
  normalized.searchParams.delete("refresh");
  normalized.hash = "";
  normalized.searchParams.sort();
  return `${normalized.pathname}?${normalized.searchParams.toString()}`;
};

const endedDetailRevalidateMs = (completedStableChecks) => {
  const index = Math.max(0, Math.min(
    ENDED_DETAIL_REVALIDATE_STEPS_MS.length - 1,
    Number.isInteger(completedStableChecks) ? completedStableChecks : 0,
  ));
  return ENDED_DETAIL_REVALIDATE_STEPS_MS[index];
};

const isEndedTvDetail = (body) => {
  try {
    const payload = JSON.parse(body);
    const status = String(payload?.status ?? "").toLowerCase();
    return status === "ended" || status === "canceled" || status === "cancelled";
  } catch {
    return false;
  }
};

const canUseLongLivedUserHistoryCache = (requestUrl, cacheScope) => {
  if (!isUserHistoryOnlyRequest(requestUrl)) return false;
  if (cacheScope?.mediaType === "movie") return true;
  return cacheScope?.mediaType === "tv" && typeof cacheScope.isAnime === "boolean";
};

const isUserMutation = (requestUrl, method) => {
  if (requestUrl.pathname.startsWith(AUTH_PATH_PREFIX)) return true;
  if (method !== "POST" && method !== "PUT" && method !== "PATCH" && method !== "DELETE") {
    return false;
  }
  return (
    MUTATING_USER_PATHS.includes(requestUrl.pathname) ||
    requestUrl.pathname.startsWith(FRIENDS_PATH_PREFIX)
  );
};

const normalizeCacheUrl = (requestUrl) => {
  const normalized = new URL(requestUrl.toString());
  normalized.hash = "";
  normalized.searchParams.sort();
  return `${normalized.pathname}?${normalized.searchParams.toString()}`;
};

const parseJsonBody = (request) => {
  const body = uploadBodyBuffer(request);
  if (!body || body.length === 0) return null;
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    return null;
  }
};

const scopeFromPayload = (requestUrl, request) => {
  const payload = parseJsonBody(request);
  const item = payload?.item && typeof payload.item === "object" ? payload.item : null;
  const mediaType =
    payload?.mediaType ??
    payload?.media_type ??
    item?.mediaType ??
    item?.type ??
    requestUrl.searchParams.get("mediaType");
  if (mediaType !== "movie" && mediaType !== "tv") return null;
  const tmdbId =
    payload?.tmdbId ??
    payload?.tmdb_id ??
    payload?.states?.[0]?.tmdb_id ??
    payload?.states?.[0]?.tmdbId ??
    item?.tmdbId ??
    item?.tmdb_id ??
    item?.id ??
    requestUrl.searchParams.get("tmdbId") ??
    requestUrl.searchParams.get("id");
  const normalizedTmdbId =
    typeof tmdbId === "number"
      ? tmdbId
      : typeof tmdbId === "string" && /^\d+$/.test(tmdbId)
        ? Number(tmdbId)
        : null;
  const rawIsAnime =
    payload?.isAnime ??
    payload?.is_anime ??
    item?.isAnime ??
    item?.is_anime ??
    requestUrl.searchParams.get("isAnime");
  return {
    mediaType,
    tmdbId: normalizedTmdbId,
    isAnime:
      mediaType === "tv" && rawIsAnime !== null && rawIsAnime !== undefined
        ? rawIsAnime === true || rawIsAnime === "true"
        : null,
  };
};

const entryMatchesScope = (entry, scope) => {
  if (!scope) return true;
  if (scope.tmdbId && Array.isArray(entry?.tmdbIds) && entry.tmdbIds.length > 0) {
    return entry.tmdbIds.includes(scope.tmdbId);
  }
  if (scope.tmdbId && typeof entry?.tmdbId === "number") {
    return entry.tmdbId === scope.tmdbId;
  }
  if (typeof entry?.url !== "string") return true;
  if (!entry.url.startsWith("/api/watchlist/")) return false;
  const entryUrl = new URL(entry.url, "https://desktop-cache.local");
  const mediaType = entryUrl.searchParams.get("mediaType");
  if (mediaType !== scope.mediaType) return false;
  if (scope.mediaType !== "tv") return true;
  if (typeof scope.isAnime !== "boolean") return true;
  return (entryUrl.searchParams.get("isAnime") === "true") === scope.isAnime;
};

const cacheScopeFromRequest = (requestUrl, request) => {
  const payloadScope = scopeFromPayload(requestUrl, request);
  const payload = parseJsonBody(request);
  const id =
    requestUrl.searchParams.get("id") ??
    requestUrl.searchParams.get("tmdbId") ??
    requestUrl.searchParams.get("tmdb_id");
  const tmdbId =
    typeof id === "string" && /^\d+$/.test(id) ? Number(id) : payloadScope?.tmdbId ?? null;
  const pathMediaType =
    requestUrl.pathname === "/api/watchlist/movie-history"
      ? "movie"
      : requestUrl.pathname === "/api/watchlist/tv-history" ||
          requestUrl.pathname === "/api/detail/history-episodes" ||
          requestUrl.pathname === "/api/detail/history-season-records"
        ? "tv"
        : null;
  const mediaType =
    payloadScope?.mediaType ??
    pathMediaType ??
    requestUrl.searchParams.get("mediaType") ??
    requestUrl.searchParams.get("type");
  return {
    mediaType: mediaType === "movie" || mediaType === "tv" ? mediaType : null,
    tmdbId,
    tmdbIds: Array.isArray(payload?.tmdbIds)
      ? payload.tmdbIds.filter((value) => Number.isInteger(value) && value > 0)
      : [],
    isAnime:
      typeof payloadScope?.isAnime === "boolean"
        ? payloadScope.isAnime
        : requestUrl.searchParams.has("isAnime")
          ? requestUrl.searchParams.get("isAnime") === "true"
          : null,
  };
};

export function installDesktopApiCache({ app, appOrigin }) {
  const defaultSession = session.defaultSession;
  const appProtocol = new URL(appOrigin).protocol.slice(0, -1);
  const cacheRoot = path.join(app.getPath("userData"), "api-cache");
  const localHistoryRoot = path.join(app.getPath("userData"), "local-watch-history");
  const identityCache = new Map();

  const cachePath = (cacheKey) => path.join(cacheRoot, `${hash(cacheKey)}.json`);
  const localHistoryPath = (storeKey) => path.join(localHistoryRoot, `${hash(storeKey)}.json`);

  const readEntry = async (cacheKey, { allowExpired = false } = {}) => {
    try {
      const raw = await fs.readFile(cachePath(cacheKey), "utf8");
      const entry = JSON.parse(raw);
      if (!entry || typeof entry !== "object") return null;
      if (
        typeof entry.expiresAt !== "number" ||
        (!allowExpired && entry.expiresAt <= Date.now())
      ) {
        return null;
      }
      if (typeof entry.body !== "string") return null;
      return entry;
    } catch {
      return null;
    }
  };

  const writeEntry = async (cacheKey, entry) => {
    await fs.mkdir(cacheRoot, { recursive: true });
    await fs.writeFile(cachePath(cacheKey), JSON.stringify(entry), "utf8");
  };

  const localHistoryStoreKey = (userId, method, requestUrl, bodyFingerprint = "") =>
    `local-history:${userId}:${method}:${normalizeCacheUrl(requestUrl)}${bodyFingerprint}`;

  const isLocalHistoryStoreRequest = (requestUrl, method) => {
    if (!LOCAL_HISTORY_STORE_PATHS.has(requestUrl.pathname)) return false;
    if (requestUrl.pathname === "/api/watchlist/section-data") {
      return method === "GET";
    }
    return method === "POST";
  };

  const sanitizeSectionDataForLocalHistory = (payload) => ({
    rows: Array.isArray(payload?.rows)
      ? payload.rows.map((row) => ({
          id: row.id,
          tmdb_id: row.tmdb_id,
          title: `TMDB ${row.tmdb_id}`,
          year: null,
          release_date: null,
          status: null,
          tmdb_cached_at: null,
          tv_release_repair_checked_at: null,
          tmdb_stale: true,
          poster_path: null,
          media_type: row.media_type,
          is_anime: Boolean(row.is_anime),
          created_at: row.created_at,
        }))
      : [],
    movieHistoryRows: Array.isArray(payload?.movieHistoryRows)
      ? payload.movieHistoryRows
      : [],
    latestEpisodes: payload?.latestEpisodes ?? {},
    watchedCounts: payload?.watchedCounts ?? {},
    latestWatchedDates: payload?.latestWatchedDates ?? {},
    latestWatchedCreatedAts: payload?.latestWatchedCreatedAts ?? {},
    tvStateRows: Array.isArray(payload?.tvStateRows)
      ? payload.tvStateRows.map(sanitizeTvStateForLocalHistory)
      : [],
  });

  const sanitizeTvStateForLocalHistory = (row) => ({
    tmdb_id: row?.tmdb_id,
    last_progress: row?.last_progress ?? "unwatched",
    last_watched_count: row?.last_watched_count ?? 0,
    alert_active: row?.alert_active ?? false,
    alert_notified_watch_count: row?.alert_notified_watch_count ?? null,
    last_watched_season: row?.last_watched_season ?? null,
    last_watched_episode: row?.last_watched_episode ?? null,
    last_checked_at: row?.last_checked_at ?? null,
    alert_started_at: row?.alert_started_at ?? null,
  });

  const sanitizeLocalHistoryPayload = (requestUrl, body) => {
    try {
      const payload = JSON.parse(body);
      if (requestUrl.pathname === "/api/watchlist/section-data") {
        return JSON.stringify(sanitizeSectionDataForLocalHistory(payload));
      }
      if (requestUrl.pathname === "/api/watchlist/tv-states") {
        return JSON.stringify({
          rows: Array.isArray(payload?.rows)
            ? payload.rows.map(sanitizeTvStateForLocalHistory)
            : [],
        });
      }
      return JSON.stringify(payload);
    } catch {
      return null;
    }
  };

  const writeLocalHistoryEntry = async ({
    userId,
    requestUrl,
    method,
    bodyFingerprint = "",
    revision,
    friendsRevision,
    body,
    cacheScope,
  }) => {
    if (!isLocalHistoryStoreRequest(requestUrl, method)) return;
    const sanitizedBody = sanitizeLocalHistoryPayload(requestUrl, body);
    if (!sanitizedBody) return;
    const now = Date.now();
    const storeKey = localHistoryStoreKey(userId, method, requestUrl, bodyFingerprint);
    await fs.mkdir(localHistoryRoot, { recursive: true });
    await fs.writeFile(
      localHistoryPath(storeKey),
      JSON.stringify({
        version: 1,
        userId,
        url: normalizeCacheUrl(requestUrl),
        method,
        mediaType: cacheScope.mediaType,
        isAnime: cacheScope.isAnime,
        revision,
        friendsRevision,
        body: sanitizedBody,
        updatedAt: now,
        lastAccessedAt: now,
      }),
      "utf8",
    );
  };

  const readLocalHistoryEntry = async (userId, method, requestUrl, bodyFingerprint = "") => {
    if (!isLocalHistoryStoreRequest(requestUrl, method)) return null;
    const storeKey = localHistoryStoreKey(userId, method, requestUrl, bodyFingerprint);
    try {
      const raw = await fs.readFile(localHistoryPath(storeKey), "utf8");
      const entry = JSON.parse(raw);
      if (entry?.userId !== userId || typeof entry.body !== "string") return null;
      const sanitizedBody = sanitizeLocalHistoryPayload(requestUrl, entry.body);
      if (!sanitizedBody) return null;
      entry.body = sanitizedBody;
      entry.lastAccessedAt = Date.now();
      await fs.writeFile(localHistoryPath(storeKey), JSON.stringify(entry), "utf8").catch(() => undefined);
      return entry;
    } catch {
      return null;
    }
  };

  const readBaseDetailEntry = async (userId, method, requestUrl, options = {}) => {
    const cacheKey = `user:${userId}:${method}:${normalizeWithoutRefresh(requestUrl)}`;
    const entry = await readEntry(cacheKey, options);
    return entry?.userId === userId ? { cacheKey, entry } : null;
  };

  const maybeServeSuppressedTvDetailRefresh = async (userId, method, requestUrl) => {
    if (method !== "GET" || !isTvDetailRefreshRequest(requestUrl)) return null;
    const base = await readBaseDetailEntry(userId, method, requestUrl);
    if (!base || !isEndedTvDetail(base.entry.body)) return null;

    const lastCheckedAt =
      typeof base.entry.tmdbStatusCheckedAt === "number"
        ? base.entry.tmdbStatusCheckedAt
        : base.entry.fetchedAt;
    const waitMs = endedDetailRevalidateMs(base.entry.completedStableChecks);
    if (lastCheckedAt + waitMs <= Date.now()) return null;

    await touchEntry(base.cacheKey, base.entry).catch(() => undefined);
    return makeJsonResponse(base.entry.body, base.entry.statusCode ?? 200);
  };

  const touchEntry = async (cacheKey, entry, patch = {}) => {
    const now = Date.now();
    const maxExpiresAt =
      entry.longLivedUserCache === true
        ? entry.fetchedAt + USER_DATA_CACHE_MS
        : entry.fetchedAt + TMDB_MAX_CACHE_MS;
    const nextEntry = {
      ...entry,
      ...patch,
      lastAccessedAt: now,
      // TMDB-backed entries never extend beyond six months from the original
      // network fetch; user history entries can live much longer.
      expiresAt: Math.min(entry.expiresAt, maxExpiresAt),
    };
    await writeEntry(cacheKey, nextEntry).catch(() => undefined);
  };

  const clearUserCache = async (userId, options = {}) => {
    if (!userId) return;
    const {
      scope = null,
      includeGeneral = false,
      includeWatchlist = true,
      includeCalendar = false,
    } = options;
    try {
      const files = await fs.readdir(cacheRoot);
      await Promise.all(
        files.map(async (file) => {
          if (!file.endsWith(".json")) return;
          const filePath = path.join(cacheRoot, file);
          try {
            const raw = await fs.readFile(filePath, "utf8");
            const entry = JSON.parse(raw);
            const entryUrl = String(entry?.url ?? "");
            const isWatchlistEntry = entryUrl.startsWith("/api/watchlist/");
            const isCalendarEntry = entryUrl.startsWith(CALENDAR_MONTH_DATA_PATH);
            const shouldCheckScope = !isCalendarEntry;
            if (
              entry?.userId === userId &&
              (
                (includeWatchlist && isWatchlistEntry) ||
                (includeCalendar && isCalendarEntry) ||
                (includeGeneral && !isWatchlistEntry && !isCalendarEntry)
              ) &&
              (!shouldCheckScope || entryMatchesScope(entry, scope))
            ) {
              await fs.unlink(filePath);
            }
          } catch {
            await fs.unlink(filePath).catch(() => undefined);
          }
        }),
      );
    } catch {
      // Cache cleanup should never block normal navigation.
    }
  };

  const clearAllCache = async () => {
    identityCache.clear();
    await fs.rm(cacheRoot, { recursive: true, force: true }).catch(() => undefined);
  };

  const getIdentity = async (headers) => {
    const cookie = getHeader(headers, "cookie") ?? "";
    if (!cookie) return null;
    const cookieFingerprint = hash(cookie);
    const cached = identityCache.get(cookieFingerprint);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.userId;
    }

    const response = await defaultSession.fetch(`${appOrigin}/api/profile/me`, {
      headers: sanitizeRequestHeaders(headers),
      cache: "no-store",
      bypassCustomProtocolHandlers: true,
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    const userId = payload?.profile?.userId ?? payload?.user?.id ?? payload?.id ?? null;
    if (typeof userId !== "string" || userId.length === 0) return null;
    identityCache.set(cookieFingerprint, {
      userId,
      expiresAt: Date.now() + IDENTITY_CACHE_MS,
    });
    return userId;
  };

  const fetchNetwork = async (request, options = {}) => {
    const body = uploadBodyBuffer(request);
    const fetchOptions = {
      method: request.method,
      headers: sanitizeRequestHeaders(request.headers),
      body: body && request.method !== "GET" && request.method !== "HEAD" ? body : undefined,
      bypassCustomProtocolHandlers: true,
    };
    if (options.cache) {
      fetchOptions.cache = options.cache;
    }
    if (options.redirect) {
      fetchOptions.redirect = options.redirect;
    }
    return defaultSession.fetch(request.url, fetchOptions);
  };

  const fetchRevision = async (revisionUrl, headers) => {
    if (!revisionUrl) return null;
    const response = await defaultSession.fetch(revisionUrl, {
      headers: sanitizeRequestHeaders(headers),
      cache: "no-store",
      bypassCustomProtocolHandlers: true,
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    return typeof payload?.revision === "string" ? payload.revision : null;
  };

  const collectTmdbIdsFromPayload = (payload) => {
    const ids = new Set();
    const visit = (value) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      const tmdbId = value.tmdb_id ?? value.tmdbId;
      if (typeof tmdbId === "number" && Number.isInteger(tmdbId) && tmdbId > 0) {
        ids.add(tmdbId);
      }
      Object.values(value).forEach(visit);
    };
    visit(payload);
    return Array.from(ids);
  };

  const writeJsonCacheEntry = async ({
    userId,
    requestUrl,
    method,
    bodyFingerprint = "",
    statusCode,
    revision,
    friendsRevision = null,
    body,
    cacheScope,
  }) => {
    const now = Date.now();
    const requestCacheKey = `user:${userId}:${method}:${normalizeCacheUrl(requestUrl)}${bodyFingerprint}`;
    let parsedBody = null;
    try {
      parsedBody = JSON.parse(body);
    } catch {
      parsedBody = null;
    }
    const payloadTmdbIds = collectTmdbIdsFromPayload(parsedBody);
    const containsTmdbContent = !isUserHistoryOnlyRequest(requestUrl);
    const longLivedUserCache = canUseLongLivedUserHistoryCache(requestUrl, cacheScope);
    const previousBaseDetail =
      isTmdbDetailRequest(requestUrl) && requestUrl.searchParams.get("type") === "tv"
        ? await readBaseDetailEntry(userId, method, requestUrl, { allowExpired: true })
        : null;
    const previousStableChecks =
      previousBaseDetail?.entry && Number.isInteger(previousBaseDetail.entry.completedStableChecks)
        ? previousBaseDetail.entry.completedStableChecks
        : 0;
    const endedTvDetail = isTmdbDetailRequest(requestUrl) &&
      requestUrl.searchParams.get("type") === "tv" &&
      isEndedTvDetail(body);
    const previousDetailBodyChanged =
      typeof previousBaseDetail?.entry?.body === "string" &&
      previousBaseDetail.entry.body !== body;
    const previousDetailWasExpired =
      typeof previousBaseDetail?.entry?.expiresAt === "number" &&
      previousBaseDetail.entry.expiresAt <= now;
    const completedStableChecks = endedTvDetail
      ? previousBaseDetail && !previousDetailBodyChanged
        ? previousDetailWasExpired && !isTvDetailRefreshRequest(requestUrl)
          ? Math.min(
              ENDED_DETAIL_REVALIDATE_STEPS_MS.length - 1,
              previousStableChecks + 1,
            )
          : previousStableChecks
        : 0
      : 0;
    const ttlMs =
      longLivedUserCache
        ? USER_DATA_CACHE_MS
        : endedTvDetail
        ? endedDetailRevalidateMs(completedStableChecks)
        : requestUrl.pathname.startsWith("/api/tmdb/")
          || isUserHistoryOnlyRequest(requestUrl)
        ? DAILY_REVALIDATE_MS
        : TMDB_MAX_CACHE_MS;
    const cacheEntry = {
      version: 1,
      userId,
      url: normalizeCacheUrl(requestUrl),
      method,
      mediaType: cacheScope.mediaType,
      tmdbId: cacheScope.tmdbId,
      tmdbIds: Array.from(new Set([
        ...(cacheScope.tmdbId ? [cacheScope.tmdbId] : []),
        ...(Array.isArray(cacheScope.tmdbIds) ? cacheScope.tmdbIds : []),
        ...payloadTmdbIds,
      ])),
      isAnime: cacheScope.isAnime,
      statusCode,
      revision,
      friendsRevision,
      revisionCheckedAt: revision ? now : null,
      friendsRevisionCheckedAt: friendsRevision ? now : null,
      containsTmdbContent,
      longLivedUserCache,
      ...(isTmdbDetailRequest(requestUrl) && requestUrl.searchParams.get("type") === "tv"
        ? {
            completedStableChecks,
            tmdbStatusCheckedAt: now,
          }
        : {}),
      body,
      fetchedAt: now,
      lastAccessedAt: now,
      expiresAt: Math.min(
        now + ttlMs,
        now + (longLivedUserCache ? USER_DATA_CACHE_MS : TMDB_MAX_CACHE_MS),
      ),
    };
    await writeEntry(requestCacheKey, cacheEntry);
    await writeLocalHistoryEntry({
      userId,
      requestUrl,
      method,
      bodyFingerprint,
      revision,
      friendsRevision,
      body,
      cacheScope,
    }).catch(() => undefined);
    const shouldWriteBaseDetail =
      isTvDetailRefreshRequest(requestUrl) &&
      previousBaseDetail?.cacheKey !== requestCacheKey;
    if (shouldWriteBaseDetail) {
      const baseCacheKey =
        previousBaseDetail?.cacheKey ??
        `user:${userId}:${method}:${normalizeWithoutRefresh(requestUrl)}`;
      await writeEntry(baseCacheKey, {
        ...(previousBaseDetail?.entry ?? cacheEntry),
        url: normalizeWithoutRefresh(requestUrl),
        statusCode,
        body,
        fetchedAt: now,
        lastAccessedAt: now,
        completedStableChecks,
        tmdbStatusCheckedAt: now,
        expiresAt: Math.min(now + TMDB_MAX_CACHE_MS, now + ttlMs),
      });
    }
  };

  const refreshWatchlistScope = async (userId, headers, scope) => {
    if (!scope?.mediaType) return;
    const targets =
      scope.mediaType === "tv" && typeof scope.isAnime !== "boolean"
        ? [
            { mediaType: "tv", isAnime: false },
            { mediaType: "tv", isAnime: true },
          ]
        : [{ mediaType: scope.mediaType, isAnime: scope.isAnime === true }];

    await Promise.all(
      targets.flatMap((target) =>
        ["/api/watchlist/section-data", "/api/watchlist/items", "/api/watchlist/has-data"].map(
          async (pathname) => {
            const requestUrl = new URL(pathname, appOrigin);
            requestUrl.searchParams.set("mediaType", target.mediaType);
            requestUrl.searchParams.set("isAnime", String(target.isAnime));
            const response = await defaultSession.fetch(requestUrl.toString(), {
              headers: sanitizeRequestHeaders(headers),
              cache: "no-store",
              bypassCustomProtocolHandlers: true,
            });
            if (!response.ok) return;
            const contentType = response.headers.get("content-type") ?? "";
            if (!contentType.toLowerCase().includes("application/json")) return;
            const body = await response.text();
            const revision = await fetchRevision(
              buildRevisionUrl(appOrigin, requestUrl),
              headers,
            ).catch(() => null);
            await writeJsonCacheEntry({
              userId,
              requestUrl,
              method: "GET",
              statusCode: response.status,
              revision,
              body,
              cacheScope: {
                mediaType: target.mediaType,
                tmdbId: null,
                isAnime: target.isAnime,
              },
            });
          },
        ),
      ),
    );
  };

  const handleRequest = async (request) => {
    const requestUrl = new URL(request.url);
    const method = request.method.toUpperCase();
    if (requestUrl.origin !== appOrigin || !requestUrl.pathname.startsWith("/api/")) {
      return toProtocolResponse(await fetchNetwork(request, { cache: "default" }));
    }

    if (requestUrl.pathname.startsWith(AUTH_PATH_PREFIX)) {
      const response = await fetchNetwork(request, { cache: "no-store", redirect: "manual" });
      if (response.ok || response.status === 302 || response.status === 303) {
        await clearAllCache();
      }
      return toProtocolResponse(response);
    }

    const userId = await getIdentity(request.headers).catch(() => null);
    if (!userId) {
      return toProtocolResponse(await fetchNetwork(request, { cache: "no-store" }));
    }

    if (isUserMutation(requestUrl, method)) {
      const response = await fetchNetwork(request, { cache: "no-store" });
      if (response.ok) {
        const scope = scopeFromPayload(requestUrl, request);
        await clearUserCache(userId, {
          scope,
          includeGeneral: true,
          includeWatchlist: true,
          includeCalendar: true,
        });
        void refreshWatchlistScope(userId, request.headers, scope).catch((error) => {
          console.warn("[desktop-cache] background refresh failed", {
            userId,
            path: requestUrl.pathname,
            message: error instanceof Error ? error.message : String(error),
          });
        });
      }
      return toProtocolResponse(response, { "x-watch-desktop-cache": "invalidated" });
    }

    if (!isWatchlistCacheable(requestUrl, method) && !isGeneralCacheable(requestUrl, method)) {
      return toProtocolResponse(await fetchNetwork(request, { cache: "no-store" }));
    }

    let bypassCacheRead = false;
    if (isExplicitRefreshRequest(requestUrl)) {
      const suppressedRefresh = await maybeServeSuppressedTvDetailRefresh(
        userId,
        method,
        requestUrl,
      );
      if (suppressedRefresh) {
        return suppressedRefresh;
      }
      if (!isTvDetailRefreshRequest(requestUrl)) {
        return toProtocolResponse(
          await fetchNetwork(request, { cache: "no-store" }),
          { "x-watch-desktop-cache": "bypass" },
        );
      }
      bypassCacheRead = true;
    }

    const cacheScope = cacheScopeFromRequest(requestUrl, request);
    const revisionUrl =
      buildRevisionUrl(appOrigin, requestUrl) ?? buildRevisionUrlFromScope(appOrigin, cacheScope);
    const friendsRevisionUrl = buildFriendsRevisionUrl(appOrigin, requestUrl);
    const bodyFingerprint =
      method === "GET" ? "" : `:${hash(uploadBodyBuffer(request)?.toString("utf8") ?? "")}`;
    const requestCacheKey = `user:${userId}:${method}:${normalizeCacheUrl(requestUrl)}${bodyFingerprint}`;
    const entry = await readEntry(requestCacheKey);
    if (!bypassCacheRead && entry?.userId === userId) {
      const now = Date.now();
      let friendsRevision = null;
      let friendsRevisionPatch = {};
      if (friendsRevisionUrl) {
        const recentlyCheckedFriendsRevision =
          entry.friendsRevision &&
          (entry.friendsRevisionCheckedAt ?? 0) + DAILY_REVALIDATE_MS > now;
        if (recentlyCheckedFriendsRevision) {
          friendsRevision = entry.friendsRevision;
        } else {
          friendsRevision = await fetchRevision(friendsRevisionUrl, request.headers).catch(() => null);
          if (!friendsRevision || friendsRevision !== entry.friendsRevision) {
            await fs.unlink(cachePath(requestCacheKey)).catch(() => undefined);
            return toProtocolResponse(
              await fetchNetwork(request, { cache: "no-store" }),
              { "x-watch-desktop-cache": "stale-friends" },
            );
          }
          friendsRevisionPatch = {
            friendsRevision,
            friendsRevisionCheckedAt: now,
          };
        }
      }
      if (revisionUrl && entry.revision && (entry.revisionCheckedAt ?? 0) + DAILY_REVALIDATE_MS > now) {
        await touchEntry(requestCacheKey, entry, friendsRevisionPatch);
        return makeJsonResponse(entry.body, entry.statusCode ?? 200);
      }
      if (!revisionUrl && entry.longLivedUserCache === true && entry.expiresAt > now) {
        await touchEntry(requestCacheKey, entry, friendsRevisionPatch);
        return makeJsonResponse(entry.body, entry.statusCode ?? 200);
      }
      if (!revisionUrl && entry.fetchedAt + DAILY_REVALIDATE_MS > now) {
        await touchEntry(requestCacheKey, entry, friendsRevisionPatch);
        return makeJsonResponse(entry.body, entry.statusCode ?? 200);
      }
      const revision = await fetchRevision(revisionUrl, request.headers).catch(() => null);
      if (revision && revision === entry.revision) {
        await touchEntry(requestCacheKey, entry, {
          revisionCheckedAt: now,
          ...friendsRevisionPatch,
        });
        return makeJsonResponse(entry.body, entry.statusCode ?? 200);
      }
    }

    const localHistoryEntry = await readLocalHistoryEntry(
      userId,
      method,
      requestUrl,
      bodyFingerprint,
    );
    if (localHistoryEntry && !isExplicitRefreshRequest(requestUrl)) {
      void (async () => {
        try {
          const response = await fetchNetwork(request, { cache: "no-store" });
          const contentType = response.headers.get("content-type") ?? "";
          if (!response.ok || !contentType.toLowerCase().includes("application/json")) return;
          const body = await response.text();
          const revision = await fetchRevision(revisionUrl, request.headers).catch(() => null);
          const friendsRevision = await fetchRevision(friendsRevisionUrl, request.headers).catch(() => null);
          await writeJsonCacheEntry({
            userId,
            requestUrl,
            method,
            bodyFingerprint,
            statusCode: response.status,
            revision,
            friendsRevision,
            body,
            cacheScope,
          });
        } catch (error) {
          console.warn("[desktop-cache] local history refresh failed", {
            userId,
            path: requestUrl.pathname,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      })();
      return makeJsonResponse(localHistoryEntry.body, 200, {
        "x-watch-desktop-cache": "local-history",
      });
    }

    const response = await fetchNetwork(request, { cache: "no-store" });
    const protocolResponse = await toProtocolResponse(response, { "x-watch-desktop-cache": "miss" });
    const contentType = getHeader(protocolResponse.headers ?? {}, "content-type") ?? "";
    if (response.ok && contentType.toLowerCase().includes("application/json")) {
      const body = protocolResponse.data.toString("utf8");
      const revision = await fetchRevision(revisionUrl, request.headers).catch(() => null);
      const friendsRevision = await fetchRevision(friendsRevisionUrl, request.headers).catch(() => null);
      await writeJsonCacheEntry({
        userId,
        requestUrl,
        method,
        bodyFingerprint,
        statusCode: response.status,
        revision,
        friendsRevision,
        body,
        cacheScope,
      }).catch(() => undefined);
    }
    return protocolResponse;
  };

  const installed = defaultSession.protocol.interceptBufferProtocol(
    appProtocol,
    (request, callback) => {
      handleRequest(request)
        .then(callback)
        .catch((error) => {
          console.error("[desktop-cache] request failed", {
            url: request.url,
            message: error instanceof Error ? error.message : String(error),
          });
          callback({ error: -2 });
        });
    },
  );

  if (!installed) {
    console.warn("[desktop-cache] protocol interception was not installed");
  }
}
