import { describe, expect, it } from "vitest";
import {
  DEFAULT_DETAIL_TTL_MS,
  resolveSeasonEpisodesClientTtlMs,
  SHORT_DETAIL_TTL_MS,
} from "@/lib/tmdbDetailCache";

describe("resolveSeasonEpisodesClientTtlMs", () => {
  it("已完結 / 已取消的作品用長快取", () => {
    expect(resolveSeasonEpisodesClientTtlMs("Ended")).toBe(
      DEFAULT_DETAIL_TTL_MS,
    );
    expect(resolveSeasonEpisodesClientTtlMs("Canceled")).toBe(
      DEFAULT_DETAIL_TTL_MS,
    );
  });

  it("播出中或狀態未知的作品用短快取，避免長 session 卡舊集數", () => {
    expect(resolveSeasonEpisodesClientTtlMs("Returning Series")).toBe(
      SHORT_DETAIL_TTL_MS,
    );
    expect(resolveSeasonEpisodesClientTtlMs(null)).toBe(SHORT_DETAIL_TTL_MS);
    expect(resolveSeasonEpisodesClientTtlMs(undefined)).toBe(
      SHORT_DETAIL_TTL_MS,
    );
  });
});
