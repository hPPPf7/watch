-- Optimize auth.uid() evaluation in profiles RLS policies

alter policy "Profiles are self insertable"
on public.profiles
with check ((select auth.uid()) = id);

alter policy "Profiles are self readable"
on public.profiles
using ((select auth.uid()) = id);

alter policy "Profiles are self updatable"
on public.profiles
using ((select auth.uid()) = id);

alter policy "Profiles readable by friends or requests"
on public.profiles
using (
  ((select auth.uid()) = id)
  OR EXISTS (
    SELECT 1
    FROM friends f
    WHERE f.user_id = (select auth.uid())
      AND f.friend_id = profiles.id
  )
  OR EXISTS (
    SELECT 1
    FROM friend_requests r
    WHERE (r.from_user_id = profiles.id AND r.to_user_id = (select auth.uid()))
       OR (r.to_user_id = profiles.id AND r.from_user_id = (select auth.uid()))
  )
);
