ALTER TABLE "watchlist_tv_states"
ADD COLUMN "first_release_alert_state" varchar(16);

ALTER TABLE "watchlist_tv_states"
ADD COLUMN "alert_generation" varchar(128);

ALTER TABLE "watchlist_tv_states"
ADD COLUMN "alert_acknowledged_generation" varchar(128);

ALTER TABLE "watchlist_tv_states"
ADD COLUMN "tmdb_metadata_fetched_at" timestamp with time zone;
