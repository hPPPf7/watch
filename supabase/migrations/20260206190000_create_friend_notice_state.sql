create table if not exists public.friend_notice_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists friend_notice_state_unique
  on public.friend_notice_state (user_id, project_id);

create index if not exists friend_notice_state_user
  on public.friend_notice_state (user_id);

alter table public.friend_notice_state enable row level security;

create policy "Friend notice state is self readable"
on public.friend_notice_state
for select
using (auth.uid() = user_id);

create policy "Friend notice state is self insertable"
on public.friend_notice_state
for insert
with check (auth.uid() = user_id);

create policy "Friend notice state is self updatable"
on public.friend_notice_state
for update
using (auth.uid() = user_id);

create policy "Friend notice state is self deletable"
on public.friend_notice_state
for delete
using (auth.uid() = user_id);
