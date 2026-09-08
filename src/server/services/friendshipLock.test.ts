import { describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { acquireFriendshipLocks } from "./friendshipLock";
import type { WatchlistMutationTransaction } from "./watchlistItemMutationService";
describe("friendship transaction lock", () => {
  it("互換方向與大小寫仍共用相同鎖，多對鎖排序去重", async () => {
    const execute = vi.fn<(query: SQL) => Promise<void>>(async () => {});
    const tx = { execute } as unknown as WatchlistMutationTransaction;
    const dialect = new PgDialect();
    await acquireFriendshipLocks(tx, "B", ["C", "a", "A"]);
    const keys = execute.mock.calls.flatMap(call => dialect.sqlToQuery(call[0]!).params);
    expect(keys).toEqual(["a:b", "b:c"]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(dialect.sqlToQuery(execute.mock.calls[0][0]).sql).toContain("ORDER BY lock_order");
    execute.mockClear();
    await acquireFriendshipLocks(tx, "a", ["b"]);
    expect(dialect.sqlToQuery(execute.mock.calls[0][0]!).params).toEqual(["a:b"]);
  });
});
