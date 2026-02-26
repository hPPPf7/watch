type AppUser = {
  id: string;
  user_metadata?: Record<string, unknown> | null;
};

export const syncProfileFromUser = async (user: AppUser) => {
  if (!user?.id) return;
  await fetch("/api/profile/me", { cache: "no-store" }).catch(() => undefined);
};
