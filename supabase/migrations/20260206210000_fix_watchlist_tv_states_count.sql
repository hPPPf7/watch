create or replace function public.sync_watchlist_tv_states_from_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user uuid;
  target_project text;
  target_tmdb integer;
  watched_count integer;
  total_aired integer;
  progress text;
begin
  if (tg_op = 'DELETE') then
    if old.media_type <> 'tv' then
      return old;
    end if;
    target_user := old.user_id;
    target_project := old.project_id;
    target_tmdb := old.tmdb_id;
  else
    if new.media_type <> 'tv' then
      return new;
    end if;
    target_user := new.user_id;
    target_project := new.project_id;
    target_tmdb := new.tmdb_id;
  end if;

  select count(distinct (season_number, episode_number))
    into watched_count
    from public.watch_history
   where user_id = target_user
     and project_id = target_project
     and media_type = 'tv'
     and tmdb_id = target_tmdb
     and season_number > 0
     and episode_number > 0;

  select last_total_aired
    into total_aired
    from public.watchlist_tv_states
   where user_id = target_user
     and project_id = target_project
     and tmdb_id = target_tmdb;

  if watched_count <= 0 then
    progress := 'unwatched';
  elsif total_aired is not null and total_aired > 0 and watched_count >= total_aired then
    progress := 'completed';
  else
    progress := 'watching';
  end if;

  insert into public.watchlist_tv_states
    (user_id, project_id, tmdb_id, last_progress, last_total_aired, last_watched_count, updated_at)
  values
    (target_user, target_project, target_tmdb, progress, coalesce(total_aired, 0), watched_count, now())
  on conflict (user_id, project_id, tmdb_id)
  do update set
    last_progress = excluded.last_progress,
    last_watched_count = excluded.last_watched_count,
    updated_at = now();

  if (tg_op = 'DELETE') then
    return old;
  end if;
  return new;
end;
$$;

update public.watchlist_tv_states w
set last_watched_count = coalesce(stats.watched_count, 0),
    last_progress = case
      when coalesce(stats.watched_count, 0) = 0 then 'unwatched'
      when w.last_total_aired is not null
        and w.last_total_aired > 0
        and coalesce(stats.watched_count, 0) >= w.last_total_aired then 'completed'
      else 'watching'
    end,
    updated_at = now()
from (
  select
    wh.user_id,
    wh.project_id,
    wh.tmdb_id,
    count(distinct (wh.season_number, wh.episode_number))::int as watched_count
  from public.watch_history wh
  where wh.media_type = 'tv'
    and wh.season_number > 0
    and wh.episode_number > 0
  group by wh.user_id, wh.project_id, wh.tmdb_id
) stats
where w.user_id = stats.user_id
  and w.project_id = stats.project_id
  and w.tmdb_id = stats.tmdb_id;

update public.watchlist_tv_states w
set last_watched_count = 0,
    last_progress = 'unwatched',
    updated_at = now()
where not exists (
  select 1
  from public.watch_history wh
  where wh.user_id = w.user_id
    and wh.project_id = w.project_id
    and wh.media_type = 'tv'
    and wh.tmdb_id = w.tmdb_id
    and wh.season_number > 0
    and wh.episode_number > 0
);
