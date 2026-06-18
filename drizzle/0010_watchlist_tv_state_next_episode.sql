ALTER TABLE "watchlist_tv_states"
ADD COLUMN "next_episode_season" integer;

ALTER TABLE "watchlist_tv_states"
ADD COLUMN "next_episode_number" integer;

ALTER TABLE "watchlist_tv_states"
ADD COLUMN "next_episode_name" text;

ALTER TABLE "watchlist_tv_states"
ADD COLUMN "next_episode_air_date" text;

ALTER TABLE "watchlist_tv_states"
ADD COLUMN "last_watched_season" integer;

ALTER TABLE "watchlist_tv_states"
ADD COLUMN "last_watched_episode" integer;
