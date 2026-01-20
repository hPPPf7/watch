create or replace function public.get_watch_history_participants_bulk(
  target_project text,
  target_media text,
  target_tmdb_ids integer[],
  target_season integer,
  target_episode integer
)
returns table(
  tmdb_id integer,
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
  with owner_ids as (
    select distinct whs.tmdb_id, whs.owner_id
    from public.watch_history_shares whs
    where whs.project_id = target_project
      and whs.media_type = target_media
      and whs.tmdb_id = any(target_tmdb_ids)
      and coalesce(whs.season_number, 0) = coalesce(target_season, 0)
      and coalesce(whs.episode_number, 0) = coalesce(target_episode, 0)
      and (whs.owner_id = auth.uid() or whs.target_user_id = auth.uid())
  ),
  participants as (
    select o.tmdb_id, o.owner_id as participant_id, true as is_owner
    from owner_ids o
    union
    select whs.tmdb_id, whs.target_user_id as participant_id, false as is_owner
    from public.watch_history_shares whs
    join owner_ids o
      on o.tmdb_id = whs.tmdb_id
     and o.owner_id = whs.owner_id
    where whs.project_id = target_project
      and whs.media_type = target_media
      and whs.tmdb_id = any(target_tmdb_ids)
      and coalesce(whs.season_number, 0) = coalesce(target_season, 0)
      and coalesce(whs.episode_number, 0) = coalesce(target_episode, 0)
  )
  select
    p.tmdb_id,
    f.friend_id,
    f.friend_nickname,
    p.is_owner
  from participants p
  join public.friends f
    on f.user_id = auth.uid()
   and f.project_id = target_project
   and f.friend_id = p.participant_id;
end;
$$;

grant execute on function public.get_watch_history_participants_bulk(
  text,
  text,
  integer[],
  integer,
  integer
) to authenticated;
