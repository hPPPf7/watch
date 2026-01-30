drop function if exists public.sync_watch_history_shares_with_conflicts(
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
);

create function public.sync_watch_history_shares_with_conflicts(
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
    )
    or exists (
      select 1
      from public.watch_history_shares whs
      where whs.target_user_id = friend_id
        and whs.project_id = target_project
        and whs.media_type = target_media
        and whs.tmdb_id = target_tmdb_id
        and coalesce(whs.season_number, 0) = coalesce(target_season, 0)
        and coalesce(whs.episode_number, 0) = coalesce(target_episode, 0)
        and whs.watched_at = target_watched_at
        and whs.owner_id <> auth.uid()
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

drop function if exists public.get_watch_history_records(
  text,
  text,
  integer,
  integer,
  integer
);

create function public.get_watch_history_records(
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
  is_owner boolean,
  is_conflict boolean
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
    select r.watched_at, r.owner_id, r.owner_id as participant_id, true as is_owner, false as is_conflict
    from records r
    union
    select r.watched_at, r.owner_id, whs.target_user_id as participant_id, false as is_owner, false as is_conflict
    from records r
    join public.watch_history_shares whs
      on whs.project_id = target_project
     and whs.media_type = target_media
     and whs.tmdb_id = target_tmdb_id
     and coalesce(whs.season_number, 0) = coalesce(target_season, 0)
     and coalesce(whs.episode_number, 0) = coalesce(target_episode, 0)
     and whs.owner_id = r.owner_id
     and whs.watched_at = r.watched_at
  ),
  conflict_participants as (
    select r.watched_at, r.owner_id, c.owner_id as participant_id, false as is_owner, true as is_conflict
    from records r
    join public.watch_history_conflicts c
      on c.target_user_id = auth.uid()
     and c.project_id = target_project
     and c.media_type = target_media
     and c.tmdb_id = target_tmdb_id
     and coalesce(c.season_number, 0) = coalesce(target_season, 0)
     and coalesce(c.episode_number, 0) = coalesce(target_episode, 0)
     and c.watched_at = r.watched_at
     and c.status = 'pending'
  ),
  all_participants as (
    select * from participants
    union all
    select * from conflict_participants
  )
  select
    r.watched_at,
    r.owner_id,
    f.friend_id,
    f.friend_nickname,
    p.is_owner,
    p.is_conflict
  from records r
  left join all_participants p
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
  watch_count integer,
  friend_id uuid,
  friend_nickname text,
  is_owner boolean,
  is_conflict boolean
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
  counts as (
    select
      all_records.tmdb_id as tmdb_id,
      count(*)::int as watch_count
    from all_records
    group by all_records.tmdb_id
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
    select l.tmdb_id, l.watched_at, l.owner_id, l.owner_id as participant_id, true as is_owner, false as is_conflict
    from latest l
    union
    select l.tmdb_id, l.watched_at, l.owner_id, whs.target_user_id as participant_id, false as is_owner, false as is_conflict
    from latest l
    join public.watch_history_shares whs
      on whs.project_id = target_project
     and whs.media_type = target_media
     and whs.tmdb_id = l.tmdb_id
     and coalesce(whs.season_number, 0) = coalesce(target_season, 0)
     and coalesce(whs.episode_number, 0) = coalesce(target_episode, 0)
     and whs.owner_id = l.owner_id
     and whs.watched_at = l.watched_at
  ),
  conflict_participants as (
    select l.tmdb_id, l.watched_at, l.owner_id, c.owner_id as participant_id, false as is_owner, true as is_conflict
    from latest l
    join public.watch_history_conflicts c
      on c.target_user_id = auth.uid()
     and c.project_id = target_project
     and c.media_type = target_media
     and c.tmdb_id = l.tmdb_id
     and coalesce(c.season_number, 0) = coalesce(target_season, 0)
     and coalesce(c.episode_number, 0) = coalesce(target_episode, 0)
     and c.watched_at = l.watched_at
     and c.status = 'pending'
  ),
  all_participants as (
    select * from participants
    union all
    select * from conflict_participants
  )
  select
    l.tmdb_id,
    l.watched_at,
    l.owner_id,
    coalesce(c.watch_count, 1) as watch_count,
    f.friend_id,
    f.friend_nickname,
    p.is_owner,
    p.is_conflict
  from latest l
  left join counts c
    on c.tmdb_id = l.tmdb_id
  left join all_participants p
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

grant execute on function public.get_watch_history_latest_participants_bulk(
  text,
  text,
  integer[],
  integer,
  integer
) to authenticated;
