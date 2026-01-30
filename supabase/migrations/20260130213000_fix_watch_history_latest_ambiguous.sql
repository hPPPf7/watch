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
  watch_count integer,
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
  with all_records as (
    select wh.tmdb_id, wh.watched_at, wh.user_id as owner_id
    from public.watch_history wh
    where wh.user_id = auth.uid()
      and wh.project_id = target_project
      and wh.media_type = target_media
      and wh.tmdb_id = any(target_tmdb_ids)
      and coalesce(wh.season_number, 0) = coalesce(target_season, 0)
      and coalesce(wh.episode_number, 0) = coalesce(target_episode, 0)
    union
    select whs.tmdb_id, whs.watched_at, whs.owner_id
    from public.watch_history_shares whs
    where whs.target_user_id = auth.uid()
      and whs.project_id = target_project
      and whs.media_type = target_media
      and whs.tmdb_id = any(target_tmdb_ids)
      and coalesce(whs.season_number, 0) = coalesce(target_season, 0)
      and coalesce(whs.episode_number, 0) = coalesce(target_episode, 0)
  ),
  counts as (
    select distinct_records.tmdb_id, count(*)::integer as watch_count
    from (
      select distinct
        all_records.tmdb_id,
        all_records.owner_id,
        all_records.watched_at
      from all_records
    ) as distinct_records
    group by distinct_records.tmdb_id
  ),
  own_latest as (
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
    coalesce(cnt.watch_count, 0) as watch_count,
    f.friend_id,
    f.friend_nickname,
    p.is_owner
  from chosen c
  left join counts cnt
    on cnt.tmdb_id = c.tmdb_id
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
