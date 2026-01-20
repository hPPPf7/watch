create policy "Friend requests deletable by participants"
on public.friend_requests
for delete
using (auth.uid() = from_user_id or auth.uid() = to_user_id);
