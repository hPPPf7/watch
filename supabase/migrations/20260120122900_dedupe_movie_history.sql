with ranked as (
  select id,
         row_number() over (
           partition by user_id, project_id, media_type, tmdb_id
           order by watched_at desc nulls last, created_at desc nulls last
         ) as rn
  from public.watch_history
  where media_type = 'movie'
    and season_number is null
    and episode_number is null
)
delete from public.watch_history wh
using ranked r
where wh.id = r.id
  and r.rn > 1;

update public.watch_history
set season_number = 0,
    episode_number = 0
where media_type = 'movie'
  and season_number is null
  and episode_number is null;
