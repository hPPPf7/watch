create table if not exists public.watch_history_conflicts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  target_user_id uuid not null,
  project_id text not null,
  media_type text not null,
  tmdb_id integer not null,
  season_number integer,
  episode_number integer,
  watched_at date not null,
  title text,
  year text,
  poster_path text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create unique index if not exists watch_history_conflicts_unique
  on public.watch_history_conflicts (
    owner_id,
    target_user_id,
    project_id,
    media_type,
    tmdb_id,
    season_number,
    episode_number,
    watched_at
  );

alter table public.watch_history_conflicts enable row level security;

drop policy if exists "Watch history conflicts are readable by target" on public.watch_history_conflicts;
create policy "Watch history conflicts are readable by target"
  on public.watch_history_conflicts
  for select
  using (target_user_id = auth.uid());

drop policy if exists "Watch history conflicts are updatable by target" on public.watch_history_conflicts;
create policy "Watch history conflicts are updatable by target"
  on public.watch_history_conflicts
  for update
  using (target_user_id = auth.uid());

drop policy if exists "Watch history conflicts are deletable by target or owner" on public.watch_history_conflicts;
create policy "Watch history conflicts are deletable by target or owner"
  on public.watch_history_conflicts
  for delete
  using (target_user_id = auth.uid() or owner_id = auth.uid());

create or replace function public.sync_watch_history_shares_with_conflicts(
  target_project text,
  target_media text,
  target_tmdb_id integer,
  target_season integer,
  target_episode integer,
  target_watched_at date,
  target_title text,
  target_year text,
  target_poster_path text,
  target_friend_ids uuid[]
)
returns table(conflict_count integer, share_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  friend_id uuid;
  conflict_count integer := 0;
  share_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if target_media not in ('movie', 'tv') then
    raise exception 'invalid_media_type';
  end if;

  if target_friend_ids is null or array_length(target_friend_ids, 1) is null then
    return query select 0, 0;
    return;
  end if;

  foreach friend_id in array target_friend_ids loop
    if exists (
      select 1
      from public.watch_history wh
      where wh.user_id = friend_id
        and wh.project_id = target_project
        and wh.media_type = target_media
        and wh.tmdb_id = target_tmdb_id
        and coalesce(wh.season_number, 0) = coalesce(target_season, 0)
        and coalesce(wh.episode_number, 0) = coalesce(target_episode, 0)
        and wh.watched_at = target_watched_at
    ) then
      insert into public.watch_history_conflicts (
        owner_id,
        target_user_id,
        project_id,
        media_type,
        tmdb_id,
        season_number,
        episode_number,
        watched_at,
        title,
        year,
        poster_path,
        status
      ) values (
        auth.uid(),
        friend_id,
        target_project,
        target_media,
        target_tmdb_id,
        target_season,
        target_episode,
        target_watched_at,
        target_title,
        target_year,
        target_poster_path,
        'pending'
      )
      on conflict (
        owner_id,
        target_user_id,
        project_id,
        media_type,
        tmdb_id,
        season_number,
        episode_number,
        watched_at
      ) do update set
        status = 'pending',
        title = excluded.title,
        year = excluded.year,
        poster_path = excluded.poster_path,
        created_at = now();
      conflict_count := conflict_count + 1;
    else
      insert into public.watch_history_shares (
        owner_id,
        target_user_id,
        project_id,
        media_type,
        tmdb_id,
        season_number,
        episode_number,
        watched_at
      ) values (
        auth.uid(),
        friend_id,
        target_project,
        target_media,
        target_tmdb_id,
        target_season,
        target_episode,
        target_watched_at
      )
      on conflict do nothing;
      share_count := share_count + 1;
    end if;
  end loop;

  return query select conflict_count, share_count;
end;
$$;

grant execute on function public.sync_watch_history_shares_with_conflicts(
  text,
  text,
  integer,
  integer,
  integer,
  date,
  text,
  text,
  text,
  uuid[]
) to authenticated;

create or replace function public.resolve_watch_history_conflict(
  conflict_id uuid,
  action text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  conflict_record record;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select *
  into conflict_record
  from public.watch_history_conflicts
  where id = conflict_id
    and target_user_id = auth.uid();

  if not found then
    raise exception 'not_found';
  end if;

  if action = 'ignore' then
    update public.watch_history_conflicts
    set status = 'ignored'
    where id = conflict_id;
    return;
  end if;

  if action = 'apply' then
    delete from public.watch_history
    where user_id = auth.uid()
      and project_id = conflict_record.project_id
      and media_type = conflict_record.media_type
      and tmdb_id = conflict_record.tmdb_id
      and coalesce(season_number, 0) = coalesce(conflict_record.season_number, 0)
      and coalesce(episode_number, 0) = coalesce(conflict_record.episode_number, 0)
      and watched_at = conflict_record.watched_at;

    insert into public.watch_history_shares (
      owner_id,
      target_user_id,
      project_id,
      media_type,
      tmdb_id,
      season_number,
      episode_number,
      watched_at
    ) values (
      conflict_record.owner_id,
      auth.uid(),
      conflict_record.project_id,
      conflict_record.media_type,
      conflict_record.tmdb_id,
      conflict_record.season_number,
      conflict_record.episode_number,
      conflict_record.watched_at
    )
    on conflict do nothing;

    delete from public.watch_history_conflicts
    where id = conflict_id;
    return;
  end if;

  raise exception 'invalid_action';
end;
$$;

grant execute on function public.resolve_watch_history_conflict(uuid, text) to authenticated;

create or replace function public.prevent_watch_history_conflict()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.watch_history_shares whs
    where whs.target_user_id = new.user_id
      and whs.project_id = new.project_id
      and whs.media_type = new.media_type
      and whs.tmdb_id = new.tmdb_id
      and coalesce(whs.season_number, 0) = coalesce(new.season_number, 0)
      and coalesce(whs.episode_number, 0) = coalesce(new.episode_number, 0)
      and whs.watched_at = new.watched_at
  ) then
    raise exception 'watch_history_conflict';
  end if;
  return new;
end;
$$;

drop trigger if exists watch_history_conflict_check on public.watch_history;
create trigger watch_history_conflict_check
before insert on public.watch_history
for each row
execute function public.prevent_watch_history_conflict();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'watch_history_conflicts'
  ) then
    alter publication supabase_realtime add table public.watch_history_conflicts;
  end if;
end;
$$;
