import { and, eq, gt, or, sql } from "drizzle-orm";
import { runInAuthTransaction } from "@/server/db/client";
import { authSessionStates, deletedAuthAccountMarkers } from "@/server/db/schema";

export type AuthTransaction = Parameters<Parameters<typeof runInAuthTransaction>[0]>[0];
export type AuthIdentity = { provider: string; providerAccountId: string };

// OAuth takes an identity lock before its user lock. Deletion and profile writes
// take only the user lock, so aliases serialize without reversing lock order.
export async function acquireAuthIdentityLock(tx: AuthTransaction, identity: AuthIdentity) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(170101, hashtext(${JSON.stringify([identity.provider, identity.providerAccountId])}))`);
}

export async function acquireAuthUserLock(tx: AuthTransaction, userId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(170102, hashtext(${userId.toLowerCase()}))`);
}

export async function hasActiveAuthDeletionMarker(
  tx: AuthTransaction,
  userId: string,
  identity?: AuthIdentity,
) {
  const rows = await tx
    .select({ userId: deletedAuthAccountMarkers.userId })
    .from(deletedAuthAccountMarkers)
    .where(and(
      gt(deletedAuthAccountMarkers.expiresAt, new Date()),
      identity
        ? or(
            eq(deletedAuthAccountMarkers.userId, userId),
            and(
              eq(deletedAuthAccountMarkers.provider, identity.provider),
              eq(deletedAuthAccountMarkers.providerAccountId, identity.providerAccountId),
            ),
          )
        : eq(deletedAuthAccountMarkers.userId, userId),
    ))
    .limit(1);
  return rows.length > 0;
}

export async function withActiveAuthSession<T>(
  userId: string,
  sessionVersion: number,
  write: (tx: AuthTransaction) => Promise<T>,
) {
  return runInAuthTransaction(async (tx) => {
    await acquireAuthUserLock(tx, userId);
    const [state] = await tx
      .select({ sessionVersion: authSessionStates.sessionVersion })
      .from(authSessionStates)
      .where(eq(authSessionStates.userId, userId))
      .limit(1);
    if (!state || state.sessionVersion !== sessionVersion) {
      return { status: "invalid" as const };
    }
    return { status: "active" as const, value: await write(tx) };
  });
}
