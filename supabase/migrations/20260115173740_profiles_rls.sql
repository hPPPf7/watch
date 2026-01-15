alter table public.profiles enable row level security;

create policy "Profiles are self readable"
on public.profiles
for select
using (auth.uid() = id);

create policy "Profiles are self updatable"
on public.profiles
for update
using (auth.uid() = id);

create policy "Profiles are self insertable"
on public.profiles
for insert
with check (auth.uid() = id);
