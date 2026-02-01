-- Merge profiles SELECT policies into a single policy for better performance

DROP POLICY IF EXISTS "Profiles are self readable" ON public.profiles;
DROP POLICY IF EXISTS "Profiles readable by friends or requests" ON public.profiles;

CREATE POLICY "Profiles readable by owner or relations"
ON public.profiles
FOR SELECT
TO public
USING (
  (select auth.uid()) = id
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
