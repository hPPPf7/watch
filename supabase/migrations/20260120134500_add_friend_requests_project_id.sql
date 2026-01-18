alter table public.friend_requests
  add column if not exists project_id text;

update public.friend_requests
set project_id = 'watch'
where project_id is null;

alter table public.friend_requests
  alter column project_id set not null;

drop index if exists friend_requests_unique;

create unique index if not exists friend_requests_unique_project
  on public.friend_requests (from_user_id, to_user_id, project_id);

create index if not exists friend_requests_project_status
  on public.friend_requests (project_id, to_user_id, status);
