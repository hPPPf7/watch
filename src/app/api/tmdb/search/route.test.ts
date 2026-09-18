import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  read: vi.fn(), write: vi.fn(), charge: vi.fn(), auth: vi.fn(), optionalUser: vi.fn(),
  db: vi.fn(), redisRead: vi.fn(), redisWrite: vi.fn(),
  cache: new Map<string, unknown>(),
  rateResponse: null as Response | null,
}));

vi.mock("@/server/tmdb/cache", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/tmdb/cache")>(),
  readTmdbCache: io.read,
  writeTmdbCache: io.write,
}));
vi.mock("@/server/db/client", () => ({ getDb: io.db }));
vi.mock("@/server/realtime/redis", () => ({
  readThroughRedis: io.redisRead,
  writeRedisJson: io.redisWrite,
}));
vi.mock("@/auth", () => ({ auth: io.auth }));
vi.mock("@/server/tmdb/auth", () => ({ getOptionalTmdbUserId: io.optionalUser }));
vi.mock("@/server/tmdb/rateLimit", () => ({
  enforceTmdbProxyRateLimit: () => ({
    beforeStart: io.charge,
    apply: (response: Response) => response,
    get response() { return io.rateResponse; },
  }),
}));

const request = (params = "query=test") =>
  new Request(`https://watch.invalid/api/tmdb/search?${params}`);
const movie = (overrides: Record<string, unknown> = {}) => ({
  id: 1, media_type: "movie", title: "繁體片名", original_title: "Original title",
  original_language: "en", overview: "繁體簡介", poster_path: "/poster.jpg",
  release_date: "2020-01-02", genre_ids: [18], ...overrides,
});
const upstreamPayload = (page = 1, results: unknown[] = [movie()], totalPages = 2) => ({
  results, page, total_pages: totalPages,
});
const upstream = () => vi.mocked(fetch);

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-18T00:00:00Z"));
  vi.stubEnv("TMDB_API_KEY", "test-only");
  io.cache.clear();
  io.read.mockReset().mockImplementation(async (key: string) => io.cache.get(key) ?? null);
  io.write.mockReset().mockImplementation(async (key: string, value: unknown) => { io.cache.set(key, value); });
  io.charge.mockReset();
  io.auth.mockReset().mockResolvedValue(null);
  io.optionalUser.mockReset().mockResolvedValue(null);
  io.rateResponse = null;
  for (const dependency of [io.db, io.redisRead, io.redisWrite]) {
    dependency.mockReset().mockImplementation(() => { throw new Error("Unexpected external storage access"); });
  }
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(upstreamPayload())));
});

