alter table public.watchlist_tv_states
  add column if not exists last_known_status text;
