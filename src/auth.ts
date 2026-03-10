import { and, eq, sql } from "drizzle-orm";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { getDb } from "@/server/db/client";
import { authUserMap, profiles } from "@/server/db/schema";
import { isUuidString } from "@/lib/uuid";

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

async function findExistingUserId(candidate?: string) {
  if (!candidate || !isUuidString(candidate)) {
    return null;
  }

  let db;
  try {
    db = getDb();
  } catch {
    return null;
  }

  const existingProfile = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.id, candidate))
    .limit(1);

  if (existingProfile[0]?.id) {
    return existingProfile[0].id as string;
  }

  const existingMap = await db
    .select({ user_id: authUserMap.userId })
    .from(authUserMap)
    .where(eq(authUserMap.userId, candidate))
    .limit(1);

  return (existingMap[0]?.user_id as string | undefined) ?? null;
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

  const legacyUserId = await findExistingUserId(params.tokenSub);
  const newUserId =
    legacyUserId ??
    (isUuidString(params.tokenSub) ? params.tokenSub : null) ??
    (await toDeterministicUuid(
      `${params.provider}:${params.providerAccountId}`,
    ));

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
      const previousProviderNickname =
        token.user_metadata?.full_name ?? token.user_metadata?.name ?? null;
      if (account?.provider && account.providerAccountId) {
        token.app_user_id = await resolveMappedUserId({
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          tokenSub: token.sub,
        });
      } else if (!token.app_user_id && token.sub) {
        token.app_user_id =
          (isUuidString(token.sub) ? token.sub : null) ??
          (await toDeterministicUuid(`legacy:${token.sub}`));
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
        token.profile_sync_pending = true;
      }

      if (
        token.app_user_id &&
        token.user_metadata &&
        (account || profile || token.profile_sync_pending)
      ) {
        try {
          const db = getDb();
          const nextNickname =
            token.user_metadata?.full_name ??
            token.user_metadata?.name ??
            null;
          const nextAvatarUrl =
            token.user_metadata?.avatar_url ??
            token.user_metadata?.picture ??
            null;
          await db
            .insert(profiles)
            .values({
              id: token.app_user_id,
              nickname: nextNickname,
              providerNickname: nextNickname,
              avatarUrl: nextAvatarUrl,
            })
            .onConflictDoUpdate({
              target: profiles.id,
              set: {
                nickname:
                  nextNickname === null
                    ? sql`${profiles.nickname}`
                    : previousProviderNickname
                      ? sql`case
                          when ${profiles.nickname} is null
                            or ${profiles.nickname} = ${previousProviderNickname}
                          then ${nextNickname}
                          else ${profiles.nickname}
                        end`
                      : sql`case
                          when ${profiles.nickname} is null then ${nextNickname}
                          when ${profiles.providerNickname} is not null
                            and ${profiles.nickname} = ${profiles.providerNickname}
                          then ${nextNickname}
                          else ${profiles.nickname}
                        end`,
                providerNickname:
                  nextNickname === null
                    ? sql`${profiles.providerNickname}`
                    : nextNickname,
                avatarUrl: sql`coalesce(${nextAvatarUrl}, ${profiles.avatarUrl})`,
              },
            });
          token.profile_sync_pending = false;
        } catch {
          // 驗證回呼期間若資料庫暫時不可用，這裡直接忽略。
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (!session.user) return session;
      session.user.id = token.app_user_id ?? "";
      session.user.user_metadata = token.user_metadata;
      return session;
    },
  },
});
