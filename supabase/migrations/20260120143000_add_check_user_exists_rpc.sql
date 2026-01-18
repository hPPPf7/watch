create or replace function public.check_user_exists(target_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1
    from auth.users
    where id = target_id
  );
$$;

grant execute on function public.check_user_exists(uuid) to authenticated;
