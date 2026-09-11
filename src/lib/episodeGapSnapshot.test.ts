import { describe, expect, it } from "vitest";
import { buildNextEpisodeLabel, readEpisodeGapSnapshot, isEpisodeGapSnapshotFresh, type EpisodeGapSnapshot } from "./episodeGapSnapshot";

describe("episode gap snapshots", () => {
 const next = {next_episode_season:1,next_episode_number:8,next_episode_name:"下一步"};
 const snapshot: EpisodeGapSnapshot = {season:1,episode:7,watchedCount:6,hasMissingEpisodes:true};
 it("preserves a skipped sixth episode after synchronization and persisted-cache reload", () => {
  const restored = JSON.parse(JSON.stringify(snapshot));
  const gap = readEpisodeGapSnapshot(restored, {season:1,episode:7}, 6);
  expect(gap).toBe(true);
  expect(buildNextEpisodeLabel(next, gap === true)).toBe("下一集：S1E8 - 下一步（中間有漏集）");
 });
 it("preserves previously computed gaps across seasons without fetching season data", () => {
  const restored = {...snapshot,season:2,episode:3,watchedCount:13};
  expect(readEpisodeGapSnapshot(restored, {season:2,episode:3}, 13)).toBe(true);
 });
 it.each([
  [{season:1,episode:7},7], // 補看第六集
  [{season:1,episode:7},5], // 刪除觀看紀錄
  [{season:1,episode:8},6], // 換一筆紀錄，總數不變
  [{season:2,episode:7},6],
  [null,0],
 ] as const)("requires recomputation after history changes: %j, %i", (latest, count) => {
  expect(readEpisodeGapSnapshot(snapshot, latest, count)).toBeNull();
 });
 it("does not treat an old cache without gap evidence as gap-free", () => {
  expect(readEpisodeGapSnapshot(undefined, {season:1,episode:7}, 6)).toBeNull();
  expect(readEpisodeGapSnapshot({season:1,episode:7,watchedCount:6} as EpisodeGapSnapshot, {season:1,episode:7}, 6)).toBeNull();
 });
 it("clears the warning after a new gap-free scan", () => {
  const gap = readEpisodeGapSnapshot({...snapshot,watchedCount:7,hasMissingEpisodes:false}, {season:1,episode:7}, 7);
  expect(gap).toBe(false);
  expect(buildNextEpisodeLabel(next, gap === true)).toBe("下一集：S1E8 - 下一步");
 });
 it("does not manufacture a next episode when the snapshot has none", () => {
  expect(buildNextEpisodeLabel(null, true)).toBeNull();
  expect(buildNextEpisodeLabel({next_episode_season:1}, true)).toBeNull();
 });
});

it("expires snapshots even if ordinary state synchronization keeps updating", () => {
 const now=Date.parse("2026-09-11T06:00:00Z");
 const snapshot={season:1,episode:7,watchedCount:6,hasMissingEpisodes:true,checkedAt:now,checkedDate:"2026-09-11"};
 expect(isEpisodeGapSnapshotFresh(snapshot,now+3600000,"2026-09-11")).toBe(true);
 expect(isEpisodeGapSnapshotFresh(snapshot,now+6*3600000,"2026-09-11")).toBe(false);
 expect(isEpisodeGapSnapshotFresh(snapshot,now,"2026-09-12")).toBe(false);
 expect(isEpisodeGapSnapshotFresh({...snapshot,checkedAt:undefined},now,"2026-09-11")).toBe(false);
});
