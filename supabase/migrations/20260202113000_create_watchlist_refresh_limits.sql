create table if not exists public.watchlist_refresh_limits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id text not null,
  scope text not null,
  last_manual_refresh_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists watchlist_refresh_limits_unique
  on public.watchlist_refresh_limits (user_id, project_id, scope);

alter table public.watchlist_refresh_limits enable row level security;

create policy "Refresh limits are self readable"
on public.watchlist_refresh_limits
for select
using (auth.uid() = user_id);

create policy "Refresh limits are self insertable"
on public.watchlist_refresh_limits
for insert
with check (auth.uid() = user_id);

create policy "Refresh limits are self updatable"
on public.watchlist_refresh_limits
for update
using (auth.uid() = user_id);

create policy "Refresh limits are self deletable"
on public.watchlist_refresh_limits
for delete
using (auth.uid() = user_id);
