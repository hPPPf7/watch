alter table public.watchlist_tv_states
  add column if not exists last_checked_at timestamptz;
