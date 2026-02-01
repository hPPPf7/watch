-- Optimize auth.uid() evaluation in friend_requests RLS policies

alter policy "Friend requests deletable by participants"
on public.friend_requests
using (((select auth.uid()) = from_user_id) OR ((select auth.uid()) = to_user_id));

alter policy "Friend requests insertable by sender"
on public.friend_requests
with check ((select auth.uid()) = from_user_id);

alter policy "Friend requests readable by participants"
on public.friend_requests
using (((select auth.uid()) = from_user_id) OR ((select auth.uid()) = to_user_id));

alter policy "Friend requests updatable by recipient"
on public.friend_requests
using ((select auth.uid()) = to_user_id);
