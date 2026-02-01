-- Optimize auth.uid() evaluation in friends RLS policies

alter policy "Friends self readable"
on public.friends
using ((select auth.uid()) = user_id);

alter policy "Friends insertable by user"
on public.friends
with check ((select auth.uid()) = user_id);
