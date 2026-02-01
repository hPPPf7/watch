-- Optimize auth.uid() evaluation in watch_history_shares RLS policies

alter policy "Watch history shares readable by owner or target"
on public.watch_history_shares
using (
  ((select auth.uid()) = owner_id)
  OR ((select auth.uid()) = target_user_id)
);

alter policy "Watch history shares insertable by owner"
on public.watch_history_shares
with check ((select auth.uid()) = owner_id);

alter policy "Watch history shares updatable by owner"
on public.watch_history_shares
using ((select auth.uid()) = owner_id);

alter policy "Watch history shares deletable by owner"
on public.watch_history_shares
using ((select auth.uid()) = owner_id);
