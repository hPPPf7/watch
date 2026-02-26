import { and, eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { getDb } from "@/server/db/client";
import { authUserMap, profiles } from "@/server/db/schema";

const googleClientId = process.env.AUTH_GOOGLE_ID ?? "";
const googleClientSecret = process.env.AUTH_GOOGLE_SECRET ?? "";
const authSecret =
  process.env.AUTH_SECRET ||
  (process.env.NODE_ENV === "development" ? "dev-auth-secret-not-for-prod" : undefined);

async function toDeterministicUuid(input: string) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const p1 = hash.slice(0, 8);
  const p2 = hash.slice(8, 12);
  const p3 = `4${hash.slice(13, 16)}`;
  const variantNibble = (parseInt(hash.slice(16, 17), 16) & 0x3) | 0x8;
  const p4 = `${variantNibble.toString(16)}${hash.slice(17, 20)}`;
  const p5 = hash.slice(20, 32);
  return `${p1}-${p2}-${p3}-${p4}-${p5}`;
}

async function resolveMappedUserId(params: {
  provider: string;
  providerAccountId: string;
  tokenSub?: string;
}) {
  let db;
  try {
    db = getDb();
  } catch {
    return await toDeterministicUuid(
      `${params.provider}:${params.providerAccountId}`,
    );
  }

  const existing = await db
    .select({ user_id: authUserMap.userId })
    .from(authUserMap)
    .where(
      and(
        eq(authUserMap.provider, params.provider),
        eq(authUserMap.providerAccountId, params.providerAccountId)
      )
    )
    .limit(1);

  if (existing[0]?.user_id) {
    return existing[0].user_id as string;
  }

  const newUserId =
    params.tokenSub && /^[0-9a-fA-F-]{36}$/.test(params.tokenSub)
      ? params.tokenSub
      : await toDeterministicUuid(
          `${params.provider}:${params.providerAccountId}`,
        );

  await db
    .insert(authUserMap)
    .values({
      provider: params.provider,
      providerAccountId: params.providerAccountId,
      userId: newUserId,
    })
    .onConflictDoUpdate({
      target: [authUserMap.provider, authUserMap.providerAccountId],
      set: { userId: newUserId },
    });

  return newUserId;
}

export const { handlers, auth } = NextAuth({
  providers:
    googleClientId && googleClientSecret
      ? [
          Google({
            clientId: googleClientId,
            clientSecret: googleClientSecret,
            authorization: {
              params: {
                prompt: "select_account",
              },
            },
          }),
        ]
      : [],
  secret: authSecret,
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account?.provider && account.providerAccountId) {
        token.app_user_id = await resolveMappedUserId({
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          tokenSub: token.sub,
        });
      } else if (!token.app_user_id && token.sub) {
        token.app_user_id = /^[0-9a-fA-F-]{36}$/.test(token.sub)
          ? token.sub
          : await toDeterministicUuid(`legacy:${token.sub}`);
      }

      if (profile) {
        token.user_metadata = {
          full_name: typeof profile.name === "string" ? profile.name : null,
          name: typeof profile.name === "string" ? profile.name : null,
          preferred_username:
            typeof profile.given_name === "string" ? profile.given_name : null,
          avatar_url: typeof profile.picture === "string" ? profile.picture : null,
          picture: typeof profile.picture === "string" ? profile.picture : null,
          avatar: typeof profile.picture === "string" ? profile.picture : null,
        };
      }

      if (token.app_user_id) {
        try {
          const db = getDb();
          await db
            .insert(profiles)
            .values({
              id: token.app_user_id,
              nickname:
                token.user_metadata?.full_name ??
                token.user_metadata?.name ??
                null,
              avatarUrl:
                token.user_metadata?.avatar_url ??
                token.user_metadata?.picture ??
                null,
            })
            .onConflictDoUpdate({
              target: profiles.id,
              set: {
                nickname:
                  token.user_metadata?.full_name ??
                  token.user_metadata?.name ??
                  null,
                avatarUrl:
                  token.user_metadata?.avatar_url ??
                  token.user_metadata?.picture ??
                  null,
              },
            });
        } catch {
          // Ignore DB unavailability during auth callback.
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (!session.user) return session;
      session.user.id = token.app_user_id ?? token.sub ?? "";
      session.user.user_metadata = token.user_metadata;
      return session;
    },
  },
});
