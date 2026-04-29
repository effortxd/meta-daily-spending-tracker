-- Run this in Supabase SQL Editor after creating your project.

-- Single key-value table that mirrors window.storage from the artifact.
create table if not exists kv_store (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- Enable Row Level Security
alter table kv_store enable row level security;

-- Allow anyone to read and write (matches the artifact's "anyone with link" model).
-- The admin passcode in the app is the soft lock.
-- For tighter control, replace these with auth-based policies.
create policy "Public read"   on kv_store for select using (true);
create policy "Public insert" on kv_store for insert with check (true);
create policy "Public update" on kv_store for update using (true);
create policy "Public delete" on kv_store for delete using (true);
