-- Optimize auth.uid() evaluation in watchlist_items RLS policies

alter policy "Watchlist items are self deletable"
on public.watchlist_items
using ((select auth.uid()) = user_id);

alter policy "Watchlist items are self insertable"
on public.watchlist_items
with check ((select auth.uid()) = user_id);

alter policy "Watchlist items are self readable"
on public.watchlist_items
using ((select auth.uid()) = user_id);

alter policy "Watchlist items are self updatable"
on public.watchlist_items
using ((select auth.uid()) = user_id);
