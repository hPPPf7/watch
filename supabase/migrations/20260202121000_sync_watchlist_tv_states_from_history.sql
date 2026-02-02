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

  select count(*)
    into watched_count
    from public.watch_history
   where user_id = target_user
     and project_id = target_project
     and media_type = 'tv'
     and tmdb_id = target_tmdb;

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

drop trigger if exists watch_history_sync_tv_state on public.watch_history;
create trigger watch_history_sync_tv_state
after insert or update or delete on public.watch_history
for each row execute function public.sync_watchlist_tv_states_from_history();
