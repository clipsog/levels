-- Local schema for Levels development.
-- Keep this Postgres-compatible so it can be moved to Supabase later.

create extension if not exists pgcrypto;

create table if not exists app_state (
  id uuid primary key default gen_random_uuid(),
  profile_key text not null unique default 'default',
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_state_updated_at on app_state (updated_at desc);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_app_state_updated_at on app_state;
create trigger trg_app_state_updated_at
before update on app_state
for each row
execute function set_updated_at();

insert into app_state (profile_key, state)
values ('default', '{}'::jsonb)
on conflict (profile_key) do nothing;
