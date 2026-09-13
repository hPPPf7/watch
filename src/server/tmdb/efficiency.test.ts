import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  read: vi.fn(), readMany: vi.fn(), write: vi.fn(), charge: vi.fn(), db: vi.fn(),
  redis: { enabled: false, get: vi.fn(), eval: vi.fn() },
}));
vi.mock("@/server/tmdb/cache", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/tmdb/cache")>(),
  readTmdbCache: io.read,
  readManyTmdbCacheIncludingExpired: io.readMany,
  writeTmdbCache: io.write,
}));
vi.mock("@/server/db/client", () => ({ getDb: io.db }));
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "test-user" } }) }));
vi.mock("@/server/tmdb/auth", () => ({ getOptionalTmdbUserId: async () => null }));
vi.mock("@/server/tmdb/rateLimit", () => ({
  enforceTmdbProxyRateLimit: () => ({ beforeStart: io.charge, apply: (response: Response) => response }),
}));
vi.mock("@/server/realtime/redis", () => ({
  isRedisRealtimeEnabled: () => io.redis.enabled,
  getRedisPublisher: () => io.redis,
}));

const request = (path: string) => new Request(`https://watch.invalid/api/tmdb/${path}`);
const upstreamPayload = {
  id: 1, title: "作品", name: "作品", original_title: "Original", original_name: "Original",
  original_language: "en", overview: "簡介", poster_path: "/poster", homepage: "https://example.test",
  release_date: "2020-01-01", runtime: 90,
  production_countries: [{ iso_3166_1: "US" }], spoken_languages: [{ iso_639_1: "en" }],
  results: [], parts: [], total_pages: 1,
};

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-13T00:00:00Z"));
  vi.stubEnv("TMDB_API_KEY", "test-only");
  io.read.mockReset().mockResolvedValue(null);
  io.readMany.mockReset().mockResolvedValue(new Map());
  io.write.mockReset().mockResolvedValue(undefined);
  io.charge.mockReset();
  io.db.mockReset().mockImplementation(() => { throw new Error("Unexpected database access"); });
  io.redis.enabled = false;
  io.redis.get.mockReset();
  io.redis.eval.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(upstreamPayload)));
});
afterEach(() => {
  expect(io.db).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const routes = [
  ["detail", "detail?type=movie&id=1", () => import("@/app/api/tmdb/detail/route"), 1, 2],
  ["search", "search?query=test", () => import("@/app/api/tmdb/search/route"), 1, 1],
  ["collection", "collection?id=1", () => import("@/app/api/tmdb/collection/route"), 1, 1],
  ["movies", "movies/recommendations", () => import("@/app/api/tmdb/movies/recommendations/route"), 4, 1],
  ["tv", "tv/recommendations", () => import("@/app/api/tmdb/tv/recommendations/route"), 3, 1],
  ["anime", "anime/recommendations", () => import("@/app/api/tmdb/anime/recommendations/route"), 3, 1],
] as const;

describe("shared TMDB jobs include persistence", () => {
  it.each(routes)("%s shares fetch, writes and rate charge with waiters arriving during persistence", async (_name, path, load, upstreamCount, writeCount) => {
    const { GET } = await load();
    let finishWrite!: () => void;
    const writing = new Promise<void>((resolve) => { finishWrite = resolve; });
    io.write.mockImplementation(() => writing);
    const first = GET(request(path));
    await vi.waitFor(() => expect(io.write).toHaveBeenCalledTimes(1));
    const waiters = Array.from({ length: 8 }, () => GET(request(path)));
    // These requests must have reached cache miss while the first write remains pending.
    await vi.waitFor(() => expect(io.read.mock.calls.length).toBeGreaterThanOrEqual(9));
    finishWrite();
    const responses = await Promise.all([first, ...waiters]);
    const payloads = await Promise.all(responses.map((response) => response.json()));
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(payloads.every((payload) => JSON.stringify(payload) === JSON.stringify(payloads[0]))).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(upstreamCount);
    expect(io.write).toHaveBeenCalledTimes(writeCount);
    expect(io.charge).toHaveBeenCalledTimes(1);
    if (_name === "detail") expect(io.readMany).toHaveBeenCalledTimes(1);
  });

  it("calendar refresh and batch callers share one backoff update through the write", async () => {
    const api = await import("./calendarMetadata");
    const previous = {
      payload: { title: "Original", isAnime: false, titleNeedsRefresh: true, titleRefreshAttempts: 2 },
      expired: true, expiresAt: new Date(Date.now() - 1), updatedAt: new Date(Date.now() - 86_400_000),
    };
    io.readMany.mockResolvedValue(new Map([[api.buildCalendarMetadataKey("movie", 1), previous]]));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ title: "Original", original_title: "Original", original_language: "en" })));
    let finishWrite!: () => void;
    io.write.mockImplementation(() => new Promise<void>((resolve) => { finishWrite = resolve; }));
    const cachedState = await api.readCalendarMetadataCacheState("movie", 1);
    const first = api.refreshCalendarMetadataIfTitleNeedsRefresh("movie", 1, { beforeStart: io.charge, cachedState });
    const simultaneous = api.getCalendarMetadataBatch([{ mediaType: "movie", tmdbId: 1 }]);
    await vi.waitFor(() => expect(io.write).toHaveBeenCalledTimes(1));
    const later = api.getCalendarMetadata("movie", 1);
    await vi.waitFor(() => expect(io.readMany).toHaveBeenCalledTimes(3));
    finishWrite();
    const [metadata, batch, lateMetadata] = await Promise.all([first, simultaneous, later]);
    expect(metadata?.titleRefreshAttempts).toBe(3);
    expect(batch.get("movie:1")?.metadata).toEqual(metadata);
    expect(lateMetadata).toEqual(metadata);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(io.write).toHaveBeenCalledExactlyOnceWith(api.buildCalendarMetadataKey("movie", 1), metadata, 4 * 86_400_000, { skipRedisMirror: true });
    expect(io.charge).toHaveBeenCalledTimes(1);
  });
});

