import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  auth,
  getWatchUpdateTransportMode,
  subscribeToWatchUpdateEvents,
  subscribeToSharedWatchUpdatePoller,
  readLatestWatchUpdate,
} = vi.hoisted(() => ({
  auth: vi.fn(),
  getWatchUpdateTransportMode: vi.fn(),
  subscribeToWatchUpdateEvents: vi.fn(),
  subscribeToSharedWatchUpdatePoller: vi.fn(),
  readLatestWatchUpdate: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth,
}));

vi.mock("@/server/realtime/watchEventBus", () => ({
  getWatchUpdateTransportMode,
  subscribeToWatchUpdateEvents,
}));

vi.mock("@/server/realtime/watchUpdatePoller", () => ({
  subscribeToSharedWatchUpdatePoller,
}));

vi.mock("@/server/realtime/watchUpdates", () => ({
  readLatestWatchUpdate,
}));

import { GET } from "@/app/api/events/watchlist/stream/route";

describe("GET /api/events/watchlist/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
    getWatchUpdateTransportMode.mockReturnValue("polling");
    subscribeToWatchUpdateEvents.mockResolvedValue(vi.fn());
    subscribeToSharedWatchUpdatePoller.mockReturnValue(vi.fn());
    readLatestWatchUpdate.mockResolvedValue(null);
  });

  it("未登入時回 401，不建立任何即時訂閱", async () => {
    auth.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/events/watchlist/stream"));

    expect(response.status).toBe(401);
    expect(subscribeToWatchUpdateEvents).not.toHaveBeenCalled();
    expect(subscribeToSharedWatchUpdatePoller).not.toHaveBeenCalled();
  });

  it("有 REDIS transport 時優先訂閱 Redis，不走 shared poller", async () => {
    getWatchUpdateTransportMode.mockReturnValue("redis");

    const response = await GET(new Request("http://localhost/api/events/watchlist/stream"));
    await Promise.resolve();
    await Promise.resolve();

    expect(response.status).toBe(200);
    expect(subscribeToWatchUpdateEvents).toHaveBeenCalledWith(
      "user-1",
      expect.any(Function),
    );
    expect(subscribeToSharedWatchUpdatePoller).not.toHaveBeenCalled();
  });

  it("Redis 訂閱失敗時會回退到 shared poller", async () => {
    getWatchUpdateTransportMode.mockReturnValue("redis");
    subscribeToWatchUpdateEvents.mockRejectedValueOnce(new Error("redis down"));

    const response = await GET(new Request("http://localhost/api/events/watchlist/stream"));
    await Promise.resolve();
    await Promise.resolve();

    expect(response.status).toBe(200);
    expect(subscribeToWatchUpdateEvents).toHaveBeenCalledTimes(1);
    expect(subscribeToSharedWatchUpdatePoller).toHaveBeenCalledWith(
      "user-1",
      expect.any(Function),
    );
  });

  it("polling transport 時直接使用 shared poller", async () => {
    getWatchUpdateTransportMode.mockReturnValue("polling");

    const response = await GET(new Request("http://localhost/api/events/watchlist/stream"));
    await Promise.resolve();

    expect(response.status).toBe(200);
    expect(subscribeToWatchUpdateEvents).not.toHaveBeenCalled();
    expect(subscribeToSharedWatchUpdatePoller).toHaveBeenCalledWith(
      "user-1",
      expect.any(Function),
    );
  });

  it("Redis 訂閱建立後會 replay 最新持久化 update", async () => {
    const unsubscribe = vi.fn();
    let redisHandler:
      | ((record: { reason: string; at: number }) => void)
      | undefined;
    subscribeToWatchUpdateEvents.mockImplementationOnce(async (_userId, handler) => {
      redisHandler = handler;
      return unsubscribe;
    });
    readLatestWatchUpdate.mockResolvedValueOnce({
      reason: "watchlist_update",
      at: 123,
      nonce: "nonce-1",
    });
    getWatchUpdateTransportMode.mockReturnValue("redis");

    const response = await GET(new Request("http://localhost/api/events/watchlist/stream"));
    expect(response.status).toBe(200);

    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();
    const first = await reader!.read();
    const second = await reader!.read();

    const firstChunk = new TextDecoder().decode(first.value);
    const secondChunk = new TextDecoder().decode(second.value);
    expect(firstChunk).toContain('"type":"connected"');
    expect(secondChunk).toContain('"type":"watchlist_update"');
    expect(secondChunk).toContain('"at":123');

    expect(redisHandler).toBeTruthy();
    if (redisHandler) {
      redisHandler({ reason: "watchlist_update", at: 456 });
    }
    const third = await reader!.read();
    const thirdChunk = new TextDecoder().decode(third.value);
    expect(thirdChunk).toContain('"at":456');
    await reader!.cancel();
  });
  it("Redis 已先送出同一筆 update 時，不會再被 replay 重複送出", async () => {
    const unsubscribe = vi.fn();
    let redisHandler:
      | ((record: { reason: string; at: number; nonce?: string }) => void)
      | undefined;
    subscribeToWatchUpdateEvents.mockImplementationOnce(async (_userId, handler) => {
      redisHandler = handler as typeof redisHandler;
      return unsubscribe;
    });
    readLatestWatchUpdate.mockResolvedValueOnce({
      reason: "history_upsert",
      at: 123,
      nonce: "nonce-1",
    });
    getWatchUpdateTransportMode.mockReturnValue("redis");

    const response = await GET(new Request("http://localhost/api/events/watchlist/stream"));
    expect(response.status).toBe(200);

    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();
    const first = await reader!.read();
    const firstChunk = new TextDecoder().decode(first.value);
    expect(firstChunk).toContain('"type":"connected"');

    expect(redisHandler).toBeTruthy();
    if (redisHandler) {
      redisHandler({ reason: "history_upsert", at: 123, nonce: "nonce-1" });
    }

    const second = await reader!.read();
    const secondChunk = new TextDecoder().decode(second.value);
    expect(secondChunk).toContain('"type":"watchlist_update"');
    expect(secondChunk).toContain('"at":123');

    const duplicateRead = await Promise.race([
      reader!.read(),
      new Promise<{ done: false; value: Uint8Array }>((resolve) => {
        setTimeout(() => {
          resolve({ done: false, value: new TextEncoder().encode("__timeout__") });
        }, 20);
      }),
    ]);
    const duplicateChunk = new TextDecoder().decode(duplicateRead.value);
    expect(duplicateChunk).toBe("__timeout__");
    await reader!.cancel();
  });
});
