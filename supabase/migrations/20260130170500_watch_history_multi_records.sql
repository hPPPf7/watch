drop index if exists public.watch_history_unique;
create unique index if not exists watch_history_unique
  on public.watch_history (
    user_id,
    project_id,
    media_type,
    tmdb_id,
    season_number,
    episode_number,
    watched_at
  );

drop index if exists public.watch_history_shares_unique;
create unique index if not exists watch_history_shares_unique
  on public.watch_history_shares (
    owner_id,
    target_user_id,
    project_id,
    media_type,
    tmdb_id,
    season_number,
    episode_number,
    watched_at
  );

create or replace function public.get_watch_history_records(
  target_project text,
  target_media text,
  target_tmdb_id integer,
  target_season integer,
  target_episode integer
)
returns table(
  watched_at date,
  owner_id uuid,
  friend_id uuid,
  friend_nickname text,
  is_owner boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if target_media not in ('movie', 'tv') then
    raise exception 'invalid_media_type';
  end if;

  return query
  with own_records as (
    select wh.watched_at, auth.uid() as owner_id
    from public.watch_history wh
    where wh.user_id = auth.uid()
      and wh.project_id = target_project
      and wh.media_type = target_media
      and wh.tmdb_id = target_tmdb_id
      and coalesce(wh.season_number, 0) = coalesce(target_season, 0)
      and coalesce(wh.episode_number, 0) = coalesce(target_episode, 0)
  ),
  shared_records as (
    select distinct whs.watched_at, whs.owner_id
    from public.watch_history_shares whs
    where whs.project_id = target_project
      and whs.media_type = target_media
      and whs.tmdb_id = target_tmdb_id
      and coalesce(whs.season_number, 0) = coalesce(target_season, 0)
      and coalesce(whs.episode_number, 0) = coalesce(target_episode, 0)
      and (whs.owner_id = auth.uid() or whs.target_user_id = auth.uid())
  ),
  records as (
    select * from own_records
    union
    select * from shared_records
  ),
  participants as (
    select r.watched_at, r.owner_id, r.owner_id as participant_id, true as is_owner
    from records r
    union
    select r.watched_at, r.owner_id, whs.target_user_id as participant_id, false as is_owner
    from records r
    join public.watch_history_shares whs
      on whs.project_id = target_project
     and whs.media_type = target_media
     and whs.tmdb_id = target_tmdb_id
     and coalesce(whs.season_number, 0) = coalesce(target_season, 0)
     and coalesce(whs.episode_number, 0) = coalesce(target_episode, 0)
     and whs.owner_id = r.owner_id
     and whs.watched_at = r.watched_at
  )
  select
    r.watched_at,
    r.owner_id,
    f.friend_id,
    f.friend_nickname,
    p.is_owner
  from records r
  left join participants p
    on p.owner_id = r.owner_id
   and p.watched_at = r.watched_at
  left join public.friends f
    on f.user_id = auth.uid()
   and f.project_id = target_project
   and f.friend_id = p.participant_id
  order by r.watched_at desc;
end;
$$;

grant execute on function public.get_watch_history_records(
  text,
  text,
  integer,
  integer,
  integer
) to authenticated;

create or replace function public.get_watch_history_latest_participants_bulk(
  target_project text,
  target_media text,
  target_tmdb_ids integer[],
  target_season integer,
  target_episode integer
)
returns table(
  tmdb_id integer,
  watched_at date,
  owner_id uuid,
  friend_id uuid,
  friend_nickname text,
  is_owner boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if target_media not in ('movie', 'tv') then
    raise exception 'invalid_media_type';
  end if;

  if target_tmdb_ids is null or array_length(target_tmdb_ids, 1) is null then
    return;
  end if;

  return query
  with own_latest as (
    select wh.tmdb_id, max(wh.watched_at) as watched_at
    from public.watch_history wh
    where wh.user_id = auth.uid()
      and wh.project_id = target_project
      and wh.media_type = target_media
      and wh.tmdb_id = any(target_tmdb_ids)
      and coalesce(wh.season_number, 0) = coalesce(target_season, 0)
      and coalesce(wh.episode_number, 0) = coalesce(target_episode, 0)
    group by wh.tmdb_id
  ),
  shared_latest as (
    select distinct on (whs.tmdb_id)
      whs.tmdb_id,
      whs.watched_at,
      whs.owner_id
    from public.watch_history_shares whs
    where whs.target_user_id = auth.uid()
      and whs.project_id = target_project
      and whs.media_type = target_media
      and whs.tmdb_id = any(target_tmdb_ids)
      and coalesce(whs.season_number, 0) = coalesce(target_season, 0)
      and coalesce(whs.episode_number, 0) = coalesce(target_episode, 0)
    order by whs.tmdb_id, whs.watched_at desc, whs.created_at desc
  ),
  chosen as (
    select o.tmdb_id, o.watched_at, auth.uid() as owner_id
    from own_latest o
    union
    select s.tmdb_id, s.watched_at, s.owner_id
    from shared_latest s
    where not exists (
      select 1 from own_latest o where o.tmdb_id = s.tmdb_id
    )
  ),
  participants as (
    select c.tmdb_id, c.watched_at, c.owner_id, c.owner_id as participant_id, true as is_owner
    from chosen c
    union
    select c.tmdb_id, c.watched_at, c.owner_id, whs.target_user_id as participant_id, false as is_owner
    from chosen c
    join public.watch_history_shares whs
      on whs.project_id = target_project
     and whs.media_type = target_media
     and whs.tmdb_id = c.tmdb_id
     and coalesce(whs.season_number, 0) = coalesce(target_season, 0)
     and coalesce(whs.episode_number, 0) = coalesce(target_episode, 0)
     and whs.owner_id = c.owner_id
     and whs.watched_at = c.watched_at
  )
  select
    c.tmdb_id,
    c.watched_at,
    c.owner_id,
    f.friend_id,
    f.friend_nickname,
    p.is_owner
  from chosen c
  left join participants p
    on p.tmdb_id = c.tmdb_id
   and p.owner_id = c.owner_id
   and p.watched_at = c.watched_at
  left join public.friends f
    on f.user_id = auth.uid()
   and f.project_id = target_project
   and f.friend_id = p.participant_id
  order by c.tmdb_id;
end;
$$;

grant execute on function public.get_watch_history_latest_participants_bulk(
  text,
  text,
  integer[],
  integer,
  integer
) to authenticated;
