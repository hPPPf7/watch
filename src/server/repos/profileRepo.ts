import { eq, sql } from "drizzle-orm";
import { getAuthDb } from "@/server/db/client";
import { withActiveAuthSession } from "@/server/auth/accountLifecycle";
import { profiles } from "@/server/db/schema";

export async function getProfileById(userId: string) {
  const db = getAuthDb();
  const rows = await db
    .select({
      id: profiles.id,
      nickname: profiles.nickname,
      provider_nickname: profiles.providerNickname,
      avatar_url: profiles.avatarUrl,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertProfile(
  userId: string,
  payload: { nickname?: string | null; avatarUrl?: string | null },
  sessionVersion: number,
) {
  const result = await withActiveAuthSession(userId, sessionVersion, async (db) => {
    const rows = await db
      .insert(profiles)
      .values({
        id: userId,
        nickname: payload.nickname ?? null,
        providerNickname: null,
        avatarUrl: payload.avatarUrl ?? null,
      })
      .onConflictDoUpdate({
        target: profiles.id,
        set: {
          nickname:
            payload.nickname !== undefined
              ? payload.nickname ?? null
              : sql`${profiles.nickname}`,
          avatarUrl:
            payload.avatarUrl !== undefined
              ? payload.avatarUrl ?? null
              : sql`${profiles.avatarUrl}`,
        },
      })
      .returning({
        id: profiles.id,
        nickname: profiles.nickname,
        provider_nickname: profiles.providerNickname,
        avatar_url: profiles.avatarUrl,
      });
    return rows[0];
  });
  if (result.status === "invalid") {
    throw new Error("AUTH_SESSION_INVALID");
  }
  return result.value;
}
