import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const redis = vi.hoisted(() => ({ enabled: false, get: vi.fn(), eval: vi.fn() }));
vi.mock("@/server/realtime/redis", () => ({ isRedisRealtimeEnabled: () => redis.enabled, getRedisPublisher: () => redis }));
beforeEach(() => { vi.resetModules(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-09T00:00:00Z")); redis.enabled = false; redis.get.mockReset(); redis.eval.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function rejectResponse(status: number, header?: string) {
 const api = await import("./recommendationFetch");
 const fetcher = vi.fn().mockResolvedValue(new Response("", { status, headers: header === undefined ? {} : { "Retry-After": header } }));
 vi.stubGlobal("fetch", fetcher);
 const error = await api.fetchRecommendationJson("https://example.test").catch(e => e);
 return { api, fetcher, response: api.recommendationErrorResponse(error) };
}
describe("recommendation cooldown", () => {
 it.each([["120", "120"], ["Wed, 09 Sep 2026 00:02:00 GMT", "120"], [undefined, "60"], ["invalid", "60"], ["Tue, 08 Sep 2026 00:00:00 GMT", "60"], ["0", "1"]])("honors or validates Retry-After %s", async (header, expected) => {
  const { api, fetcher, response } = await rejectResponse(429, header);
  expect(response.status).toBe(429); expect(response.headers.get("Retry-After")).toBe(expected);
  await expect(api.fetchRecommendationJson("https://example.test/page2")).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it("backs off network errors and allows recovery", async () => {
  const api = await import("./recommendationFetch"); const fetcher = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(new Response('{"ok":true}'));
  vi.stubGlobal("fetch", fetcher);
  const error = await api.fetchRecommendationJson("https://example.test").catch(e => e);
  expect(api.recommendationErrorResponse(error).headers.get("Retry-After")).toBe("15");
  vi.setSystemTime(Date.now() + 15001); await expect(api.fetchRecommendationJson("https://example.test")).resolves.toEqual({ok:true});
 });
 it("reads a shared cooldown before starting upstream work", async () => {
  redis.enabled = true; redis.get.mockResolvedValue(JSON.stringify({until:Date.now()+90000,status:429}));
  const api = await import("./recommendationFetch");
  const error = await api.assertRecommendationsAvailable().catch(e=>e);
  expect(api.recommendationErrorResponse(error).headers.get("Retry-After")).toBe("90");
  await expect(api.assertRecommendationsAvailable()).rejects.toThrow(); expect(redis.get).toHaveBeenCalledTimes(1);
 });
 it("coalesces concurrent reads but rechecks before later upstream work", async () => {
  redis.enabled=true; redis.get.mockResolvedValue(null); const api=await import("./recommendationFetch");
  await Promise.all(Array.from({length:20},()=>api.assertRecommendationsAvailable()));
  expect(redis.get).toHaveBeenCalledTimes(1);
  redis.get.mockResolvedValue(JSON.stringify({until:Date.now()+60000,status:429}));
  const fetcher=vi.fn(); vi.stubGlobal("fetch",fetcher);
  await expect(api.fetchRecommendationJson("https://example.test/page2")).rejects.toThrow();
  expect(redis.get).toHaveBeenCalledTimes(2); expect(fetcher).not.toHaveBeenCalled();
 });
 it("stops new requests and subsequent pages after another instance publishes cooldown", async () => {
  redis.enabled=true;
  let stored: string | null=null;
  redis.get.mockImplementation(async()=>stored);
  redis.eval.mockImplementation(async(_script, _count, _key, value:string)=>{stored=value;return value;});
  const first=await import("./recommendationFetch");
  vi.resetModules();
  const second=await import("./recommendationFetch");
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('{"results":[]}')).mockResolvedValueOnce(new Response('',{status:429,headers:{"Retry-After":"120"}}));
  vi.stubGlobal("fetch",fetcher);
  await second.fetchRecommendationJson("https://example.test/page1");
  await expect(first.fetchRecommendationJson("https://example.test/other")).rejects.toThrow();
  await expect(second.assertRecommendationsAvailable()).rejects.toThrow();
  await expect(second.fetchRecommendationJson("https://example.test/page2")).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it("preserves a longer cooldown from another instance", async () => {
  redis.enabled=true; redis.eval.mockResolvedValue(JSON.stringify({until:Date.now()+180000,status:429}));
  const {response}=await rejectResponse(503); expect(response.status).toBe(429); expect(response.headers.get("Retry-After")).toBe("180");
  expect(redis.eval).toHaveBeenCalledTimes(1);
 });
 it("keeps local protection when Redis is unavailable", async () => {
  redis.enabled=true; redis.get.mockRejectedValue(new Error("offline")); redis.eval.mockRejectedValue(new Error("offline"));
  const api=await import("./recommendationFetch"); await expect(api.assertRecommendationsAvailable()).resolves.toBeUndefined();
  const {response}=await rejectResponse(429); expect(response.status).toBe(429);
  await expect(api.assertRecommendationsAvailable()).rejects.toThrow();
 });
});
