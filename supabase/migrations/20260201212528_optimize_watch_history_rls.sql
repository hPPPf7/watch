-- Optimize auth.uid() evaluation in watch_history RLS policies

alter policy "Watch history is self deletable"
on public.watch_history
using ((select auth.uid()) = user_id);

alter policy "Watch history is self insertable"
on public.watch_history
with check ((select auth.uid()) = user_id);

alter policy "Watch history is self readable"
on public.watch_history
using ((select auth.uid()) = user_id);

alter policy "Watch history is self updatable"
on public.watch_history
using ((select auth.uid()) = user_id);
