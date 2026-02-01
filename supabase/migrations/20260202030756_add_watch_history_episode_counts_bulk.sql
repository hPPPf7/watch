-- Returns watched episode counts per tmdb_id for TV media

create or replace function public.get_watch_history_episode_counts_bulk(
  target_project text,
  target_media text,
  target_tmdb_ids integer[]
)
returns table(
  tmdb_id integer,
  watched_count integer
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
      coalesce(wh.season_number, 0) as season_number,
      coalesce(wh.episode_number, 0) as episode_number
    from public.watch_history wh
    where wh.user_id = auth.uid()
      and wh.project_id = target_project
      and wh.media_type = target_media
      and wh.tmdb_id = any(target_tmdb_ids)
    union all
    select
      whs.tmdb_id,
      coalesce(whs.season_number, 0) as season_number,
      coalesce(whs.episode_number, 0) as episode_number
    from public.watch_history_shares whs
    where whs.target_user_id = auth.uid()
      and whs.project_id = target_project
      and whs.media_type = target_media
      and whs.tmdb_id = any(target_tmdb_ids)
  )
  select
    all_records.tmdb_id,
    count(distinct (all_records.season_number, all_records.episode_number))::int as watched_count
  from all_records
  where all_records.season_number > 0
    and all_records.episode_number > 0
  group by all_records.tmdb_id;
end;
$$;

grant execute on function public.get_watch_history_episode_counts_bulk(
  text,
  text,
  integer[]
) to authenticated;