afterEach(() => {
  expect(io.db).not.toHaveBeenCalled();
  expect(io.redisRead).not.toHaveBeenCalled();
  expect(io.redisWrite).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("search pagination and cache", () => {
  it("defaults to page one for anonymous search and keeps the 30 minute TTL", async () => {
    const { GET } = await import("./route");
    const response = await GET(request("query=%20Test%20"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({ page: 1, total_pages: 2, results: [{ id: 1, title: "繁體片名" }] });
    const url = new URL(String(upstream().mock.calls[0][0]));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ query: "Test", page: "1", language: "zh-TW", include_adult: "false" });
    expect(io.write).toHaveBeenCalledExactlyOnceWith("tmdb:search:v2:test:1", payload, 30 * 60 * 1000);
    expect(io.auth).not.toHaveBeenCalled();
    expect(io.charge).toHaveBeenCalledTimes(1);
  });

  it("isolates pages and queries, ignores legacy caches, and serves hits before auth or charging", async () => {
    const { GET } = await import("./route");
    io.cache.set("tmdb:search:test", { results: [{ id: 999 }] });
    upstream().mockImplementation(async (input) => {
      const url = new URL(String(input));
      return Response.json(upstreamPayload(Number(url.searchParams.get("page"))));
    });
    await GET(request());
    await GET(request("query=test&page=2"));
    await GET(request("query=other&page=1"));
    io.optionalUser.mockClear();
    io.charge.mockClear();
    const response = await GET(request("query=TEST&page=2"));
    expect(await response.json()).toMatchObject({ page: 2, results: [{ id: 1 }] });
    expect(io.read.mock.calls.map(([key]) => key)).toEqual([
      "tmdb:search:v2:test:1", "tmdb:search:v2:test:2", "tmdb:search:v2:other:1", "tmdb:search:v2:test:2",
    ]);
    expect(upstream()).toHaveBeenCalledTimes(3);
    expect(io.charge).not.toHaveBeenCalled();
    expect(io.optionalUser).not.toHaveBeenCalled();
  });

  it("keeps authoritative pagination when a page contains only people and clamps the accessible limit", async () => {
    const { GET } = await import("./route");
    upstream().mockResolvedValueOnce(Response.json(upstreamPayload(500, [{ id: 5, media_type: "person", name: "Person" }], 900)));
    expect(await (await GET(request("query=test&page=500"))).json()).toEqual({ results: [], page: 500, total_pages: 500 });
    expect(upstream()).toHaveBeenCalledTimes(1);
  });

  it("preserves zero total pages for a successful empty upstream result", async () => {
    const { GET } = await import("./route");
    upstream().mockResolvedValueOnce(Response.json(upstreamPayload(1, [], 0)));
    expect(await (await GET(request())).json()).toEqual({ results: [], page: 1, total_pages: 0 });
    expect(io.write).toHaveBeenCalledTimes(1);
  });

  it.each(["", "0", "-1", "501", "1.5", "1e2", "NaN", "Infinity", " 2", "2 ", "9999999999999999999"])("rejects an invalid page before external work: %j", async (page) => {
    const { GET } = await import("./route");
    expect((await GET(request(`query=test&page=${encodeURIComponent(page)}`))).status).toBe(400);
    expect(io.read).not.toHaveBeenCalled();
    expect(io.charge).not.toHaveBeenCalled();
    expect(upstream()).not.toHaveBeenCalled();
  });

  it("rejects an empty query", async () => {
    const { GET } = await import("./route");
    expect((await GET(request("query=%20%20&page=2"))).status).toBe(400);
    expect(upstream()).not.toHaveBeenCalled();
  });

  it("shares the upstream fetch and pending cache write for concurrent requests to the same page", async () => {
    const { GET } = await import("./route");
    let finishWrite!: () => void;
    io.write.mockImplementation(() => new Promise<void>((resolve) => { finishWrite = resolve; }));
    const first = GET(request());
    await vi.waitFor(() => expect(io.write).toHaveBeenCalledTimes(1));
    const second = GET(request());
    await vi.waitFor(() => expect(io.read).toHaveBeenCalledTimes(2));
    finishWrite();
    const responses = await Promise.all([first, second]);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(upstream()).toHaveBeenCalledTimes(1);
    expect(io.write).toHaveBeenCalledTimes(1);
    expect(io.charge).toHaveBeenCalledTimes(1);
  });
});

describe("search localization and optional metadata", () => {
  it.each([null, "", "Original-language overview"])("uses the original title without another request when non-text metadata is complete: %j", async (overview) => {
    const { GET } = await import("./route");
    upstream().mockResolvedValueOnce(Response.json(upstreamPayload(1, [movie({ title: "English title", original_title: "Titre original", overview })])));
    const payload = await (await GET(request())).json();
    expect(payload.results[0]).toMatchObject({ title: "Titre original", overview: overview || null });
    expect(upstream()).toHaveBeenCalledTimes(1);
  });

  it("does not fetch English metadata just because the title is absent", async () => {
    const { GET } = await import("./route");
    upstream().mockResolvedValueOnce(Response.json(upstreamPayload(1, [movie({ title: "", original_title: "", overview: null })])));
    expect((await GET(request())).status).toBe(200);
    expect(upstream()).toHaveBeenCalledTimes(1);
  });

  it("uses the same page for metadata fallback, preserves primary order/text, and excludes English-only hits", async () => {
    const { GET } = await import("./route");
    upstream()
      .mockResolvedValueOnce(Response.json(upstreamPayload(3, [
        movie({ id: 2, poster_path: null, release_date: "", overview: null }),
        movie({ id: 1, title: "English alias", original_title: "原作名", poster_path: "" }),
        movie({ id: 3, title: "Another alias", original_title: "Autre titre", poster_path: null }),
      ], 8)))
      .mockResolvedValueOnce(Response.json(upstreamPayload(3, [
        movie({ id: 1, title: "English 1", original_title: "Wrong original", poster_path: "/one.jpg" }),
        movie({ id: 9, title: "English-only result" }),
        movie({ id: 2, title: "English 2", overview: "English overview", poster_path: "/two.jpg", release_date: "2021-06-01" }),
      ], 20)));
    const payload = await (await GET(request("query=test&page=3"))).json();
    expect(payload).toMatchObject({ page: 3, total_pages: 8 });
    expect(payload.results.map((item: { id: number }) => item.id)).toEqual([2, 1, 3]);
    expect(payload.results[0]).toMatchObject({ title: "繁體片名", overview: null, year: "2021", release_date: "2021-06-01", poster_path: "/two.jpg" });
    expect(payload.results[1]).toMatchObject({ title: "原作名", original_title: "原作名", poster_path: "/one.jpg" });
    expect(payload.results[2]).toMatchObject({ title: "Autre titre", poster_path: null });
    expect(upstream().mock.calls.map(([input]) => {
      const url = new URL(String(input));
      return [url.searchParams.get("language"), url.searchParams.get("page")];
    })).toEqual([["zh-TW", "3"], ["en-US", "3"]]);
  });

  it.each(["network", "http", "invalid-json", "invalid-shape"])("keeps original titles and valid primary results when optional fallback fails: %s", async (failure) => {
    const { GET } = await import("./route");
    upstream().mockResolvedValueOnce(Response.json(upstreamPayload(1, [movie({ title: "English alias", original_title: "Titre original", poster_path: null })])));
    if (failure === "network") upstream().mockRejectedValueOnce(new Error("offline"));
    if (failure === "http") upstream().mockResolvedValueOnce(new Response(null, { status: 503 }));
    if (failure === "invalid-json") upstream().mockResolvedValueOnce(new Response("broken json"));
    if (failure === "invalid-shape") upstream().mockResolvedValueOnce(Response.json({ results: {} }));
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ page: 1, total_pages: 2, results: [{ title: "Titre original", poster_path: null }] });
    expect(io.write).toHaveBeenCalledTimes(1);
  });
});

