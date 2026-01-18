alter table public.watchlist_items
  add column if not exists project_id text;

update public.watchlist_items
set project_id = 'watch'
where project_id is null;

alter table public.watchlist_items
  alter column project_id set not null;

create index if not exists watchlist_items_user_project
  on public.watchlist_items (user_id, project_id, media_type, is_anime);
