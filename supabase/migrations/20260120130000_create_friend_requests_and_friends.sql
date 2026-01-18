create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  from_nickname text,
  status text not null check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (from_user_id <> to_user_id)
);

create unique index if not exists friend_requests_unique
  on public.friend_requests (from_user_id, to_user_id);

create index if not exists friend_requests_to_user
  on public.friend_requests (to_user_id, status);

alter table public.friend_requests enable row level security;

create policy "Friend requests readable by participants"
on public.friend_requests
for select
using (auth.uid() = from_user_id or auth.uid() = to_user_id);

create policy "Friend requests insertable by sender"
on public.friend_requests
for insert
with check (auth.uid() = from_user_id);

create policy "Friend requests updatable by recipient"
on public.friend_requests
for update
using (auth.uid() = to_user_id);

create table if not exists public.friends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  friend_nickname text,
  created_at timestamptz not null default now(),
  check (user_id <> friend_id)
);

create unique index if not exists friends_unique
  on public.friends (user_id, friend_id);

alter table public.friends enable row level security;

create policy "Friends self readable"
on public.friends
for select
using (auth.uid() = user_id);

create policy "Friends insertable by user"
on public.friends
for insert
with check (auth.uid() = user_id);

create or replace function public.accept_friend_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req record;
  req_project text;
  from_name text;
  to_name text;
begin
  select * into req
  from public.friend_requests
  where id = request_id
  for update;

  if not found then
    raise exception 'request_not_found';
  end if;

  if req.to_user_id <> auth.uid() then
    raise exception 'not_recipient';
  end if;

  if req.status <> 'pending' then
    raise exception 'request_not_pending';
  end if;

  req_project := coalesce(req.project_id, 'watch');

  select nickname into from_name from public.profiles where id = req.from_user_id;
  select nickname into to_name from public.profiles where id = req.to_user_id;

  insert into public.friends (user_id, friend_id, friend_nickname, project_id)
  values (req.to_user_id, req.from_user_id, from_name, req_project)
  on conflict (user_id, friend_id, project_id) do nothing;

  insert into public.friends (user_id, friend_id, friend_nickname, project_id)
  values (req.from_user_id, req.to_user_id, to_name, req_project)
  on conflict (user_id, friend_id, project_id) do nothing;

  delete from public.friend_requests
  where id = request_id;
end;
$$;

grant execute on function public.accept_friend_request(uuid) to authenticated;

create or replace function public.reject_friend_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req record;
begin
  select * into req
  from public.friend_requests
  where id = request_id
  for update;

  if not found then
    raise exception 'request_not_found';
  end if;

  if req.to_user_id <> auth.uid() then
    raise exception 'not_recipient';
  end if;

  if req.status <> 'pending' then
    raise exception 'request_not_pending';
  end if;

  delete from public.friend_requests
  where id = request_id;
end;
$$;

grant execute on function public.reject_friend_request(uuid) to authenticated;
