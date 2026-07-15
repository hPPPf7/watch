import { describe, expect, it } from "vitest";
import {
  getUpcomingCandidateSeasonNumbers,
  isKnownTvSeason,
} from "@/lib/upcomingEpisodeSeasons";

describe("isKnownTvSeason", () => {
  it("已有集數的正規季視為已知", () => {
    expect(isKnownTvSeason({ season_number: 1, episode_count: 12 })).toBe(
      true,
    );
  });

  it("episode_count 是 null 或 0 的空殼季，或 season_number 不是正數，視為未知", () => {
    expect(isKnownTvSeason({ season_number: 1, episode_count: null })).toBe(
      false,
    );
    expect(isKnownTvSeason({ season_number: 1, episode_count: 0 })).toBe(
      false,
    );
    expect(isKnownTvSeason({ season_number: 0, episode_count: 4 })).toBe(
      false,
    );
  });
});

describe("getUpcomingCandidateSeasonNumbers", () => {
  it("保留所有已有集數的正規季度，避免下一季已建立時漏掉目前季度", () => {
    expect(
      getUpcomingCandidateSeasonNumbers([
        { season_number: 0, episode_count: 4 },
        { season_number: 1, episode_count: 12 },
        { season_number: 2, episode_count: 2 },
        { season_number: 3, episode_count: 0 },
      ]),
    ).toEqual([1, 2]);
  });

  it("忽略沒有集數資料的空殼季", () => {
    expect(
      getUpcomingCandidateSeasonNumbers([
        { season_number: 1, episode_count: null },
        { season_number: 2, episode_count: 0 },
      ]),
    ).toEqual([]);
  });

  it("最多只回傳最新的兩個已知季，避免長壽劇退化回查全部季", () => {
    const manySeasons = Array.from({ length: 15 }, (_, index) => ({
      season_number: index + 1,
      episode_count: 10,
    }));

    expect(getUpcomingCandidateSeasonNumbers(manySeasons)).toEqual([14, 15]);
  });
});
