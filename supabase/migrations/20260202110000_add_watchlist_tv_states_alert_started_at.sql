alter table public.watchlist_tv_states
  add column if not exists alert_started_at timestamptz;
