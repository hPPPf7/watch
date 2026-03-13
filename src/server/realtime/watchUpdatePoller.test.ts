import { beforeEach, describe, expect, it, vi } from "vitest";

const { readLatestWatchUpdate } = vi.hoisted(() => ({
  readLatestWatchUpdate: vi.fn(),
}));

vi.mock("@/server/realtime/watchUpdates", () => ({
  readLatestWatchUpdate,
}));

import {
  getSharedWatchUpdatePollIntervalMs,
  subscribeToSharedWatchUpdatePoller,
} from "@/server/realtime/watchUpdatePoller";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("watchUpdatePoller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    const globalState = globalThis as typeof globalThis & {
      __watchUpdateSharedPollers?: Map<string, unknown>;
    };
    globalState.__watchUpdateSharedPollers?.clear();
  });

  it("同一使用者多個 subscriber 共用同一條輪詢", async () => {
    readLatestWatchUpdate.mockResolvedValue({
      reason: "watchlist_update",
      at: 123,
      nonce: "nonce-1",
    });
    const subscriberA = vi.fn();
    const subscriberB = vi.fn();

    const unsubscribeA = subscribeToSharedWatchUpdatePoller("user-1", subscriberA);
    const unsubscribeB = subscribeToSharedWatchUpdatePoller("user-1", subscriberB);

    await vi.runAllTicks();
    await Promise.resolve();

    expect(readLatestWatchUpdate).toHaveBeenCalledTimes(1);
    expect(subscriberA).toHaveBeenCalledWith({
      reason: "watchlist_update",
      at: 123,
      nonce: "nonce-1",
    });
    expect(subscriberB).toHaveBeenCalledWith({
      reason: "watchlist_update",
      at: 123,
      nonce: "nonce-1",
    });

    subscriberA.mockClear();
    subscriberB.mockClear();
    readLatestWatchUpdate.mockResolvedValue({
      reason: "watchlist_update",
      at: 456,
      nonce: "nonce-2",
    });

    await vi.advanceTimersByTimeAsync(getSharedWatchUpdatePollIntervalMs());

    expect(readLatestWatchUpdate).toHaveBeenCalledTimes(2);
    expect(subscriberA).toHaveBeenCalledTimes(1);
    expect(subscriberB).toHaveBeenCalledTimes(1);

    unsubscribeA();
    unsubscribeB();
  });

  it("新 subscriber 會收到最近一次已知更新，最後一個取消後停止輪詢", async () => {
    readLatestWatchUpdate.mockResolvedValueOnce({
      reason: "watchlist_update",
      at: 123,
      nonce: "nonce-1",
    });
    const subscriberA = vi.fn();
    const unsubscribeA = subscribeToSharedWatchUpdatePoller("user-1", subscriberA);

    await vi.runAllTicks();
    await Promise.resolve();

    const subscriberB = vi.fn();
    const unsubscribeB = subscribeToSharedWatchUpdatePoller("user-1", subscriberB);

    expect(subscriberB).toHaveBeenCalledWith({
      reason: "watchlist_update",
      at: 123,
      nonce: "nonce-1",
    });

    unsubscribeA();
    unsubscribeB();
    readLatestWatchUpdate.mockClear();

    await vi.advanceTimersByTimeAsync(getSharedWatchUpdatePollIntervalMs());

    expect(readLatestWatchUpdate).not.toHaveBeenCalled();
  });

  it("舊 poller 完成時不會刪掉重連後的新 entry", async () => {
    const deferred = createDeferred<{
      reason: string;
      at: number;
      nonce: string;
    } | null>();
    readLatestWatchUpdate.mockReturnValueOnce(deferred.promise);

    const subscriberA = vi.fn();
    const unsubscribeA = subscribeToSharedWatchUpdatePoller("user-1", subscriberA);

    unsubscribeA();

    readLatestWatchUpdate.mockResolvedValueOnce({
      reason: "watchlist_update",
      at: 456,
      nonce: "nonce-2",
    });
    const subscriberB = vi.fn();
    const unsubscribeB = subscribeToSharedWatchUpdatePoller("user-1", subscriberB);

    deferred.resolve({
      reason: "watchlist_update",
      at: 123,
      nonce: "nonce-1",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(subscriberB).toHaveBeenCalledWith({
      reason: "watchlist_update",
      at: 456,
      nonce: "nonce-2",
    });

    subscriberB.mockClear();
    readLatestWatchUpdate.mockResolvedValueOnce({
      reason: "watchlist_update",
      at: 789,
      nonce: "nonce-3",
    });

    await vi.advanceTimersByTimeAsync(getSharedWatchUpdatePollIntervalMs());

    expect(subscriberB).toHaveBeenCalledWith({
      reason: "watchlist_update",
      at: 789,
      nonce: "nonce-3",
    });

    unsubscribeB();
  });

  it("快取事件過期後，新 subscriber 不會重播舊更新", async () => {
    readLatestWatchUpdate
      .mockResolvedValueOnce({
        reason: "watchlist_update",
        at: 123,
        nonce: "nonce-1",
      })
      .mockResolvedValueOnce(null);

    const subscriberA = vi.fn();
    const unsubscribeA = subscribeToSharedWatchUpdatePoller("user-1", subscriberA);

    await vi.runAllTicks();
    await Promise.resolve();

    expect(subscriberA).toHaveBeenCalledWith({
      reason: "watchlist_update",
      at: 123,
      nonce: "nonce-1",
    });

    await vi.advanceTimersByTimeAsync(getSharedWatchUpdatePollIntervalMs());

    const subscriberB = vi.fn();
    const unsubscribeB = subscribeToSharedWatchUpdatePoller("user-1", subscriberB);

    expect(subscriberB).not.toHaveBeenCalled();

    unsubscribeA();
    unsubscribeB();
  });
});
