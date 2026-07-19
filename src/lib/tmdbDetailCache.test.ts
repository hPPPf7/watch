import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DETAIL_TTL_MS,
  getOrLoadDetailCache,
  resolveSeasonEpisodesClientTtlMs,
  setDetailCache,
  SHORT_DETAIL_TTL_MS,
} from "@/lib/tmdbDetailCache";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

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

describe("getOrLoadDetailCache（請求併發限制）", () => {
  it("真正呼叫 loader 的並行數不超過共用上限（4）", async () => {
    let active = 0;
    let maxActive = 0;

    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        getOrLoadDetailCache(`concurrency-test:${index}`, async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await tick();
          active -= 1;
          return { index };
        }),
      ),
    );

    expect(maxActive).toBeLessThanOrEqual(4);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("快取命中不佔用請求名額，就算限制被其他 loader 佔滿也能立刻回傳", async () => {
    const cachedKey = "concurrency-test:cached";
    setDetailCache(cachedKey, { cached: true }, DEFAULT_DETAIL_TTL_MS);

    // 先佔滿全部名額，讓真正的 loader 都卡在等待中。
    const blockers = Array.from({ length: 4 }, (_, index) =>
      getOrLoadDetailCache(`concurrency-test:blocker:${index}`, async () => {
        await tick();
        await tick();
        return { index };
      }),
    );

    // 快取命中應該不需要排隊，loader 也不會被呼叫。
    const loader = vi.fn();
    const result = await getOrLoadDetailCache(cachedKey, loader);

    expect(result).toEqual({ cached: true });
    expect(loader).not.toHaveBeenCalled();

    await Promise.all(blockers);
  });
});
