import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), getDb: vi.fn(), runInTransaction: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/server/db/client", () => ({ getDb: mocks.getDb, runInTransaction: mocks.runInTransaction }));
vi.mock("@/server/realtime/safePublish", () => ({ runBestEffortPublish: async () => {}, publishWatchUpdatesWithScopeFallback: async () => {} }));
import { friends, watchHistory, watchHistoryShares } from "@/server/db/schema";
import { POST as upsert } from "./history-upsert/route";
import { POST as shares } from "./history-sync-shares/route";
import { POST as watchlist } from "./history-sync-watchlist/route";
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const friend = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
describe.each([["upsert", upsert], ["shares", shares], ["watchlist", watchlist]] as const)("%s friendship authorization", (kind, post) => {
  beforeEach(() => mocks.auth.mockResolvedValue({ user: { id: owner } }));
  it("等待關係鎖時被取消好友，醒來後不得寫入對方資料", async () => {
    let release!: () => void;
    let entered!: () => void;
    const enteredLock = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let isFriend = true;
    let first = true;
    const inserts: unknown[] = [];
    const queries: SQL[] = [];
    const db = { select: vi.fn(() => { throw new Error("authorization outside transaction"); }) };
    const tx = {
      execute: vi.fn(async (query: SQL) => { queries.push(query); if (first) { first = false; entered(); await gate; } }),
      select: vi.fn(() => ({ from: (table: unknown) => {
        const result = () => table === friends ? (isFriend ? [{ friendId: friend }] : []) : table === watchHistory && kind === "shares" ? [{ id: "record" }] : [];
        const where = () => Object.assign(Promise.resolve(result()), { limit: async () => result() });
        return { where, innerJoin: () => ({ where }) };
      }})),
      insert: vi.fn((table: unknown) => { inserts.push(table); return { values: () => ({ onConflictDoNothing: () => ({ returning: async () => [{ id: "record" }] }) }) }; }),
      delete: vi.fn(() => ({ where: async () => {} })),
    };
    mocks.getDb.mockReturnValue(db); mocks.runInTransaction.mockImplementation(async fn => fn(tx));
    const pending = post(new Request("https://watch.invalid/api/detail/history", { method: "POST", body: JSON.stringify({ mediaType: "movie", tmdbId: 1, season: 0, episode: 0, watchedAt: "2026-01-01", friendIds: [friend.toUpperCase()] }) }));
    await enteredLock;
    expect(tx.select).not.toHaveBeenCalled();
    isFriend = false; release();
    expect((await pending).status).toBe(200);
    expect(db.select).not.toHaveBeenCalled();
    expect(inserts).not.toContain(watchHistoryShares);
    const dialect = new PgDialect();
    expect(dialect.sqlToQuery(queries[0]).params).toEqual([owner + ":" + friend]);
    const writes = queries.map(q => dialect.sqlToQuery(q)).filter(q => q.sql.includes("INSERT"));
    expect(writes.every(q => !q.params.includes(friend))).toBe(true);
  });
});
