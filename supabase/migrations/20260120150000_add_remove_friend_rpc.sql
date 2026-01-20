create or replace function public.remove_friend(target_id uuid, target_project text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_id = auth.uid() then
    raise exception 'cannot_remove_self';
  end if;

  delete from public.friends
  where project_id = target_project
    and (
      (user_id = auth.uid() and friend_id = target_id)
      or
      (user_id = target_id and friend_id = auth.uid())
    );

  delete from public.friend_requests
  where project_id = target_project
    and (
      (from_user_id = auth.uid() and to_user_id = target_id)
      or
      (from_user_id = target_id and to_user_id = auth.uid())
    );
end;
$$;

grant execute on function public.remove_friend(uuid, text) to authenticated;
