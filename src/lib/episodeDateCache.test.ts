// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const now = new Date("2026-09-12T01:00:00Z");
const DAY = 86400000;
const oldEpisodes = [1,2].map(episode_number => ({episode_number, air_date:"2020-01-01", name:"不保存集名"}));
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(now); localStorage.clear();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("public episode date snapshots", () => {
  it("retains old seasons across restarts without extending their expiry or storing history", async () => {
    let cache = await import("./episodeDateCache");
    cache.rememberEpisodeMetadata("tv:1:season:1", oldEpisodes, 6*3600000);
    const raw = localStorage.getItem("watch:public-episode-dates:v1")!;
    expect(raw).not.toContain("不保存集名");
    expect(raw).not.toContain("watched");
    vi.setSystemTime(+now + 29*DAY);
    vi.resetModules(); cache = await import("./episodeDateCache");
    expect(cache.readEpisodeDates(1,1,2)).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem("watch:public-episode-dates:v1")!)).toEqual(JSON.parse(raw));
    vi.setSystemTime(+now + 30*DAY + 1);
    expect(cache.readEpisodeDates(1,1,2)).toBeNull();
    expect(localStorage.getItem("watch:public-episode-dates:v1")).not.toContain("tv:1:season:1");
  });
  it("requires complete contiguous episode numbers and real dates", async () => {
    const c = await import("./episodeDateCache");
    for (const episodes of [[...oldEpisodes, oldEpisodes[0]], [{episode_number:1,air_date:"2026-02-30"}], [{episode_number:2,air_date:"2020-01-01"}], [{episode_number:1,air_date:null}]]) {
      c.rememberEpisodeMetadata("tv:2:season:1", episodes, 6*3600000);
      expect(c.readEpisodeDates(2,1)).toBeNull();
    }
  });
  it("invalidates changed episode counts immediately, and replaces dates from a newer response", async () => {
    const c = await import("./episodeDateCache");
    c.rememberEpisodeMetadata("tv:3:season:1", oldEpisodes, 6*3600000);
    expect(c.readEpisodeDates(3,1,3)).toBeNull();
    c.rememberEpisodeMetadata("tv:3:season:1", [{episode_number:1,air_date:"2026-10-01"}], 6*3600000);
    expect(c.readEpisodeDates(3,1,1)?.[0].air_date).toBe("2026-10-01");
    c.rememberEpisodeMetadata("tv:3:season:1", [{episode_number:1,air_date:null}], 6*3600000);
    expect(c.readEpisodeDates(3,1)).toBeNull();
  });
  it("does not extend an ongoing schedule merely because it becomes aired", async () => {
    const c = await import("./episodeDateCache");
    c.rememberEpisodeMetadata("tv:4:season:1", [{episode_number:1,air_date:"2026-09-13"}], 7*DAY);
    vi.setSystemTime(+now+6*3600000+1);
    expect(c.readEpisodeDates(4,1)).toBeNull();
  });
  it("bounds layouts to six hours independently of long-lived seasons", async () => {
    const c = await import("./episodeDateCache");
    c.rememberEpisodeMetadata("tv:5", {seasons_info:[{season_number:1,episode_count:2}]}, 30*DAY);
    vi.setSystemTime(+now+6*3600000+1);
    expect(c.readEpisodeSeasons(5)).toBeNull();
  });
  it("rejects corrupt, expired, or excessively long-lived persisted data", async () => {
    localStorage.setItem("watch:public-episode-dates:v1",JSON.stringify([
      ["tv:6:season:1",{dates:["2020-01-01"],expiresAt:+now+181*DAY}],
      ["tv:7:season:1",{dates:["2020-01-01"],expiresAt:+now-1}],
      ["tv:8:season:1",{dates:["bad"],expiresAt:+now+DAY}],
      ["tv:9",{seasons:[null],expiresAt:+now+1000}],
    ]));
    const c = await import("./episodeDateCache");
    expect(c.readEpisodeDates(6,1)).toBeNull();
    expect(c.readEpisodeDates(7,1)).toBeNull();
    expect(c.readEpisodeDates(8,1)).toBeNull();
    expect(c.readEpisodeSeasons(9)).toBeNull();
  });
  it("still works when local storage is disabled", async () => {
    const c = await import("./episodeDateCache");
    vi.spyOn(Storage.prototype,"getItem").mockImplementation(()=>{throw new Error("disabled");});
    vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("full");});
    c.rememberEpisodeMetadata("tv:10:season:1",oldEpisodes,6*3600000);
    expect(c.readEpisodeDates(10,1,2)).toHaveLength(2);
    vi.restoreAllMocks();
  });
  it("keeps compact aired progress after unrelated full detail cache entries are evicted", async () => {
    const c = await import("./tmdbDetailCache");
    const {getSharedEpisodeProgress} = await import("./episodeTotals");
    c.setDetailCache("tv:11",{seasons_info:[{season_number:1,episode_count:2}]});
    c.setDetailCache("tv:11:season:1",oldEpisodes);
    for(let i=0;i<310;i++) c.setDetailCache(`other:${i}`,{value:i});
    expect(c.getDetailCache("tv:11")).toBeNull();
    expect(getSharedEpisodeProgress(11,1,2,"2026-09-12").total).toBe(2);
  });
});

it("does not let an ended show's full season cache hide newer schedule data for seven days",async()=>{
 const c=await import("./tmdbDetailCache");
 c.setDetailCache("tv:20:season:1",[{episode_number:1,air_date:"2026-12-01"}],7*DAY);
 vi.setSystemTime(+now+6*3600000+1);
 expect(c.getDetailCache("tv:20:season:1")).toBeNull();
});
