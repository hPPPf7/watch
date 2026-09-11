// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const DAY = 86400000;
const oldEpisodes = [1,2].map(episode_number => ({episode_number,air_date:"2020-01-01",name:"集名"}));
beforeEach(() => { localStorage.clear(); vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-12T01:00:00Z")); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("fills only missing seasons, reuses the normal loader, and retains old dates after full cache expiry", async () => {
 const fetcher=vi.fn<typeof fetch>(async()=>Response.json({episodes:oldEpisodes})); vi.stubGlobal("fetch",fetcher);
 const {fetchSeasonEpisodesCached,ensureEpisodeDatesCached}=await import("./seasonEpisodes");
 const summaries=[{season_number:0,episode_count:3},{season_number:1,episode_count:2},{season_number:2,episode_count:2}];
 await fetchSeasonEpisodesCached(1,2,"Returning Series"); // 原本下一集掃描已查過當季。
 await ensureEpisodeDatesCached(1,summaries,"Returning Series");
 expect(fetcher).toHaveBeenCalledTimes(2);
 expect(fetcher.mock.calls.map(args=>String(args[0]))).toEqual([
   "/api/tmdb/season?type=tv&id=1&season=2","/api/tmdb/season?type=tv&id=1&season=1"]);
 vi.advanceTimersByTime(8*DAY);
 await ensureEpisodeDatesCached(1,summaries,"Returning Series");
 expect(fetcher).toHaveBeenCalledTimes(2);
 vi.advanceTimersByTime(23*DAY);
 await ensureEpisodeDatesCached(1,summaries,"Returning Series");
 expect(fetcher).toHaveBeenCalledTimes(4);
});
it("coalesces overlapping missing-season loads from the list and modal", async () => {
 const fetcher=vi.fn<typeof fetch>(async()=>Response.json({episodes:oldEpisodes})); vi.stubGlobal("fetch",fetcher);
 const {ensureEpisodeDatesCached}=await import("./seasonEpisodes");
 const seasons=[{season_number:1,episode_count:2}];
 await Promise.all([ensureEpisodeDatesCached(2,seasons),ensureEpisodeDatesCached(2,seasons)]);
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it("stops fetching further seasons after closing or becoming inactive", async () => {
 let active=true;
 const fetcher=vi.fn<typeof fetch>(async()=>{active=false;return Response.json({episodes:oldEpisodes});}); vi.stubGlobal("fetch",fetcher);
 const {ensureEpisodeDatesCached}=await import("./seasonEpisodes");
 await ensureEpisodeDatesCached(3,[{season_number:1,episode_count:2},{season_number:2,episode_count:2}],null,()=>active);
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it("respects 429 cooldown instead of retrying every missing season", async () => {
 const fetcher=vi.fn<typeof fetch>(async()=>new Response(null,{status:429,headers:{"Retry-After":"120"}})); vi.stubGlobal("fetch",fetcher);
 const {ensureEpisodeDatesCached}=await import("./seasonEpisodes");
 const seasons=[{season_number:1,episode_count:2},{season_number:2,episode_count:2}];
 await ensureEpisodeDatesCached(4,seasons);
 await ensureEpisodeDatesCached(5,seasons);
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it("remembers a loaded episode without inventing its unknown broadcast date", async () => {
 vi.stubGlobal("fetch",vi.fn<typeof fetch>(async()=>Response.json({episodes:[{episode_number:1,air_date:null}]})));
 const {ensureEpisodeDatesCached}=await import("./seasonEpisodes");
 const {readEpisodeDates}=await import("./episodeDateCache");
 await ensureEpisodeDatesCached(6,[{season_number:1,episode_count:1}]);
 expect(readEpisodeDates(6,1)).toEqual([{episode_number:1,air_date:null}]);
});

it("does not refetch an undated future season on reload, but rechecks after expiry and uses the new date", async () => {
 const fetcher=vi.fn<typeof fetch>()
  .mockResolvedValueOnce(Response.json({episodes:[{episode_number:1,air_date:null}]}))
  .mockResolvedValueOnce(Response.json({episodes:[{episode_number:1,air_date:"2026-09-12"}]}));
 vi.stubGlobal("fetch",fetcher);
 let {ensureEpisodeDatesCached}=await import("./seasonEpisodes");
 const summaries=[{season_number:1,episode_count:1}];
 await ensureEpisodeDatesCached(7,summaries);
 vi.advanceTimersByTime(5*3600000);
 vi.resetModules(); ({ensureEpisodeDatesCached}=await import("./seasonEpisodes"));
 await ensureEpisodeDatesCached(7,summaries);
 expect(fetcher).toHaveBeenCalledTimes(1);
 vi.advanceTimersByTime(3600000+1);
 await ensureEpisodeDatesCached(7,summaries);
 expect(fetcher).toHaveBeenCalledTimes(2);
 const {getSharedSeasonAiredTotal}=await import("./episodeTotals");
 expect(getSharedSeasonAiredTotal(7,summaries[0],"2026-09-12")).toBe(1);
});
