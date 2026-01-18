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
