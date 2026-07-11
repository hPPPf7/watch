import { describe, expect, it } from "vitest";
import { TMDB_CACHE_TTL } from "@/server/tmdb/cache";
import {
  resolveDetailCacheTtlMs,
  resolveSeasonCacheTtlMs,
} from "@/server/tmdb/cacheTtl";
import type { DetailResponse } from "@/server/tmdb/detail";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const taipeiMidnightMs = (dateOnly: string) =>
  Date.parse(`${dateOnly}T00:00:00+08:00`);

const buildDetail = (
  overrides: Partial<DetailResponse>,
): DetailResponse => ({
  id: 1,
  media_type: "movie",
  title: "測試作品",
  year: "2026",
  release_date: null,
  start_year: "2026",
  end_year: "2026",
  is_anime: false,
  runtime: null,
  countries: [],
  languages: [],
  overview: null,
  poster_path: null,
  homepage: null,
  ...overrides,
});

describe("resolveSeasonCacheTtlMs", () => {
  const now = Date.parse("2026-07-10T04:00:00Z");

  it("有未播出集數時，快取活到下一集播出日的台北凌晨", () => {
    const ttl = resolveSeasonCacheTtlMs(
      [
        { air_date: "2026-07-08" },
        { air_date: "2026-07-15" },
        { air_date: "2026-07-22" },
      ],
      now,
    );

    expect(ttl).toBe(taipeiMidnightMs("2026-07-15") - now);
  });

  it("下一集還很遠時，TTL 以 7 天為上限", () => {
    const ttl = resolveSeasonCacheTtlMs(
      [{ air_date: "2026-07-08" }, { air_date: "2026-09-30" }],
      now,
    );

    expect(ttl).toBe(7 * DAY_MS);
  });

  it("下一集播出日凌晨很接近時，TTL 以 1 小時為下限", () => {
    const nearMidnight = taipeiMidnightMs("2026-07-11") - 30 * 60 * 1000;
    const ttl = resolveSeasonCacheTtlMs(
      [{ air_date: "2026-07-11" }],
      nearMidnight,
    );

    expect(ttl).toBe(HOUR_MS);
  });

  it("全部播出且最後一集在 30 天內，維持既有 24 小時", () => {
    const ttl = resolveSeasonCacheTtlMs(
      [{ air_date: "2026-06-24" }, { air_date: "2026-07-01" }],
      now,
    );

    expect(ttl).toBe(TMDB_CACHE_TTL.season);
  });

  it("全部播出且最後一集超過 30 天，放寬到 7 天", () => {
    const ttl = resolveSeasonCacheTtlMs(
      [{ air_date: "2025-11-05" }, { air_date: "2025-11-12" }],
      now,
    );

    expect(ttl).toBe(7 * DAY_MS);
  });

  it("空集數清單維持既有 24 小時", () => {
    expect(resolveSeasonCacheTtlMs([], now)).toBe(TMDB_CACHE_TTL.season);
  });

  it("任何一集缺播出日時視為資料不完整，維持 24 小時", () => {
    const ttl = resolveSeasonCacheTtlMs(
      [{ air_date: "2025-01-01" }, { air_date: null }],
      now,
    );

    expect(ttl).toBe(TMDB_CACHE_TTL.season);
  });
});

describe("resolveDetailCacheTtlMs", () => {
  const now = Date.parse("2026-07-10T04:00:00Z");

  it("TV 已完結 / 已取消放寬到 7 天", () => {
    for (const status of ["Ended", "Canceled"]) {
      const ttl = resolveDetailCacheTtlMs(
        buildDetail({ media_type: "tv", status }),
        now,
      );
      expect(ttl).toBe(7 * DAY_MS);
    }
  });

  it("TV 播出中維持既有 24 小時", () => {
    const ttl = resolveDetailCacheTtlMs(
      buildDetail({ media_type: "tv", status: "Returning Series" }),
      now,
    );

    expect(ttl).toBe(TMDB_CACHE_TTL.detail);
  });

  it("電影上映超過一年放寬到 7 天", () => {
    const ttl = resolveDetailCacheTtlMs(
      buildDetail({ media_type: "movie", release_date: "2024-03-01" }),
      now,
    );

    expect(ttl).toBe(7 * DAY_MS);
  });

  it("近期上映或缺上映日的電影維持 24 小時", () => {
    expect(
      resolveDetailCacheTtlMs(
        buildDetail({ media_type: "movie", release_date: "2026-06-20" }),
        now,
      ),
    ).toBe(TMDB_CACHE_TTL.detail);
    expect(
      resolveDetailCacheTtlMs(buildDetail({ media_type: "movie" }), now),
    ).toBe(TMDB_CACHE_TTL.detail);
  });
});
