import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { session } from "electron";

const DAY_MS = 24 * 60 * 60 * 1000;
const TMDB_MAX_CACHE_MS = 180 * DAY_MS;
const IDENTITY_CACHE_MS = 10 * 60 * 1000;
const DAILY_REVALIDATE_MS = DAY_MS;

const CACHEABLE_WATCHLIST_PATHS = new Set([
  "/api/watchlist/section-data",
  "/api/watchlist/items",
  "/api/watchlist/has-data",
]);

const CACHEABLE_GENERAL_PATHS = new Set([
  "/api/detail/history-count",
  "/api/detail/history-episodes",
  "/api/detail/history-records",
  "/api/detail/history-season-records",
  "/api/detail/watchlist-map",
  "/api/detail/watchlist-state",
  "/api/home/watchlist-map",
  "/api/tmdb/detail",
  "/api/tmdb/season",
  "/api/watchlist/tv-states",
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

const makeJsonResponse = (payload, statusCode = 200) => ({
  statusCode,
  mimeType: "application/json",
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-watch-desktop-cache": "hit",
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
  const revisionUrl = new URL("/api/watchlist/revision", appOrigin);
  revisionUrl.searchParams.set("mediaType", mediaType);
  revisionUrl.searchParams.set("isAnime", String(requestUrl.searchParams.get("isAnime") === "true"));
  return revisionUrl.toString();
};

const buildRevisionUrlFromScope = (appOrigin, scope) => {
  if (!scope || (scope.mediaType !== "movie" && scope.mediaType !== "tv")) return null;
  const revisionUrl = new URL("/api/watchlist/revision", appOrigin);
  revisionUrl.searchParams.set("mediaType", scope.mediaType);
  revisionUrl.searchParams.set("isAnime", String(scope.isAnime === true));
  return revisionUrl.toString();
};

const isWatchlistCacheable = (requestUrl, method) =>
  method === "GET" && CACHEABLE_WATCHLIST_PATHS.has(requestUrl.pathname);

const isGeneralCacheable = (requestUrl, method) =>
  (method === "GET" || method === "POST") &&
  CACHEABLE_GENERAL_PATHS.has(requestUrl.pathname);

const isExplicitRefreshRequest = (requestUrl) => requestUrl.searchParams.get("refresh") === "1";

const isUserMutation = (requestUrl, method) => {
  if (requestUrl.pathname.startsWith(AUTH_PATH_PREFIX)) return true;
  if (method !== "POST" && method !== "PUT" && method !== "PATCH" && method !== "DELETE") {
    return false;
  }
  return MUTATING_USER_PATHS.includes(requestUrl.pathname);
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
  const id =
    requestUrl.searchParams.get("id") ??
    requestUrl.searchParams.get("tmdbId") ??
    requestUrl.searchParams.get("tmdb_id");
  const tmdbId =
    typeof id === "string" && /^\d+$/.test(id) ? Number(id) : payloadScope?.tmdbId ?? null;
  const mediaType =
    payloadScope?.mediaType ??
    requestUrl.searchParams.get("mediaType") ??
    requestUrl.searchParams.get("type");
  return {
    mediaType: mediaType === "movie" || mediaType === "tv" ? mediaType : null,
    tmdbId,
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
  const identityCache = new Map();

  const cachePath = (cacheKey) => path.join(cacheRoot, `${hash(cacheKey)}.json`);

  const readEntry = async (cacheKey) => {
    try {
      const raw = await fs.readFile(cachePath(cacheKey), "utf8");
      const entry = JSON.parse(raw);
      if (!entry || typeof entry !== "object") return null;
      if (typeof entry.expiresAt !== "number" || entry.expiresAt <= Date.now()) return null;
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

  const touchEntry = async (cacheKey, entry) => {
    const now = Date.now();
    const nextEntry = {
      ...entry,
      lastAccessedAt: now,
      // TMDB data can be embedded in these responses, so this never extends
      // beyond six months from the original network fetch.
      expiresAt: Math.min(entry.expiresAt, entry.fetchedAt + TMDB_MAX_CACHE_MS),
    };
    await writeEntry(cacheKey, nextEntry).catch(() => undefined);
  };

  const clearUserCache = async (userId, options = {}) => {
    if (!userId) return;
    const { scope = null, includeGeneral = false, includeWatchlist = true } = options;
    try {
      const files = await fs.readdir(cacheRoot);
      await Promise.all(
        files.map(async (file) => {
          if (!file.endsWith(".json")) return;
          const filePath = path.join(cacheRoot, file);
          try {
            const raw = await fs.readFile(filePath, "utf8");
            const entry = JSON.parse(raw);
            if (
              entry?.userId === userId &&
              (
                (includeWatchlist && String(entry?.url ?? "").startsWith("/api/watchlist/")) ||
                (includeGeneral && !String(entry?.url ?? "").startsWith("/api/watchlist/"))
              ) &&
              entryMatchesScope(entry, scope)
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

  const writeJsonCacheEntry = async ({
    userId,
    requestUrl,
    method,
    bodyFingerprint = "",
    statusCode,
    revision,
    body,
    cacheScope,
  }) => {
    const now = Date.now();
    const requestCacheKey = `user:${userId}:${method}:${normalizeCacheUrl(requestUrl)}${bodyFingerprint}`;
    const ttlMs =
      requestUrl.pathname.startsWith("/api/tmdb/") ||
      requestUrl.pathname === "/api/detail/history-count" ||
      requestUrl.pathname === "/api/detail/history-episodes" ||
      requestUrl.pathname === "/api/detail/history-season-records"
        ? DAILY_REVALIDATE_MS
        : TMDB_MAX_CACHE_MS;
    await writeEntry(requestCacheKey, {
      version: 1,
      userId,
      url: normalizeCacheUrl(requestUrl),
      method,
      mediaType: cacheScope.mediaType,
      tmdbId: cacheScope.tmdbId,
      tmdbIds: cacheScope.tmdbId ? [cacheScope.tmdbId] : [],
      isAnime: cacheScope.isAnime,
      statusCode,
      revision,
      body,
      fetchedAt: now,
      lastAccessedAt: now,
      expiresAt: Math.min(now + ttlMs, now + TMDB_MAX_CACHE_MS),
    });
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
          includeWatchlist: false,
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

    if (isExplicitRefreshRequest(requestUrl)) {
      return toProtocolResponse(
        await fetchNetwork(request, { cache: "no-store" }),
        { "x-watch-desktop-cache": "bypass" },
      );
    }

    const cacheScope = cacheScopeFromRequest(requestUrl, request);
    const revisionUrl =
      buildRevisionUrl(appOrigin, requestUrl) ?? buildRevisionUrlFromScope(appOrigin, cacheScope);
    const bodyFingerprint =
      method === "GET" ? "" : `:${hash(uploadBodyBuffer(request)?.toString("utf8") ?? "")}`;
    const requestCacheKey = `user:${userId}:${method}:${normalizeCacheUrl(requestUrl)}${bodyFingerprint}`;
    const entry = await readEntry(requestCacheKey);
    if (entry?.userId === userId) {
      const revision = await fetchRevision(revisionUrl, request.headers).catch(() => null);
      if ((!revisionUrl && entry.expiresAt > Date.now()) || (revision && revision === entry.revision)) {
        await touchEntry(requestCacheKey, entry);
        return makeJsonResponse(entry.body, entry.statusCode ?? 200);
      }
    }

    const response = await fetchNetwork(request, { cache: "no-store" });
    const protocolResponse = await toProtocolResponse(response, { "x-watch-desktop-cache": "miss" });
    const contentType = getHeader(protocolResponse.headers ?? {}, "content-type") ?? "";
    if (response.ok && contentType.toLowerCase().includes("application/json")) {
      const body = protocolResponse.data.toString("utf8");
      const revision = await fetchRevision(revisionUrl, request.headers).catch(() => null);
      await writeJsonCacheEntry({
        userId,
        requestUrl,
        method,
        bodyFingerprint,
        statusCode: response.status,
        revision,
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
