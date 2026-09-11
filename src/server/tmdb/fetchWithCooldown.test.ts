import { afterEach, expect, it, vi } from "vitest";
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it("honors upstream Retry-After across detail and season requests", async()=>{
 vi.resetModules();vi.useFakeTimers();vi.setSystemTime(new Date("2026-09-11T00:00:00Z"));
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(null,{status:429,headers:{"Retry-After":"120"}})).mockResolvedValue(new Response("{}"));
 vi.stubGlobal("fetch",fetcher);
 const api=await import("./fetchWithCooldown");
 expect((await api.fetchTmdbWithCooldown("https://api.themoviedb.org/3/tv/1")).status).toBe(429);
 expect((await api.fetchTmdbWithCooldown("https://api.themoviedb.org/3/tv/1/season/1")).headers.get("Retry-After")).toBe("120");
 expect(fetcher).toHaveBeenCalledTimes(1);
 vi.advanceTimersByTime(120000);
 expect((await api.fetchTmdbWithCooldown("https://api.themoviedb.org/3/tv/1")).status).toBe(200);
 expect(fetcher).toHaveBeenCalledTimes(2);
});
