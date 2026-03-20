ALTER TABLE "watchlist_tv_states"
ADD COLUMN "alert_active" boolean DEFAULT false NOT NULL;

ALTER TABLE "watchlist_tv_states"
ADD COLUMN "alert_notified_watch_count" integer DEFAULT 0 NOT NULL;

ALTER TABLE "watchlist_tv_states"
ADD COLUMN "alert_started_at" timestamp with time zone;
