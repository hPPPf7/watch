create or replace function public.sync_friend_nickname()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.friends
  set friend_nickname = new.nickname
  where friend_id = new.id;
  return new;
end;
$$;

drop trigger if exists profiles_sync_friend_nickname on public.profiles;

create trigger profiles_sync_friend_nickname
after update of nickname on public.profiles
for each row
execute function public.sync_friend_nickname();
