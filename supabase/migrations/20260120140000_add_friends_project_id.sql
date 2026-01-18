alter table public.friends
  add column if not exists project_id text;

update public.friends
set project_id = 'watch'
where project_id is null;

alter table public.friends
  alter column project_id set not null;

drop index if exists friends_unique;

create unique index if not exists friends_unique_project
  on public.friends (user_id, friend_id, project_id);

create index if not exists friends_user_project
  on public.friends (user_id, project_id);
