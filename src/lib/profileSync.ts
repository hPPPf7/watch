import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";

export const syncProfileFromUser = async (user: User) => {
  const metadata = user.user_metadata ?? {};
  const fallbackName =
    metadata.full_name || metadata.name || metadata.preferred_username || "";
  const avatarUrl =
    metadata.avatar_url || metadata.picture || metadata.avatar || "";

  const { data } = await supabase
    .from("profiles")
    .select("nickname, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  const nextNickname =
    data?.nickname && data.nickname.trim().length > 0
      ? data.nickname
      : fallbackName;
  const nextAvatar =
    data?.avatar_url && data.avatar_url.trim().length > 0
      ? data.avatar_url
      : avatarUrl;

  if (!nextNickname && !nextAvatar) return;

  await supabase.from("profiles").upsert({
    id: user.id,
    nickname: nextNickname || null,
    avatar_url: nextAvatar || null,
  });
};
