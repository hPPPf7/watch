-- Returns the latest watched_at per tmdb_id for TV media

create or replace function public.get_watch_history_latest_watched_at_bulk(
  target_project text,
  target_media text,
  target_tmdb_ids integer[]
)
returns table(
  tmdb_id integer,
  watched_at date
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if target_media not in ('tv') then
    raise exception 'invalid_media_type';
  end if;

  if target_tmdb_ids is null or array_length(target_tmdb_ids, 1) is null then
    return;
  end if;

  return query
  with all_records as (
    select
      wh.tmdb_id,
      wh.watched_at
    from public.watch_history wh
    where wh.user_id = auth.uid()
      and wh.project_id = target_project
      and wh.media_type = target_media
      and wh.tmdb_id = any(target_tmdb_ids)
      and coalesce(wh.season_number, 0) > 0
      and coalesce(wh.episode_number, 0) > 0
    union all
    select
      whs.tmdb_id,
      whs.watched_at
    from public.watch_history_shares whs
    where whs.target_user_id = auth.uid()
      and whs.project_id = target_project
      and whs.media_type = target_media
      and whs.tmdb_id = any(target_tmdb_ids)
      and coalesce(whs.season_number, 0) > 0
      and coalesce(whs.episode_number, 0) > 0
  )
  select distinct on (all_records.tmdb_id)
    all_records.tmdb_id,
    all_records.watched_at
  from all_records
  order by all_records.tmdb_id,
    all_records.watched_at desc;
end;
$$;

grant execute on function public.get_watch_history_latest_watched_at_bulk(
  text,
  text,
  integer[]
) to authenticated;
