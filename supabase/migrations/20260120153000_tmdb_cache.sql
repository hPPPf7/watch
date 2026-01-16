create table if not exists public.tmdb_cache (
  cache_key text not null,
  cache_date date not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (cache_key, cache_date)
);

alter table public.tmdb_cache enable row level security;
