alter table public.watchlist_items
  add column if not exists release_date text;

create or replace function public.sync_watchlist_items_for_friends(
  target_project text,
  target_media text,
  target_tmdb_id integer,
  target_title text,
  target_year text,
  target_release_date text,
  target_poster_path text,
  target_is_anime boolean,
  target_friend_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  valid_friend_ids uuid[];
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if target_friend_ids is null or array_length(target_friend_ids, 1) is null then
    return;
  end if;

  if target_media not in ('movie', 'tv') then
    raise exception 'invalid_media_type';
  end if;

  select array_agg(friend_id)
  into valid_friend_ids
  from public.friends
  where user_id = auth.uid()
    and project_id = target_project
    and friend_id = any(target_friend_ids);

  if valid_friend_ids is null or array_length(valid_friend_ids, 1) is null then
    return;
  end if;

  insert into public.watchlist_items (
    user_id,
    project_id,
    media_type,
    tmdb_id,
    title,
    year,
    release_date,
    poster_path,
    is_anime
  )
  select
    unnest(valid_friend_ids),
    target_project,
    target_media,
    target_tmdb_id,
    target_title,
    target_year,
    target_release_date,
    target_poster_path,
    target_is_anime
  on conflict (user_id, project_id, media_type, tmdb_id)
  do update set
    title = excluded.title,
    year = excluded.year,
    release_date = excluded.release_date,
    poster_path = excluded.poster_path,
    is_anime = excluded.is_anime;
end;
$$;

grant execute on function public.sync_watchlist_items_for_friends(
  text,
  text,
  integer,
  text,
  text,
  text,
  text,
  boolean,
  uuid[]
) to authenticated;
