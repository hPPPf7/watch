-- Optimize auth.uid() evaluation in watch_history_conflicts RLS policies

alter policy "Watch history conflicts are readable by target"
on public.watch_history_conflicts
using (target_user_id = (select auth.uid()));

alter policy "Watch history conflicts are updatable by target"
on public.watch_history_conflicts
using (target_user_id = (select auth.uid()));

alter policy "Watch history conflicts are deletable by target or owner"
on public.watch_history_conflicts
using (
  (target_user_id = (select auth.uid()))
  OR (owner_id = (select auth.uid()))
);
