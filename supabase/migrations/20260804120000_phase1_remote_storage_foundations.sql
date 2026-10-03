-- All table and Storage access is intended to pass through protected Next.js
-- server routes using a server-only Supabase credential. Participant browsers
-- must not query these relations or the Storage bucket directly

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  public_session_id text unique not null,
  participant_code text unique not null,
  participant_access_token_hash text not null,
  trace_enabled boolean not null,
  study_status text not null,
  session_status text not null,
  session_data jsonb not null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null
);

comment on table public.study_sessions is
  'Server-managed study sessions. No direct participant or anonymous table access is permitted.';
comment on column public.study_sessions.participant_access_token_hash is
  'One-way hash only. Raw participant access tokens must never be stored.';

-- The unique constraints above provide indexes for public_session_id and
-- participant_code.  The following indexes support researcher filtering
create index if not exists study_sessions_study_status_idx on public.study_sessions (study_status);
create index if not exists study_sessions_session_status_idx on public.study_sessions (session_status);
create index if not exists study_sessions_updated_at_idx on public.study_sessions (updated_at desc);

drop trigger if exists study_sessions_set_updated_at on public.study_sessions;
create trigger study_sessions_set_updated_at
before update on public.study_sessions
for each row execute function public.set_updated_at();

create table if not exists public.generated_images (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.study_sessions(id) on delete cascade,
  existing_image_id text not null,
  request_id text not null,
  storage_path text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  sha256_checksum text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint generated_images_session_existing_image_unique unique (session_id, existing_image_id)
);

comment on table public.generated_images is
  'Metadata for private generated-image objects uploaded only by protected server routes.';

create index if not exists generated_images_session_id_idx on public.generated_images (session_id);
create index if not exists generated_images_request_id_idx on public.generated_images (request_id);

create table if not exists public.calibration_workspaces (
  id text primary key,
  data jsonb not null,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

comment on table public.calibration_workspaces is
  'Researcher-only classifier calibration and freeze workspace data.';

drop trigger if exists calibration_workspaces_set_updated_at on public.calibration_workspaces;
create trigger calibration_workspaces_set_updated_at
before update on public.calibration_workspaces
for each row execute function public.set_updated_at();

alter table public.study_sessions enable row level security;
alter table public.generated_images enable row level security;
alter table public.calibration_workspaces enable row level security;

-- Deliberately no anon/authenticated policies are created. The service-secret
-- server client bypasses RLS inside protected Next.js routes. Do not add a
-- permissive anonymous policy for participant access

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'generated-images',
  'generated-images',
  false,
  15728640,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- No storage.objects policy is created. Uploads and reads remain server-only