it.each([false, true])("stable detail hit reads metadata once, including title backoff=%s", async (titleNeedsRefresh) => {
  const { GET } = await import("@/app/api/tmdb/detail/route");
  io.read.mockResolvedValue({ title: "Original", original_title: "Original" });
  io.readMany.mockResolvedValue(new Map([["tmdb:calendar-meta:movie:1", {
    payload: { title: "Original", isAnime: false, titleNeedsRefresh, titleRefreshAttempts: 3 },
    expired: false, expiresAt: new Date(Date.now() + 2 * 86_400_000), updatedAt: new Date(),
  }]]));
  expect((await GET(request("detail?type=movie&id=1"))).status).toBe(200);
  expect(io.readMany).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
  expect(io.write).not.toHaveBeenCalled();
  expect(io.charge).not.toHaveBeenCalled();
});

it.each(["search", "collection", "calendar", "recommendations"])("429 from %s blocks every upstream entry until Retry-After expires", async (origin) => {
  const search = await import("@/app/api/tmdb/search/route");
  const collection = await import("@/app/api/tmdb/collection/route");
  const detail = await import("./detail");
  const calendar = await import("./calendarMetadata");
  const recommendations = await import("./recommendationFetch");
  const season = await import("@/app/api/tmdb/season/route");
  const upstream = vi.fn(async () => new Response(null, { status: 429, headers: { "Retry-After": "120" } }));
  vi.stubGlobal("fetch", upstream);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  if (origin === "search") await search.GET(request("search?query=first"));
  if (origin === "collection") await collection.GET(request("collection?id=1"));
  if (origin === "calendar") await calendar.getCalendarMetadata("movie", 1);
  if (origin === "recommendations") await recommendations.fetchRecommendationJson("https://api.themoviedb.org/3/movie/popular").catch(() => undefined);
  const started = upstream.mock.calls.length;
  const searchResponse = await search.GET(request("search?query=second"));
  const collectionResponse = await collection.GET(request("collection?id=2"));
  expect(searchResponse.status).toBe(429);
  expect(searchResponse.headers.get("Retry-After")).toBe("120");
  expect(collectionResponse.status).toBe(429);
  expect(collectionResponse.headers.get("Retry-After")).toBe("120");
  await expect(detail.getTmdbDetail("movie", "2")).rejects.toThrow("TMDB detail failed:429");
  expect((await season.GET(request("season?type=tv&id=2&season=1"))).status).toBe(429);
  expect(await calendar.getCalendarMetadata("movie", 2)).toBeNull();
  await expect(recommendations.fetchRecommendationJson("https://api.themoviedb.org/3/tv/popular")).rejects.toThrow();
  expect(upstream).toHaveBeenCalledTimes(started);
  expect(io.write).not.toHaveBeenCalled();
  io.read.mockResolvedValueOnce({ results: [{ id: 9 }] });
  expect((await search.GET(request("search?query=cached"))).status).toBe(200);
  vi.setSystemTime(Date.now() + 120_000);
  upstream.mockImplementation(async () => Response.json({ results: [] }));
  expect((await search.GET(request("search?query=recovered"))).status).toBe(200);
  expect(upstream).toHaveBeenCalledTimes(started + 1);
});

it("recommendation Redis 429 also stops local detail calls without another Redis read", async () => {
  io.redis.enabled = true;
  io.redis.get.mockResolvedValue(JSON.stringify({ until: Date.now() + 120_000, status: 429 }));
  const recommendation = await import("./recommendationFetch");
  const detail = await import("./detail");
  await expect(recommendation.assertRecommendationsAvailable()).rejects.toThrow();
  await expect(detail.getTmdbDetail("movie", "1")).rejects.toThrow("TMDB detail failed:429");
  expect(io.redis.get).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
  expect(io.write).not.toHaveBeenCalled();
});

it("a later concurrent 429 extends an existing recommendation error deadline", async () => {
  const shared = await import("./fetchWithCooldown");
  const recommendations = await import("./recommendationFetch");
  let finishDetail!: (response: Response) => void;
  const upstream = vi.fn()
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishDetail = resolve; }))
    .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "60" } }));
  vi.stubGlobal("fetch", upstream);
  const detailRequest = shared.fetchTmdbWithCooldown("https://api.themoviedb.org/3/movie/1");
  const error = await recommendations.fetchRecommendationJson("https://api.themoviedb.org/3/movie/popular").catch((error: unknown) => error);
  finishDetail(new Response(null, { status: 429, headers: { "Retry-After": "300" } }));
  await detailRequest;
  expect(recommendations.recommendationErrorResponse(error).headers.get("Retry-After")).toBe("300");
  const nextError = await recommendations.assertRecommendationsAvailable().catch((error: unknown) => error);
  expect(recommendations.recommendationErrorResponse(nextError).headers.get("Retry-After")).toBe("300");
  expect(upstream).toHaveBeenCalledTimes(2);
});
