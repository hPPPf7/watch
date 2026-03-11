import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb, runInTransaction } from "@/server/db/client";
import { friends, watchlistItems } from "@/server/db/schema";
import { publishScopedWatchUpdates } from "@/server/realtime/watchUpdates";
import { isUuidString } from "@/lib/uuid";
import { runBestEffortPublish } from "@/server/realtime/safePublish";

type Body = {
  mediaType?: "movie" | "tv";
  tmdbId?: number;
  isAnime?: boolean;
  friendIds?: string[];
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Not signed in" },
      { status: 401 }
    );
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const mediaType = body?.mediaType;
  const tmdbId = body?.tmdbId;
  const isAnime = body?.isAnime ?? false;
  const friendIds = Array.isArray(body?.friendIds) ? body!.friendIds : [];
  const projectId = "watch";

  if (
    (mediaType !== "movie" && mediaType !== "tv") ||
    !isPositiveInteger(tmdbId) ||
    friendIds.some((id) => typeof id !== "string" || !isUuidString(id))
  ) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid payload" },
      { status: 400 }
    );
  }

  if (friendIds.length === 0) {
    return NextResponse.json({ ok: true });
  }

  let db;
  try {
    db = getDb();
  } catch {
    return NextResponse.json(
      { code: "CONFIG_MISSING", message: "DATABASE_URL is required" },
      { status: 500 }
    );
  }

  try {
    const validatedTmdbId = tmdbId;
    const allowedFriendRows = await db
      .select({ friendId: friends.friendId })
      .from(friends)
      .where(
        and(
          eq(friends.projectId, projectId),
          eq(friends.userId, userId),
          inArray(friends.friendId, friendIds)
        )
      );
    const targetFriendIds = allowedFriendRows.map((row) => row.friendId);

    if (targetFriendIds.length === 0) {
      return NextResponse.json({ ok: true });
    }

    const { affectedScopes, didChange } = await runInTransaction(async (tx) => {
      const scopeMap = new Map<string, Set<string>>();
      let changed = false;

      for (const targetUserId of targetFriendIds) {
        const existing = await tx
          .select({ id: watchlistItems.id, isAnime: watchlistItems.isAnime })
          .from(watchlistItems)
          .where(
            and(
              eq(watchlistItems.userId, targetUserId),
              eq(watchlistItems.projectId, projectId),
              eq(watchlistItems.mediaType, mediaType),
              eq(watchlistItems.tmdbId, validatedTmdbId)
            )
          );

        if (existing.length === 0) {
          const inserted = await tx
            .insert(watchlistItems)
            .values({
              userId: targetUserId,
              projectId,
              mediaType,
              tmdbId: validatedTmdbId,
              isAnime: mediaType === "tv" && isAnime ? 1 : 0,
            })
            .onConflictDoNothing()
            .returning({ id: watchlistItems.id });

          if (inserted.length > 0) {
            scopeMap.set(
              targetUserId,
              new Set([
                `${mediaType}:${mediaType === "tv" ? Number(isAnime) : 0}`,
              ])
            );
            changed = true;
          }
          continue;
        }

        if (mediaType !== "tv") {
          continue;
        }

        const nextIsAnime = isAnime ? 1 : 0;
        const previousScopes = Array.from(
          new Set(existing.map((row) => row.isAnime))
        ).map((isAnimeFlag) => ({
          mediaType,
          isAnime: isAnimeFlag === 1,
        }));
        const keepRow =
          existing.find((row) => row.isAnime === nextIsAnime) ?? existing[0];
        const duplicateIds = existing
          .filter((row) => row.id !== keepRow.id)
          .map((row) => row.id);
        const needsUpdate = keepRow.isAnime !== nextIsAnime;

        if (needsUpdate) {
          await tx
            .update(watchlistItems)
            .set({ isAnime: nextIsAnime })
            .where(eq(watchlistItems.id, keepRow.id));
        }

        if (duplicateIds.length > 0) {
          await tx
            .delete(watchlistItems)
            .where(inArray(watchlistItems.id, duplicateIds));
        }

        if (needsUpdate || duplicateIds.length > 0) {
          const scopeSet = scopeMap.get(targetUserId) ?? new Set<string>();
          for (const scope of previousScopes) {
            scopeSet.add(`${scope.mediaType}:${Number(scope.isAnime)}`);
          }
          scopeSet.add(`${mediaType}:${Number(isAnime)}`);
          scopeMap.set(targetUserId, scopeSet);
          changed = true;
        }
      }

      return { affectedScopes: scopeMap, didChange: changed };
    });

    if (didChange) {
      await runBestEffortPublish("detail/history-sync-watchlist", async () => {
        await publishScopedWatchUpdates(
          Array.from(affectedScopes.entries()).map(([targetUserId, scopeSet]) => ({
            userId: targetUserId,
            revisionScopes: Array.from(scopeSet).map((scope) => {
              const [scopeMediaType, scopeAnimeFlag] = scope.split(":");
              return {
                mediaType: scopeMediaType as "movie" | "tv",
                isAnime: scopeAnimeFlag === "1",
              };
            }),
          })),
          "history_sync_watchlist"
        );
      });
    }
  } catch (error) {
    console.error("[detail/history-sync-watchlist] failed", { userId, error });
    return NextResponse.json(
      {
        code: "SYNC_WATCHLIST_FAILED",
        message: "Sync watchlist failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
