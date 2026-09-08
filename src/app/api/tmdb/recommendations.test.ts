import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const { read, write } = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("@/server/tmdb/cache", async importOriginal => ({ ...await importOriginal<typeof import("@/server/tmdb/cache")>(), readTmdbCache: read, writeTmdbCache: write }));
vi.mock("@/server/realtime/redis", () => ({ isRedisRealtimeEnabled: () => false }));
vi.mock("@/server/tmdb/auth", () => ({ getOptionalTmdbUserId: async () => null }));
vi.mock("@/server/tmdb/rateLimit", () => ({ enforceTmdbProxyRateLimit: () => ({ beforeStart: () => {}, apply: (r: Response) => r }) }));
import { GET as movie } from "./movies/recommendations/route";
import { GET as tv } from "./tv/recommendations/route";
import { GET as anime } from "./anime/recommendations/route";
let clock = Date.UTC(2026, 0, 1);
describe.each([["movie", movie], ["tv", tv], ["anime", anime]] as const)("%s 推薦失敗不可快取", (_, get) => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(clock += 86_400_000); vi.stubEnv("TMDB_API_KEY", "test-only"); read.mockResolvedValue(null); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
  it("502 不寫快取，短暫冷卻後可恢復取得", async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const request = new Request("https://watch.invalid/api/tmdb/recommendations");
    expect((await get(request)).status).toBe(502);
    expect(write).not.toHaveBeenCalled();
    const count = fetch.mock.calls.length;
    const cooling = await get(request);
    expect(cooling.headers.get("retry-after")).toBe("15");
    expect(fetch).toHaveBeenCalledTimes(count);
    vi.setSystemTime(Date.now() + 15_001);
    fetch.mockImplementation(async () => Response.json({ results: [], total_pages: 1 }));
    expect((await get(request)).status).toBe(200);
    expect(write).toHaveBeenCalledOnce();
  });
  it("後續分頁失敗也不能快取前半部資料", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => new URL(input).searchParams.get("page") === "2" ? new Response(null, { status: 429 }) : Response.json({ results: [{ id: 1 }], total_pages: 2 })));
    expect((await get(new Request("https://watch.invalid/api/tmdb/recommendations"))).status).toBe(429);
    expect(write).not.toHaveBeenCalled();
  });
});

it("電影遭 429 後，影集與動畫的新請求都等候，但既有快取可繼續使用", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(clock += 86_400_000);
  vi.stubEnv("TMDB_API_KEY", "test-only"); read.mockResolvedValue(null);
  const upstream = vi.fn(async () => new Response(null, { status: 429, headers: { "Retry-After": "120" } }));
  vi.stubGlobal("fetch", upstream);
  try {
    const request = new Request("https://watch.invalid/api/tmdb/recommendations");
    const response = await movie(request);
    expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("120");
    const calls = upstream.mock.calls.length;
    expect((await tv(request)).status).toBe(429); expect((await anime(request)).status).toBe(429);
    expect(upstream).toHaveBeenCalledTimes(calls); expect(write).not.toHaveBeenCalled();
    read.mockResolvedValue({ updated_at: "old", lists: [{ key: "popular", data: [{ id: 1 }] }] });
    expect((await tv(request)).status).toBe(200); expect(upstream).toHaveBeenCalledTimes(calls);
  } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); }
});