describe("search errors and authentication", () => {
  it.each([
    {}, null, { results: {}, page: 1, total_pages: 1 },
    { results: [], total_pages: 1 }, { results: [], page: 2, total_pages: 2 },
    { results: [], page: 1, total_pages: -1 }, { results: [], page: 1, total_pages: 1.5 },
    { results: [], page: 1, total_pages: "2" }, { results: [null], page: 1, total_pages: 1 },
    { results: [movie({ id: "1" })], page: 1, total_pages: 1 },
    { results: [movie({ title: 123 })], page: 1, total_pages: 1 },
    { results: [movie()], page: 1, total_pages: 0 },
  ])("rejects malformed primary data without caching an empty success: %j", async (payload) => {
    const { GET } = await import("./route");
    upstream().mockResolvedValueOnce(Response.json(payload));
    expect((await GET(request())).status).toBe(502);
    expect(io.write).not.toHaveBeenCalled();
  });

  it("rejects invalid primary JSON without caching", async () => {
    const { GET } = await import("./route");
    upstream().mockResolvedValueOnce(new Response("broken json"));
    expect((await GET(request())).status).toBe(502);
    expect(io.write).not.toHaveBeenCalled();
  });

  it("requires authentication for refresh and lets signed-in refresh bypass the cached page", async () => {
    const { GET } = await import("./route");
    io.cache.set("tmdb:search:v2:test:1", { results: [], page: 1, total_pages: 0 });
    expect((await GET(request("query=test&refresh=1"))).status).toBe(401);
    expect(io.read).not.toHaveBeenCalled();
    expect(upstream()).not.toHaveBeenCalled();
    io.auth.mockResolvedValueOnce({ user: { id: "user" } });
    expect(await (await GET(request("query=test&refresh=1"))).json()).toMatchObject({ results: [{ id: 1 }], page: 1 });
    expect(upstream()).toHaveBeenCalledTimes(1);
  });

  it("honors proxy rate limiting before an upstream miss", async () => {
    const { GET } = await import("./route");
    io.rateResponse = Response.json({ error: "limited" }, { status: 429, headers: { "Retry-After": "9" } });
    io.charge.mockRejectedValueOnce(new Error("RATE_LIMITED"));
    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("9");
    expect(upstream()).not.toHaveBeenCalled();
    expect(io.write).not.toHaveBeenCalled();
  });

  it("honors upstream cooldown across pages while cache hits remain available", async () => {
    const { GET } = await import("./route");
    await GET(request());
    upstream().mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "120" } }));
    const limited = await GET(request("query=test&page=2"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("120");
    expect((await GET(request("query=test&page=3"))).status).toBe(429);
    expect((await GET(request())).status).toBe(200);
    expect(upstream()).toHaveBeenCalledTimes(2);
    expect(io.write).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 120_000);
    upstream().mockResolvedValueOnce(Response.json(upstreamPayload(2)));
    expect((await GET(request("query=test&page=2"))).status).toBe(200);
    expect(upstream()).toHaveBeenCalledTimes(3);
  });

  it("keeps valid primary data after a fallback 429 and blocks subsequent uncached upstream calls", async () => {
    const { GET } = await import("./route");
    upstream()
      .mockResolvedValueOnce(Response.json(upstreamPayload(1, [movie({ poster_path: null })])))
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "60" } }));
    expect((await GET(request())).status).toBe(200);
    const response = await GET(request("query=test&page=2"));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(upstream()).toHaveBeenCalledTimes(2);
  });
});
