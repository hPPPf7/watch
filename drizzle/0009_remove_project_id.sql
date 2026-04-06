DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "watchlist_items"
    GROUP BY "user_id", "media_type", "tmdb_id", "is_anime"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot drop project_id from watchlist_items: duplicate rows exist across projects.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "watch_history"
    GROUP BY
      "user_id",
      "media_type",
      "tmdb_id",
      "season_number",
      "episode_number",
      "watched_at"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot drop project_id from watch_history: duplicate rows exist across projects.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "watch_history_shares"
    GROUP BY "owner_id", "target_user_id", "watch_history_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot drop project_id from watch_history_shares: duplicate rows exist across projects.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "friends"
    GROUP BY "user_id", "friend_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot drop project_id from friends: duplicate rows exist across projects.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "friend_requests"
    GROUP BY "from_user_id", "to_user_id", "status"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot drop project_id from friend_requests: duplicate rows exist across projects.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "watchlist_tv_states"
    GROUP BY "user_id", "tmdb_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot drop project_id from watchlist_tv_states: duplicate rows exist across projects.';
  END IF;
END $$;

DROP INDEX IF EXISTS "watchlist_items_unique_key";
DROP INDEX IF EXISTS "watch_history_unique_key";
DROP INDEX IF EXISTS "watch_history_shares_unique_key";
DROP INDEX IF EXISTS "friends_unique_key";
DROP INDEX IF EXISTS "friend_requests_unique_key";
DROP INDEX IF EXISTS "watchlist_tv_states_unique_key";

ALTER TABLE "watchlist_items" DROP COLUMN "project_id";
ALTER TABLE "watch_history" DROP COLUMN "project_id";
ALTER TABLE "watch_history_shares" DROP COLUMN "project_id";
ALTER TABLE "friends" DROP COLUMN "project_id";
ALTER TABLE "friend_requests" DROP COLUMN "project_id";
ALTER TABLE "watchlist_tv_states" DROP COLUMN "project_id";

CREATE UNIQUE INDEX "watchlist_items_unique_key"
  ON "watchlist_items" USING btree ("user_id", "media_type", "tmdb_id", "is_anime");

CREATE UNIQUE INDEX "watch_history_unique_key"
  ON "watch_history" USING btree (
    "user_id",
    "media_type",
    "tmdb_id",
    "season_number",
    "episode_number",
    "watched_at"
  );

CREATE UNIQUE INDEX "watch_history_shares_unique_key"
  ON "watch_history_shares" USING btree ("owner_id", "target_user_id", "watch_history_id");

CREATE UNIQUE INDEX "friends_unique_key"
  ON "friends" USING btree ("user_id", "friend_id");

CREATE UNIQUE INDEX "friend_requests_unique_key"
  ON "friend_requests" USING btree ("from_user_id", "to_user_id", "status");

CREATE UNIQUE INDEX "watchlist_tv_states_unique_key"
  ON "watchlist_tv_states" USING btree ("user_id", "tmdb_id");
