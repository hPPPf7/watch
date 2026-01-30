drop function if exists public.get_watch_history_latest_participants_bulk(
  text,
  text,
  integer[],
  integer,
  integer
);

create function public.get_watch_history_latest_participants_bulk(
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
  with own_records as (
    select
      wh.tmdb_id as tmdb_id,
      wh.watched_at as watched_at,
      auth.uid() as owner_id
    from public.watch_history wh
    where wh.user_id = auth.uid()
      and wh.project_id = target_project
      and wh.media_type = target_media
      and wh.tmdb_id = any(target_tmdb_ids)
      and coalesce(wh.season_number, 0) = coalesce(target_season, 0)
      and coalesce(wh.episode_number, 0) = coalesce(target_episode, 0)
  ),
  shared_records as (
    select
      whs.tmdb_id as tmdb_id,
      whs.watched_at as watched_at,
      whs.owner_id as owner_id
    from public.watch_history_shares whs
    where whs.target_user_id = auth.uid()
      and whs.project_id = target_project
      and whs.media_type = target_media
      and whs.tmdb_id = any(target_tmdb_ids)
      and coalesce(whs.season_number, 0) = coalesce(target_season, 0)
      and coalesce(whs.episode_number, 0) = coalesce(target_episode, 0)
  ),
  all_records as (
    select * from own_records
    union all
    select * from shared_records
  ),
  latest as (
    select distinct on (all_records.tmdb_id)
      all_records.tmdb_id as tmdb_id,
      all_records.watched_at as watched_at,
      all_records.owner_id as owner_id
    from all_records
    order by all_records.tmdb_id, all_records.watched_at desc
  ),
  participants as (
    select l.tmdb_id, l.watched_at, l.owner_id, l.owner_id as participant_id, true as is_owner
    from latest l
    union
    select l.tmdb_id, l.watched_at, l.owner_id, whs.target_user_id as participant_id, false as is_owner
    from latest l
    join public.watch_history_shares whs
      on whs.project_id = target_project
     and whs.media_type = target_media
     and whs.tmdb_id = l.tmdb_id
     and coalesce(whs.season_number, 0) = coalesce(target_season, 0)
     and coalesce(whs.episode_number, 0) = coalesce(target_episode, 0)
     and whs.owner_id = l.owner_id
     and whs.watched_at = l.watched_at
  )
  select
    l.tmdb_id,
    l.watched_at,
    l.owner_id,
    f.friend_id,
    f.friend_nickname,
    p.is_owner
  from latest l
  left join participants p
    on p.tmdb_id = l.tmdb_id
   and p.owner_id = l.owner_id
   and p.watched_at = l.watched_at
  left join public.friends f
    on f.user_id = auth.uid()
   and f.project_id = target_project
   and f.friend_id = p.participant_id
  order by l.tmdb_id;
end;
$$;
