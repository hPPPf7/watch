create table if not exists public.watch_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id text not null,
  media_type text not null check (media_type in ('movie', 'tv')),
  tmdb_id integer not null,
  season_number integer,
  episode_number integer,
  watched_at date not null,
  created_at timestamptz not null default now()
);

create unique index if not exists watch_history_unique
  on public.watch_history (user_id, project_id, media_type, tmdb_id, season_number, episode_number);

create index if not exists watch_history_user_project
  on public.watch_history (user_id, project_id, media_type, tmdb_id);

alter table public.watch_history enable row level security;

create policy "Watch history is self readable"
on public.watch_history
for select
using (auth.uid() = user_id);

create policy "Watch history is self insertable"
on public.watch_history
for insert
with check (auth.uid() = user_id);

create policy "Watch history is self updatable"
on public.watch_history
for update
using (auth.uid() = user_id);

create policy "Watch history is self deletable"
on public.watch_history
for delete
using (auth.uid() = user_id);

create or replace function public.prevent_watchlist_delete_with_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.watch_history
    where user_id = old.user_id
      and project_id = old.project_id
      and media_type = old.media_type
      and tmdb_id = old.tmdb_id
  ) then
    raise exception 'watch_history_exists';
  end if;
  return old;
end;
$$;

drop trigger if exists watchlist_delete_guard on public.watchlist_items;
create trigger watchlist_delete_guard
before delete on public.watchlist_items
for each row execute function public.prevent_watchlist_delete_with_history();
