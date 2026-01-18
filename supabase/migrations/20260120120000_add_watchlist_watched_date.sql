alter table public.watchlist_items
  add column if not exists watched_date date;
