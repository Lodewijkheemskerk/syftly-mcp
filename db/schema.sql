-- Telemetry table for the north-star metric (Q6): one row per endpoint call.
-- Holds no sensitive data — `caller` is a hashed IP+UA fingerprint or an API-key
-- tag (lib/caller.ts), never a raw IP. Version-controlled so the schema lives in
-- git; applied idempotently by scripts/db-setup.mjs.
create table if not exists events (
  id          bigint generated always as identity primary key,
  ts          timestamptz not null default now(),
  endpoint    text not null,
  format      text not null,
  category    text,
  query       text not null,
  caller      text not null,
  user_agent  text,
  client_info text
);

-- Idempotent migration for tables created before client_info existed
-- ("create table if not exists" never alters an existing table).
alter table events add column if not exists client_info text;

create index if not exists events_ts_idx on events (ts);
create index if not exists events_caller_idx on events (caller);
