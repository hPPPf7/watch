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

  const session = useMemo<LegacySession | null>(() => {
    if (!data?.user?.id) return null;
    return {
      user: {
        id: data.user.id,
        email: data.user.email,
        user_metadata: data.user.user_metadata,
      },
    };
  }, [data]);

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
