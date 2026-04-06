import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  publishWatchUpdateEvent,
  type WatchUpdateEvent,
} from "@/server/realtime/watchEventBus";
import { runDeferredPublish } from "@/server/realtime/deferredPublish";
import { tmdbCache, watchlistItems } from "@/server/db/schema";

type WatchUpdateRecord = {
  reason: string;
  at: number;
  nonce: string;
};

type WatchlistRevisionRecord = {
  revision: string;
  at: number;
};

export type WatchlistRevisionScope = {
  mediaType: "movie" | "tv";
  isAnime: boolean;
};

type WatchUpdateTarget =
  | string
  | {
      userId: string;
      revisionScopes?: WatchlistRevisionScope[];
    };

type WatchlistScopedTargetInput = {
  userIds: string[];
  mediaType: "movie" | "tv";
  tmdbId: number;
};

const WATCH_UPDATE_TTL_MS = 24 * 60 * 60 * 1000;
const watchUpdateKey = (userId: string) => `watch:updates:${userId}`;
const watchlistRevisionKey = (
  userId: string,
  mediaType: "movie" | "tv",
  isAnime: boolean,
) => `watch:revision:${userId}:${mediaType}:${isAnime ? 1 : 0}`;

function isWatchUpdateRecord(value: unknown): value is WatchUpdateRecord {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.reason === "string" &&
    typeof obj.at === "number" &&
    typeof obj.nonce === "string"
  );
}

function isWatchlistRevisionRecord(value: unknown): value is WatchlistRevisionRecord {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.revision === "string" && typeof obj.at === "number";
}

export async function readLatestWatchUpdate(userId: string) {
  const db = getDb();
  const rows = await db
    .select({
      payload: tmdbCache.payload,
      expiresAt: tmdbCache.expiresAt,
    })
    .from(tmdbCache)
    .where(eq(tmdbCache.key, watchUpdateKey(userId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const expiresAt = new Date(row.expiresAt).getTime();
  if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) return null;
  return isWatchUpdateRecord(row.payload) ? row.payload : null;
}

export async function readWatchlistRevision(
  userId: string,
  mediaType: "movie" | "tv",
  isAnime: boolean,
) {
  const db = getDb();
  const rows = await db
    .select({
      payload: tmdbCache.payload,
      expiresAt: tmdbCache.expiresAt,
    })
    .from(tmdbCache)
    .where(eq(tmdbCache.key, watchlistRevisionKey(userId, mediaType, isAnime)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const expiresAt = new Date(row.expiresAt).getTime();
  if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) return null;
  return isWatchlistRevisionRecord(row.payload) ? row.payload.revision : null;
}

export async function publishWatchUpdates(userIds: string[], reason: string) {
  return publishScopedWatchUpdates(userIds, reason);
}

export async function resolveWatchlistScopedTargets(
  input: WatchlistScopedTargetInput,
): Promise<WatchUpdateTarget[]> {
  const { userIds, mediaType, tmdbId } = input;
  const normalizedUserIds = Array.from(new Set(userIds.filter(Boolean)));
  if (normalizedUserIds.length === 0) return [];

  const db = getDb();
  const rows = await db
    .select({
      userId: watchlistItems.userId,
      isAnime: watchlistItems.isAnime,
    })
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.mediaType, mediaType),
        eq(watchlistItems.tmdbId, tmdbId),
        inArray(watchlistItems.userId, normalizedUserIds),
      ),
    );

  const scopesByUser = rows.reduce<Map<string, WatchlistRevisionScope[]>>(
    (map, row) => {
      const existing = map.get(row.userId) ?? [];
      const scope = { mediaType, isAnime: row.isAnime === 1 };
      if (
        !existing.some(
          (item) =>
            item.mediaType === scope.mediaType && item.isAnime === scope.isAnime,
        )
      ) {
        existing.push(scope);
      }
      map.set(row.userId, existing);
      return map;
    },
    new Map<string, WatchlistRevisionScope[]>(),
  );

  return normalizedUserIds.map((userId) => {
    const revisionScopes = scopesByUser.get(userId) ?? [];
    return revisionScopes.length > 0 ? { userId, revisionScopes } : userId;
  });
}

export async function publishScopedWatchUpdates(
  targets: WatchUpdateTarget[],
  reason: string,
) {
  const normalized = targets.reduce<
    Array<{ userId: string; revisionScopes: WatchlistRevisionScope[] }>
  >((acc, target) => {
    if (typeof target === "string") {
      if (target) {
        acc.push({ userId: target, revisionScopes: [] });
      }
      return acc;
    }
    if (target.userId) {
      acc.push({
        userId: target.userId,
        revisionScopes: target.revisionScopes ?? [],
      });
    }
    return acc;
  }, []);
  if (normalized.length === 0) return;

  const mergedTargets = Array.from(
    normalized.reduce((map, target) => {
      const existing = map.get(target.userId) ?? [];
      const mergedScopes = [...existing, ...target.revisionScopes].reduce<
        WatchlistRevisionScope[]
      >((scopes, scope) => {
        if (
          scopes.some(
            (item) =>
              item.mediaType === scope.mediaType && item.isAnime === scope.isAnime,
          )
        ) {
          return scopes;
        }
        scopes.push(scope);
        return scopes;
      }, []);
      map.set(target.userId, mergedScopes);
      return map;
    }, new Map<string, WatchlistRevisionScope[]>())
  ).map(([userId, revisionScopes]) => ({ userId, revisionScopes }));

  try {
    const db = getDb();
    const now = new Date();
    const at = now.getTime();
    const expiresAt = new Date(at + WATCH_UPDATE_TTL_MS);
    const publishedEvents: WatchUpdateEvent[] = [];
    await Promise.all(
      mergedTargets.flatMap(({ userId, revisionScopes }) => {
        const nonce = `${at}:${Math.random().toString(36).slice(2)}`;
        const payload: WatchUpdateRecord = {
          reason,
          at,
          nonce,
        };
        publishedEvents.push({ userId, ...payload });
        const revisionPayload: WatchlistRevisionRecord = {
          revision: `${at}:${nonce}`,
          at,
        };
        const keys = [
          watchUpdateKey(userId),
          ...revisionScopes.map((scope) =>
            watchlistRevisionKey(userId, scope.mediaType, scope.isAnime),
          ),
        ];
        return keys.map((key) =>
          db
            .insert(tmdbCache)
            .values({
              key,
              payload: key === watchUpdateKey(userId) ? payload : revisionPayload,
              expiresAt,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: tmdbCache.key,
              set: {
                payload: key === watchUpdateKey(userId) ? payload : revisionPayload,
                expiresAt,
                updatedAt: now,
              },
            })
        );
      })
    );
    runDeferredPublish(
      async () => {
        await Promise.all(
          publishedEvents.map((event) => publishWatchUpdateEvent(event)),
        );
      },
      (error) => {
        console.warn("publish watch update event failed", { reason, error });
      },
    );
  } catch (error) {
    console.warn("publish watch update failed", { reason, error });
  }
}
