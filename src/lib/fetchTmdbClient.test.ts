import { afterEach, expect, it, vi } from "vitest";
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it.each(["120","Fri, 11 Sep 2026 00:02:00 GMT"])("suppresses immediate retries and honors %s",async retry=>{
 vi.resetModules();vi.useFakeTimers();vi.setSystemTime(new Date("2026-09-11T00:00:00Z"));
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(null,{status:429,headers:{"Retry-After":retry}})).mockResolvedValue(new Response("{}"));vi.stubGlobal("fetch",fetcher);
 const {fetchTmdbClient}=await import("./fetchTmdbClient");
 await fetchTmdbClient("/api/tmdb/season?type=tv&id=1&season=1");
 await fetchTmdbClient("/api/tmdb/detail?type=tv&id=2");expect(fetcher).toHaveBeenCalledTimes(1);
 vi.advanceTimersByTime(120000);await fetchTmdbClient("/api/tmdb/detail?type=tv&id=2");expect(fetcher).toHaveBeenCalledTimes(2);
});
