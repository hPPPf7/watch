import {describe, expect, it, vi} from "vitest";
import {PgDialect} from "drizzle-orm/pg-core";
import type {SQL} from "drizzle-orm";
import {acquireFriendshipLocks} from "./friendshipLock";
import {acquireWatchlistItemLocks, ensureHistoryWatchlistItems, type WatchlistMutationTransaction} from "./watchlistItemMutationService";
const dialect=new PgDialect();
const owner="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ids=Array.from({length:100},(_,i)=>"00000000-0000-4000-8000-"+String(i).padStart(12,"0"));
describe("history bulk database operations",()=>{
 it("100 friends use two ordered lock statements and one membership insert",async()=>{
  const execute=vi.fn<(query: SQL) => Promise<void>>(async ()=>{}); const tx={execute} as unknown as WatchlistMutationTransaction;
  await acquireFriendshipLocks(tx,owner,[...ids].reverse());
  await acquireWatchlistItemLocks(tx,[owner,...ids,...ids],10);
  await ensureHistoryWatchlistItems(tx,[...ids,...ids],"tv",10,null,owner);
  expect(execute).toHaveBeenCalledTimes(3);
  const queries=execute.mock.calls.map(([q])=>dialect.sqlToQuery(q));
  expect(queries[0].params).toHaveLength(100);
  expect(queries[1].params).toHaveLength(101);
  expect(queries[0].params).toEqual([...queries[0].params].sort());
  expect(queries[1].params).toEqual([...queries[1].params].sort());
  for(const q of queries.slice(0,2)) expect(q.sql).toContain("ORDER BY lock_order");
  expect(queries[2].sql).toContain("WHERE NOT EXISTS");
  expect(queries[2].sql).toContain("ON CONFLICT DO NOTHING");
  expect(queries[2].sql).not.toContain("DO UPDATE");
  for(const id of ids) expect(queries[2].params.filter(p=>p===id)).toHaveLength(1);
 });
 it("empty selections do not issue SQL",async()=>{
  const execute=vi.fn();const tx={execute} as unknown as WatchlistMutationTransaction;
  await acquireFriendshipLocks(tx,owner,[]);await acquireWatchlistItemLocks(tx,[],10);await ensureHistoryWatchlistItems(tx,[],"tv",10,null,owner);
  expect(execute).not.toHaveBeenCalled();
 });
});
