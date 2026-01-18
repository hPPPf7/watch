update public.watch_history
set season_number = 0,
    episode_number = 0
where media_type = 'movie'
  and season_number is null
  and episode_number is null;
