import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DETAIL_TTL_MS,
  getDetailCache,
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

  it("skipCache 時不能搭上既有 in-flight（非強制）請求的便車，必須真的重新呼叫 loader", async () => {
    const key = "concurrency-test:skip-cache";
    let releaseFirst: (() => void) | undefined;
    const firstLoader = vi.fn(
      () =>
        new Promise((resolve) => {
          releaseFirst = () => resolve({ source: "first" });
        }),
    );
    const firstRequest = getOrLoadDetailCache(key, firstLoader);
    await tick();
    expect(firstLoader).toHaveBeenCalledTimes(1);

    const secondLoader = vi.fn().mockResolvedValue({ source: "second" });
    const secondResult = await getOrLoadDetailCache(key, secondLoader, undefined, {
      skipCache: true,
    });

    expect(secondLoader).toHaveBeenCalledTimes(1);
    expect(secondResult).toEqual({ source: "second" });

    releaseFirst?.();
    await firstRequest;
  });

  it("較晚解出的舊請求不能把較新（強制刷新）請求剛寫入的資料覆蓋掉", async () => {
    const key = "concurrency-test:stale-overwrite";
    let releaseFirst: (() => void) | undefined;
    const firstLoader = vi.fn(
      () =>
        new Promise((resolve) => {
          releaseFirst = () => resolve({ source: "stale" });
        }),
    );
    const firstRequest = getOrLoadDetailCache(key, firstLoader);
    await tick();

    // 強制刷新請求略過 in-flight 便車，直接發起自己的請求，且比舊請求先完成。
    const secondResult = await getOrLoadDetailCache(
      key,
      vi.fn().mockResolvedValue({ source: "fresh" }),
      undefined,
      { skipCache: true },
    );
    expect(secondResult).toEqual({ source: "fresh" });
    expect(getDetailCache(key)).toEqual({ source: "fresh" });

    // 舊請求才姍姍來遲：不該覆蓋掉剛寫入的新資料，也不該誤刪已經不屬於
    // 自己的 in-flight 登記。
    releaseFirst?.();
    await firstRequest;
    expect(getDetailCache(key)).toEqual({ source: "fresh" });

    // 之後第三個呼叫應該直接命中快取，不需要再發一次請求。
    const thirdLoader = vi.fn();
    const thirdResult = await getOrLoadDetailCache(key, thirdLoader);
    expect(thirdResult).toEqual({ source: "fresh" });
    expect(thirdLoader).not.toHaveBeenCalled();
  });

  it("較晚發起的並行請求失敗時，不能擋住較早發起、之後才成功的請求寫入快取", async () => {
    const key = "concurrency-test:later-request-fails";
    let releaseEarlier: (() => void) | undefined;
    const earlierLoader = vi.fn(
      () =>
        new Promise((resolve) => {
          releaseEarlier = () => resolve({ source: "earlier-success" });
        }),
    );
    const earlierRequest = getOrLoadDetailCache(key, earlierLoader, undefined, {
      skipCache: true,
    });
    await tick();

    // 較晚發起的並行強制刷新請求先解出，但失敗（例如網路逾時 / TMDB
    // rate limit），不應該在 requestWriteSeq 留下任何紀錄擋住較早的請求。
    const laterResult = await getOrLoadDetailCache(
      key,
      vi.fn().mockResolvedValue(null),
      undefined,
      { skipCache: true },
    );
    expect(laterResult).toBeNull();
    expect(getDetailCache(key)).toBeNull();

    // 較早發起的請求隨後才成功：即使自己「開始」得比失敗的那個早，仍然
    // 應該正常寫入快取，不能因為序號比較舊、且曾經被覆蓋過 in-flight
    // 登記，就永遠失去寫入資格。
    releaseEarlier?.();
    const earlierResult = await earlierRequest;
    expect(earlierResult).toEqual({ source: "earlier-success" });
    expect(getDetailCache(key)).toEqual({ source: "earlier-success" });
  });

  it("新資料被 LRU 逐出後，仍在飛行中的舊請求不能把過期資料寫回", async () => {
    const key = "concurrency-test:lru-stale-revival";
    let releaseStale: (() => void) | undefined;
    const staleRequest = getOrLoadDetailCache(
      key,
      () =>
        new Promise((resolve) => {
          releaseStale = () => resolve({ source: "stale" });
        }),
    );
    await tick();

    await getOrLoadDetailCache(
      key,
      vi.fn().mockResolvedValue({ source: "fresh" }),
      undefined,
      { skipCache: true },
    );
    expect(getDetailCache(key)).toEqual({ source: "fresh" });

    // 寫入超過快取上限的其他 key，確實把剛寫入的 fresh 資料逐出；此時舊
    // 請求仍在飛行，仲裁序號必須保留到它結束，不能跟著 cache entry 清掉。
    for (let index = 0; index <= 300; index += 1) {
      setDetailCache(`concurrency-test:lru-fill:${index}`, { index });
    }
    expect(getDetailCache(key)).toBeNull();

    releaseStale?.();
    await staleRequest;
    expect(getDetailCache(key)).toBeNull();
  });
});
