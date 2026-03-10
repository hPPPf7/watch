import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { profiles } from "@/server/db/schema";

export async function getProfileById(userId: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: profiles.id,
      nickname: profiles.nickname,
      avatar_url: profiles.avatarUrl,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertProfile(
  userId: string,
  payload: { nickname?: string | null; avatarUrl?: string | null }
) {
  const db = getDb();
  const existing = await getProfileById(userId);
  const nextNickname =
    payload.nickname !== undefined ? payload.nickname ?? null : existing?.nickname ?? null;
  const nextAvatarUrl =
    payload.avatarUrl !== undefined
      ? payload.avatarUrl ?? null
      : existing?.avatar_url ?? null;
  const rows = await db
    .insert(profiles)
    .values({
      id: userId,
      nickname: nextNickname,
      avatarUrl: nextAvatarUrl,
    })
    .onConflictDoUpdate({
      target: profiles.id,
      set: {
        nickname: nextNickname,
        avatarUrl: nextAvatarUrl,
      },
    })
    .returning({
      id: profiles.id,
      nickname: profiles.nickname,
      avatar_url: profiles.avatarUrl,
    });

  return rows[0];
}
