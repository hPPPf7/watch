import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateEpisodeProgress, getSharedEpisodeProgress, taipeiDate, type DatedEpisode } from "./episodeTotals";
import { setDetailCache, getDetailCacheVersion, subscribeDetailCache } from "./tmdbDetailCache";
afterEach(() => vi.useRealTimers());
const season = (count:number, aired:number): DatedEpisode[] => Array.from({length:count},(_,i)=>({episode_number:i+1,air_date:i<aired?"2026-09-10":"2026-09-12"}));
describe("shared episode totals", () => {
 it("combines seasons obtained from different views, excluding specials", () => {
  const summaries=[{season_number:0,episode_count:3},{season_number:1,episode_count:12},{season_number:2,episode_count:12}];
  const result=calculateEpisodeProgress(14,24,summaries,n=>n===1?season(12,12):season(12,8),"2026-09-11");
  expect(result).toEqual({watched:14,total:20,totalKind:"aired"});
 });
 it("does not infer missing older seasons or unknown dates", () => {
  expect(calculateEpisodeProgress(6,24,[{season_number:1,episode_count:12},{season_number:2,episode_count:12}],n=>n===1?season(12,8):null,"2026-09-11").total).toBeNull();
  const episodes=season(12,8);episodes[0].air_date=null;
  expect(calculateEpisodeProgress(6,12,[{season_number:1,episode_count:12}],()=>episodes,"2026-09-11").total).toBeNull();
 });
 it.each(["duplicates","missing","bad-date","version-mismatch"])("rejects incomplete or inconsistent data: %s", kind => {
  const episodes=season(12,8);
  if(kind==="duplicates") episodes[1]=episodes[0];
  if(kind==="missing") episodes.pop();
  if(kind==="bad-date") episodes[0].air_date="2026-02-30";
  expect(calculateEpisodeProgress(6,kind==="version-mismatch"?13:12,[{season_number:1,episode_count:12}],()=>episodes,"2026-09-11").total).toBeNull();
 });
 it("never clamps or discards viewing records beyond the aired total", () => {
  expect(calculateEpisodeProgress(10,12,[{season_number:1,episode_count:12}],()=>season(12,8),"2026-09-11")).toEqual({watched:10,total:null,totalKind:"aired"});
 });
 it("recalculates on the Taipei broadcast date without fetching", () => {
  const episodes=season(12,8), read=vi.fn(()=>episodes);
  expect(taipeiDate(Date.parse("2026-09-11T16:00:00Z"))).toBe("2026-09-12");
  expect(calculateEpisodeProgress(6,12,[{season_number:1,episode_count:12}],read,"2026-09-11").total).toBe(8);
  expect(calculateEpisodeProgress(6,12,[{season_number:1,episode_count:12}],read,"2026-09-12").total).toBe(12);
 });
 it("notifies all views when another view supplies a season and expires without a request", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-11T00:00:00Z"));
  const fetcher=vi.fn(); vi.stubGlobal("fetch",fetcher);
  const listener=vi.fn(), unsubscribe=subscribeDetailCache(listener), before=getDetailCacheVersion();
  setDetailCache("tv:87654321",{seasons_info:[{season_number:1,episode_count:12}]},1000);
  expect(getSharedEpisodeProgress(87654321,6,12,"2026-09-11").total).toBeNull();
  setDetailCache("tv:87654321:season:1",season(12,8),1000);
  expect(getSharedEpisodeProgress(87654321,6,12,"2026-09-11").total).toBe(8);
  expect(listener).toHaveBeenCalledTimes(2);expect(getDetailCacheVersion()).toBeGreaterThan(before);
  vi.advanceTimersByTime(1001);
  expect(getSharedEpisodeProgress(87654321,6,12,"2026-09-11").total).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();unsubscribe();vi.unstubAllGlobals();
 });
});

it("shows one remaining aired episode instead of counting the future schedule", () => {
  expect(calculateEpisodeProgress(5,12,[{season_number:1,episode_count:12}],()=>season(12,6),"2026-09-11"))
    .toEqual({watched:5,total:6,totalKind:"aired"});
});
it("keeps zero aired episodes distinct from unavailable data", () => {
  expect(calculateEpisodeProgress(0,12,[{season_number:1,episode_count:12}],()=>season(12,0),"2026-09-11").total).toBe(0);
});
