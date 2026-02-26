import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  nickname: text("nickname"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    projectId: text("project_id").notNull(),
    mediaType: varchar("media_type", { length: 16 }).notNull(),
    tmdbId: integer("tmdb_id").notNull(),
    isAnime: integer("is_anime").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    watchlistUnique: uniqueIndex("watchlist_items_unique_key").on(
      table.userId,
      table.projectId,
      table.mediaType,
      table.tmdbId,
      table.isAnime
    ),
  })
);

export const watchHistory = pgTable("watch_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  projectId: text("project_id").notNull(),
  mediaType: varchar("media_type", { length: 16 }).notNull(),
  tmdbId: integer("tmdb_id").notNull(),
  seasonNumber: integer("season_number"),
  episodeNumber: integer("episode_number"),
  watchedAt: timestamp("watched_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const watchHistoryShares = pgTable("watch_history_shares", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: text("project_id").notNull(),
  ownerId: uuid("owner_id").notNull(),
  targetUserId: uuid("target_user_id").notNull(),
  watchHistoryId: uuid("watch_history_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const friends = pgTable("friends", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: text("project_id").notNull(),
  userId: uuid("user_id").notNull(),
  friendId: uuid("friend_id").notNull(),
  friendNickname: text("friend_nickname"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const friendRequests = pgTable("friend_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: text("project_id").notNull(),
  fromUserId: uuid("from_user_id").notNull(),
  toUserId: uuid("to_user_id").notNull(),
  fromNickname: text("from_nickname"),
  status: varchar("status", { length: 16 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const watchlistTvStates = pgTable("watchlist_tv_states", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: text("project_id").notNull(),
  userId: uuid("user_id").notNull(),
  tmdbId: integer("tmdb_id").notNull(),
  lastProgress: varchar("last_progress", { length: 32 }),
  lastTotalAired: integer("last_total_aired"),
  lastWatchedCount: integer("last_watched_count"),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const tmdbCache = pgTable(
  "tmdb_cache",
  {
    key: text("key").primaryKey(),
    payload: jsonb("payload").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    expiresAtIdx: index("tmdb_cache_expires_at_idx").on(table.expiresAt),
  }),
);

export const authUserMap = pgTable(
  "auth_user_map",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    userId: uuid("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    providerAccountUnique: uniqueIndex("auth_user_map_provider_unique").on(
      table.provider,
      table.providerAccountId
    ),
  })
);
