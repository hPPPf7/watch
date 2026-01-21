create policy "Profiles readable by friends or requests"
on public.profiles
for select
using (
  auth.uid() = id
  or exists (
    select 1
    from public.friends f
    where f.user_id = auth.uid()
      and f.friend_id = profiles.id
  )
  or exists (
    select 1
    from public.friend_requests r
    where (r.from_user_id = profiles.id and r.to_user_id = auth.uid())
       or (r.to_user_id = profiles.id and r.from_user_id = auth.uid())
  )
);
