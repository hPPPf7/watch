import { sql } from "drizzle-orm";
import type { WatchlistMutationTransaction } from "./watchlistItemMutationService";
export async function acquireFriendshipLocks(tx: WatchlistMutationTransaction, userId: string, targetIds: string[]) {
  const keys = [...new Set(targetIds.map(id => [userId.toLowerCase(), id.toLowerCase()].sort().join(":")))].sort();
  if (keys.length === 0) return;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(lock_key))
    FROM unnest(ARRAY[${sql.join(keys.map(key => sql`${key}`), sql`, `)}]::text[])
      WITH ORDINALITY AS locks(lock_key, lock_order)
    ORDER BY lock_order`);
}
