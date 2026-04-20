-- Shared bridge tables for Levels + Assets integration.
-- Safe to run repeatedly.

create extension if not exists pgcrypto;

create table if not exists integration_snapshots (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_key text not null,
  state jsonb not null,
  state_hash text not null,
  imported_at timestamptz not null default now(),
  unique (source, source_key, state_hash)
);

create table if not exists shared_businesses (
  id text primary key,
  source text not null,
  source_id text not null,
  name text not null default '',
  fed_by_account_id text,
  feeds_account_id text,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_shared_businesses_source on shared_businesses (source);

create table if not exists shared_accounts (
  id text primary key,
  source text not null,
  source_id text not null,
  name text not null default '',
  usage text not null default '',
  balance numeric,
  currency text,
  feeds_account_id text,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_shared_accounts_source on shared_accounts (source);

create table if not exists shared_subscriptions (
  id text primary key,
  source text not null,
  source_id text not null,
  name text not null default '',
  cost numeric,
  currency text,
  status text,
  usage_count integer,
  linked_business_id text,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_shared_subscriptions_source on shared_subscriptions (source);

create table if not exists shared_assets (
  id text primary key,
  source text not null,
  source_id text not null,
  name text not null default '',
  category text,
  condition text,
  usage_count integer,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_shared_assets_source on shared_assets (source);

create table if not exists shared_transactions (
  id text primary key,
  source text not null,
  source_id text not null,
  kind text not null,
  amount numeric,
  currency text,
  occurred_on date,
  business_id text,
  account_id text,
  note text,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_shared_transactions_source on shared_transactions (source);
create index if not exists idx_shared_transactions_business on shared_transactions (business_id);

create table if not exists shared_work_items (
  id text primary key,
  source text not null,
  source_id text not null,
  title text not null default '',
  status text,
  start_at timestamptz,
  end_at timestamptz,
  business_id text,
  note text,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_shared_work_items_source on shared_work_items (source);
