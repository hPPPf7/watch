import { describe, expect, it } from "vitest";
import { getRecommendationsTtlMs } from "@/server/tmdb/cache";

describe("getRecommendationsTtlMs", () => {
  it("expires recommendations at the next 05:00 Taipei refresh window", () => {
    expect(
      getRecommendationsTtlMs(new Date("2026-06-16T09:10:00.000Z")),
    ).toBe(11 * 60 * 60 * 1000 + 50 * 60 * 1000);
  });

  it("uses today's refresh window before 05:00 Taipei", () => {
    expect(
      getRecommendationsTtlMs(new Date("2026-06-16T20:30:00.000Z")),
    ).toBe(30 * 60 * 1000);
  });
});
