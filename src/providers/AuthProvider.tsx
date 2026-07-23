"use client";

import { createContext, useContext, useMemo } from "react";
import { useSession } from "next-auth/react";
import type { LegacySession } from "@/types/auth";

type AuthContextValue = {
  session: LegacySession | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue>({
  session: null,
  loading: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data, status } = useSession();
  const userId = data?.user?.id;
  const email = data?.user?.email;
  const metadata = data?.user?.user_metadata;
  const hasMetadata = Boolean(metadata);
  const fullName = metadata?.full_name;
  const name = metadata?.name;
  const preferredUsername = metadata?.preferred_username;
  const avatarUrl = metadata?.avatar_url;
  const picture = metadata?.picture;
  const avatar = metadata?.avatar;

  const session = useMemo<LegacySession | null>(() => {
    if (!userId) return null;
    return {
      user: {
        id: userId,
        email,
        user_metadata: hasMetadata
          ? {
              full_name: fullName,
              name,
              preferred_username: preferredUsername,
              avatar_url: avatarUrl,
              picture,
              avatar,
            }
          : undefined,
      },
    };
  }, [
    avatar,
    avatarUrl,
    email,
    fullName,
    hasMetadata,
    name,
    picture,
    preferredUsername,
    userId,
  ]);

  const value = useMemo(
    () => ({
      session,
      loading: status === "loading",
    }),
    [session, status]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
