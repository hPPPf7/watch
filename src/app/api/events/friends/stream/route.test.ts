import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  auth,
  getFriendNoticeTransportMode,
  subscribeToFriendNoticeEvents,
} = vi.hoisted(() => ({
  auth: vi.fn(),
  getFriendNoticeTransportMode: vi.fn(),
  subscribeToFriendNoticeEvents: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth,
}));

vi.mock("@/server/realtime/friendNoticeEventBus", () => ({
  getFriendNoticeTransportMode,
  subscribeToFriendNoticeEvents,
}));

import { GET, HEAD } from "@/app/api/events/friends/stream/route";

describe("GET /api/events/friends/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
    getFriendNoticeTransportMode.mockReturnValue("redis");
    subscribeToFriendNoticeEvents.mockResolvedValue(vi.fn());
  });

  it("未登入時回 401，不建立好友通知訂閱", async () => {
    auth.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/events/friends/stream"));

    expect(response.status).toBe(401);
    expect(subscribeToFriendNoticeEvents).not.toHaveBeenCalled();
  });

  it("HEAD 會回 transport 可用性，供前端決定是否開 SSE", async () => {
    getFriendNoticeTransportMode.mockReturnValue("polling");

    const pollingResponse = await HEAD();
    expect(pollingResponse.status).toBe(409);

    getFriendNoticeTransportMode.mockReturnValue("redis");
    const redisResponse = await HEAD();
    expect(redisResponse.status).toBe(200);
  });

  it("沒有 Redis transport 時回 503，交給前端 fallback", async () => {
    getFriendNoticeTransportMode.mockReturnValue("polling");

    const response = await GET(new Request("http://localhost/api/events/friends/stream"));

    expect(response.status).toBe(503);
    expect(subscribeToFriendNoticeEvents).not.toHaveBeenCalled();
  });

  it("有 Redis transport 時建立好友通知訂閱", async () => {
    const response = await GET(new Request("http://localhost/api/events/friends/stream"));
    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();
    const first = await reader!.read();
    const second = await reader!.read();
    const firstChunk = new TextDecoder().decode(first.value);
    const secondChunk = new TextDecoder().decode(second.value);

    expect(response.status).toBe(200);
    expect(subscribeToFriendNoticeEvents).toHaveBeenCalledWith(
      "user-1",
      expect.any(Function),
    );
    expect(firstChunk).toContain('"type":"connected"');
    expect(secondChunk).toContain('"type":"friend_notice_update"');
    expect(secondChunk).toContain('"reason":"bootstrap"');
    await reader!.cancel();
  });

  it("Redis 訂閱失敗時回非 2xx，讓前端維持 polling fallback", async () => {
    subscribeToFriendNoticeEvents.mockRejectedValueOnce(new Error("redis down"));

    const response = await GET(new Request("http://localhost/api/events/friends/stream"));

    expect(response.status).toBe(503);
  });
});
