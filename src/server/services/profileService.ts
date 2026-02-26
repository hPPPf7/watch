import { getProfileById, upsertProfile } from "@/server/repos/profileRepo";

export async function getProfileMe(input: {
  userId: string;
  email?: string | null;
  metadata?: {
    full_name?: string | null;
    name?: string | null;
    preferred_username?: string | null;
    avatar_url?: string | null;
    picture?: string | null;
    avatar?: string | null;
  };
}) {
  const profile = await getProfileById(input.userId);

  return {
    id: input.userId,
    email: input.email ?? null,
    nickname:
      profile?.nickname ??
      input.metadata?.full_name ??
      input.metadata?.name ??
      input.metadata?.preferred_username ??
      null,
    avatarUrl:
      profile?.avatar_url ??
      input.metadata?.avatar_url ??
      input.metadata?.picture ??
      input.metadata?.avatar ??
      null,
  };
}

export async function updateNickname(input: { userId: string; nickname: string }) {
  const nextNickname = input.nickname.trim();
  if (!nextNickname) {
    throw new Error("INVALID_NICKNAME");
  }

  const profile = await upsertProfile(input.userId, { nickname: nextNickname });
  return {
    id: input.userId,
    nickname: profile.nickname ?? null,
    avatarUrl: profile.avatar_url ?? null,
  };
}

