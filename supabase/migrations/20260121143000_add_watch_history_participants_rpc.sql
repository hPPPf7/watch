create or replace function public.get_watch_history_participants(
  target_project text,
  target_media text,
  target_tmdb_id integer,
  target_season integer,
  target_episode integer
)
returns table(
  friend_id uuid,
  friend_nickname text,
  is_owner boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_ids uuid[];
  participant_ids uuid[];
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if target_media not in ('movie', 'tv') then
    raise exception 'invalid_media_type';
  end if;

  select array_agg(distinct owner_id)
  into owner_ids
  from public.watch_history_shares
  where project_id = target_project
    and media_type = target_media
    and tmdb_id = target_tmdb_id
    and coalesce(season_number, 0) = coalesce(target_season, 0)
    and coalesce(episode_number, 0) = coalesce(target_episode, 0)
    and (owner_id = auth.uid() or target_user_id = auth.uid());

  if owner_ids is null or array_length(owner_ids, 1) is null then
    return;
  end if;

  select array_agg(distinct participant_id)
  into participant_ids
  from (
    select owner_id as participant_id
    from public.watch_history_shares
    where project_id = target_project
      and media_type = target_media
      and tmdb_id = target_tmdb_id
      and coalesce(season_number, 0) = coalesce(target_season, 0)
      and coalesce(episode_number, 0) = coalesce(target_episode, 0)
      and owner_id = any(owner_ids)
    union
    select target_user_id as participant_id
    from public.watch_history_shares
    where project_id = target_project
      and media_type = target_media
      and tmdb_id = target_tmdb_id
      and coalesce(season_number, 0) = coalesce(target_season, 0)
      and coalesce(episode_number, 0) = coalesce(target_episode, 0)
      and owner_id = any(owner_ids)
  ) participants;

  return query
  select
    f.friend_id,
    f.friend_nickname,
    f.friend_id = any(owner_ids) as is_owner
  from public.friends f
  where f.user_id = auth.uid()
    and f.project_id = target_project
    and f.friend_id = any(participant_ids);
end;
$$;

grant execute on function public.get_watch_history_participants(
  text,
  text,
  integer,
  integer,
  integer
) to authenticated;
