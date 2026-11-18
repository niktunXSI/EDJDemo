-- Client Product Insights: initial schema (PostgreSQL; also runs on PGlite locally)

create table if not exists advisors (
  id text primary key,
  name text not null,
  title text not null default 'Financial Advisor',
  branch text not null,
  city text not null,
  state text not null,
  region text not null,
  email text not null,
  joined_year integer not null,
  created_at timestamptz not null default now()
);

create table if not exists clients (
  id text primary key,
  household_name text not null,
  primary_contact text not null,
  city text not null,
  state text not null,
  region text not null,
  relationship_since date not null,
  segment text not null,
  advisor_id text not null references advisors(id),
  household_members integer not null default 1,
  preferred_channel text not null default 'Client web',
  created_at timestamptz not null default now()
);
create index if not exists clients_advisor_idx on clients(advisor_id);

create table if not exists team_members (
  id text primary key,
  name text not null,
  role text not null,
  team text not null,
  email text not null,
  is_demo_persona boolean not null default false
);

create sequence if not exists request_number_seq start 1001;

create table if not exists requests (
  id text primary key,
  title text not null,
  request_type text not null,
  client_id text references clients(id),
  advisor_id text not null references advisors(id),
  product_area text not null,
  channel text not null,
  priority text not null,
  status text not null default 'new',
  automation_status text not null default 'not_queued',
  original_feedback text not null,
  problem_statement text not null default '',
  requested_outcome text not null,
  current_workaround text not null default '',
  business_impact text not null default '',
  expected_benefit text not null default '',
  owner_id text references team_members(id),
  tags text[] not null default '{}',
  revision integer not null default 1,
  external_issue_key text,
  external_issue_url text,
  external_issue_system text,
  external_ref_is_sample boolean not null default false,
  external_ref_updated_at timestamptz,
  automation_summary text,
  automation_updated_at timestamptz,
  is_sample boolean not null default false,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists requests_status_idx on requests(status);
create index if not exists requests_automation_idx on requests(automation_status);
create index if not exists requests_client_idx on requests(client_id);
create index if not exists requests_advisor_idx on requests(advisor_id);
create index if not exists requests_submitted_idx on requests(submitted_at desc);

create table if not exists request_relations (
  request_id text not null references requests(id) on delete cascade,
  related_request_id text not null references requests(id) on delete cascade,
  primary key (request_id, related_request_id)
);

create table if not exists notes (
  id bigserial primary key,
  request_id text not null references requests(id) on delete cascade,
  author_id text,
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists notes_request_idx on notes(request_id, created_at desc);

create table if not exists activity_events (
  id bigserial primary key,
  request_id text references requests(id) on delete cascade,
  actor_type text not null,
  actor_id text,
  actor_name text not null,
  event_type text not null,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  is_sample boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists activity_request_idx on activity_events(request_id, created_at desc);
create index if not exists activity_created_idx on activity_events(created_at desc);

-- One row per queueing of a request revision. The partial unique index makes
-- queueing idempotent: at most one active job per request revision.
create table if not exists automation_jobs (
  id text primary key,
  request_id text not null references requests(id) on delete cascade,
  revision integer not null,
  event_id text not null unique,
  correlation_id text not null,
  status text not null default 'queued',
  claimed_by text,
  claim_token text,
  lease_expires_at timestamptz,
  claim_count integer not null default 0,
  status_message text,
  result_summary text,
  error_message text,
  result jsonb,
  queued_by text not null,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz
);
create unique index if not exists automation_jobs_active_uniq
  on automation_jobs(request_id, revision) where status in ('queued', 'processing');
create index if not exists automation_jobs_request_idx on automation_jobs(request_id, created_at desc);
create index if not exists automation_jobs_status_idx on automation_jobs(status, created_at);

create table if not exists webhook_config (
  id integer primary key check (id = 1),
  enabled boolean not null default true,
  destination text not null default 'mock',
  url text,
  secret text,
  auto_queue boolean not null default false,
  include_client_identity boolean not null default false,
  mock_failure_mode boolean not null default false,
  agent_api_key text,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Durable outbox. A row is written in the same transaction as the queued
-- state; dispatchers claim due rows with FOR UPDATE SKIP LOCKED.
create table if not exists webhook_deliveries (
  id text primary key,
  event_id text not null,
  event_type text not null,
  request_id text references requests(id) on delete cascade,
  job_id text references automation_jobs(id) on delete cascade,
  payload text not null,
  destination text not null,
  target_url text,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  last_status_code integer,
  last_error text,
  is_test boolean not null default false,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists webhook_deliveries_due_idx on webhook_deliveries(status, next_attempt_at);
create index if not exists webhook_deliveries_created_idx on webhook_deliveries(created_at desc);
create index if not exists webhook_deliveries_request_idx on webhook_deliveries(request_id);

create table if not exists webhook_attempts (
  id bigserial primary key,
  delivery_id text not null references webhook_deliveries(id) on delete cascade,
  attempt_number integer not null,
  started_at timestamptz not null default now(),
  duration_ms integer not null default 0,
  status_code integer,
  outcome text not null,
  error text,
  response_excerpt text,
  target text
);
create index if not exists webhook_attempts_delivery_idx on webhook_attempts(delivery_id, attempt_number);

create table if not exists mock_receiver_events (
  id bigserial primary key,
  received_at timestamptz not null default now(),
  event_id text,
  event_type text,
  request_id text,
  signature_valid boolean not null,
  signature_error text,
  response_status integer not null,
  headers jsonb not null default '{}'::jsonb,
  body jsonb
);
create index if not exists mock_receiver_received_idx on mock_receiver_events(received_at desc);
