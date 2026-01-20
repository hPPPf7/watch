create policy "tmdb_cache deny select"
on public.tmdb_cache
for select
using (false);

create policy "tmdb_cache deny insert"
on public.tmdb_cache
for insert
with check (false);

create policy "tmdb_cache deny update"
on public.tmdb_cache
for update
using (false);

create policy "tmdb_cache deny delete"
on public.tmdb_cache
for delete
using (false);
