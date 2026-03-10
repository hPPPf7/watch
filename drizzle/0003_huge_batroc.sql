UPDATE "watch_history"
SET
	"season_number" = COALESCE("season_number", 0),
	"episode_number" = COALESCE("episode_number", 0)
WHERE "season_number" IS NULL
	OR "episode_number" IS NULL;--> statement-breakpoint
WITH ranked_watch_history AS (
	SELECT
		"id",
		FIRST_VALUE("id") OVER (
			PARTITION BY "project_id", "user_id", "media_type", "tmdb_id", "season_number", "episode_number", "watched_at"
			ORDER BY "created_at" ASC NULLS LAST, "id" ASC
		) AS "keep_id",
		ROW_NUMBER() OVER (
			PARTITION BY "project_id", "user_id", "media_type", "tmdb_id", "season_number", "episode_number", "watched_at"
			ORDER BY "created_at" ASC NULLS LAST, "id" ASC
		) AS "row_num"
	FROM "watch_history"
), remapped_watch_history_shares AS (
	UPDATE "watch_history_shares" AS "shares"
	SET "watch_history_id" = ranked_watch_history."keep_id"
	FROM ranked_watch_history
	WHERE ranked_watch_history."row_num" > 1
		AND "shares"."watch_history_id" = ranked_watch_history."id"
	RETURNING "shares"."id"
)
DELETE FROM "watch_history"
WHERE "id" IN (
	SELECT "id"
	FROM ranked_watch_history
	WHERE "row_num" > 1
);--> statement-breakpoint
WITH ranked_watch_history_shares AS (
	SELECT
		"id",
		ROW_NUMBER() OVER (
			PARTITION BY "project_id", "owner_id", "target_user_id", "watch_history_id"
			ORDER BY "created_at" ASC NULLS LAST, "id" ASC
		) AS "row_num"
	FROM "watch_history_shares"
)
DELETE FROM "watch_history_shares"
WHERE "id" IN (
	SELECT "id"
	FROM ranked_watch_history_shares
	WHERE "row_num" > 1
);--> statement-breakpoint
WITH ranked_watchlist_tv_states AS (
	SELECT
		"id",
		ROW_NUMBER() OVER (
			PARTITION BY "project_id", "user_id", "tmdb_id"
			ORDER BY "updated_at" DESC NULLS LAST, "created_at" DESC NULLS LAST, "id" DESC
		) AS "row_num"
	FROM "watchlist_tv_states"
)
DELETE FROM "watchlist_tv_states"
WHERE "id" IN (
	SELECT "id"
	FROM ranked_watchlist_tv_states
	WHERE "row_num" > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "watch_history_unique_key" ON "watch_history" USING btree ("project_id","user_id","media_type","tmdb_id","season_number","episode_number","watched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "watch_history_shares_unique_key" ON "watch_history_shares" USING btree ("project_id","owner_id","target_user_id","watch_history_id");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_tv_states_unique_key" ON "watchlist_tv_states" USING btree ("project_id","user_id","tmdb_id");--> statement-breakpoint
ALTER TABLE "watch_history" ALTER COLUMN "season_number" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "watch_history" ALTER COLUMN "season_number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "watch_history" ALTER COLUMN "episode_number" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "watch_history" ALTER COLUMN "episode_number" SET NOT NULL;
