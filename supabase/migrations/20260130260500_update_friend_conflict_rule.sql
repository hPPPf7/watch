create or replace function public.get_watch_history_friend_conflicts(
  target_project text,
  target_media text,
  target_tmdb_id integer,
  target_season integer,
  target_episode integer,
  target_watched_at date,
  target_friend_ids uuid[]
)
returns table(friend_id uuid)
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

  if target_friend_ids is null or array_length(target_friend_ids, 1) is null then
    return;
  end if;

  return query
  select distinct candidate.friend_id
  from unnest(target_friend_ids) as candidate(friend_id)
  where exists (
      select 1
      from public.watch_history wh
      where wh.user_id = candidate.friend_id
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
      where whs.target_user_id = candidate.friend_id
        and whs.project_id = target_project
        and whs.media_type = target_media
        and whs.tmdb_id = target_tmdb_id
        and coalesce(whs.season_number, 0) = coalesce(target_season, 0)
        and coalesce(whs.episode_number, 0) = coalesce(target_episode, 0)
        and whs.watched_at = target_watched_at
        and whs.owner_id <> auth.uid()
    );
end;
$$;

grant execute on function public.get_watch_history_friend_conflicts(
  text,
  text,
  integer,
  integer,
  integer,
  date,
  uuid[]
) to authenticated;
