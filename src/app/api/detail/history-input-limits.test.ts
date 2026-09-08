import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), getDb: vi.fn(), runInTransaction: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/server/db/client", () => ({ getDb: mocks.getDb, runInTransaction: mocks.runInTransaction }));
vi.mock("@/server/realtime/safePublish", () => ({ runBestEffortPublish: async () => {}, publishWatchUpdatesWithScopeFallback: async () => {} }));
import { POST as upsert } from "./history-upsert/route";
import { POST as shares } from "./history-sync-shares/route";
import { POST as watchlist } from "./history-sync-watchlist/route";
import { parseHistoryFriendIds, MAX_HISTORY_FRIEND_IDS } from "@/lib/historyFriendIds";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ids = Array.from({ length: 1000 }, (_, i) => i.toString(16).padStart(8, "0") + "-0000-4000-8000-000000000000");
const request = (friendIds: unknown) => new Request("https://watch.invalid/api/detail/history", { method: "POST", body: JSON.stringify({ mediaType: "movie", tmdbId: 1, watchedAt: "2026-01-01", friendIds }) });
describe.each([["upsert", upsert], ["shares", shares], ["watchlist", watchlist]] as const)("%s 輸入限制", (_, post) => {
  beforeEach(() => { mocks.auth.mockResolvedValue({ user: { id } }); mocks.getDb.mockReturnValue({}); mocks.runInTransaction.mockResolvedValue({ ok: true, duplicate: false, affectedUsers: [], didChange: false, affectedUserIds: new Set() }); });
  it.each([ids, ids.slice(0, 101), Array(101).fill(id), Array(101).fill(id.toUpperCase())])("超量清單完全不進資料庫 %#", async list => {
    expect((await post(request(list))).status).toBe(400);
    expect(mocks.getDb).not.toHaveBeenCalled(); expect(mocks.runInTransaction).not.toHaveBeenCalled();
  });
  it.each([null, true, 1, "bad", {}, [null], [1], ["invalid"]])("拒絕格式錯誤且不清除分享 %#", async list => {
    expect((await post(request(list))).status).toBe(400); expect(mocks.getDb).not.toHaveBeenCalled(); expect(mocks.runInTransaction).not.toHaveBeenCalled();
  });
  it("剛好 100 位仍允許進入正常流程", async () => {
    expect((await post(request(ids.slice(0, MAX_HISTORY_FRIEND_IDS)))).status).toBe(200);
    expect(mocks.runInTransaction).toHaveBeenCalledOnce();
  });
});
it("省略、清空與大小寫重複的語意保持明確", () => {
  expect(parseHistoryFriendIds(undefined)).toEqual({ ok: true, ids: undefined });
  expect(parseHistoryFriendIds([])).toEqual({ ok: true, ids: [] });
  expect(parseHistoryFriendIds([id, id.toUpperCase()])).toEqual({ ok: true, ids: [id] });
});
