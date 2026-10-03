-- Concurrency-safe, status-stratified condition assignment.
-- Allocation and study-session creation happen in one database transaction.
-- Excluded or abandoned sessions retain their allocation and therefore remain
-- part of the original block; replacements receive the next allocation.

alter table public.study_sessions
  add column if not exists assignment_method text null,
  add column if not exists assignment_timestamp timestamptz null,
  add column if not exists assignment_block_id text null,
  add column if not exists assignment_position integer null,
  add column if not exists assignment_sequence integer null;

create table if not exists public.condition_assignment_blocks (
  study_status text not null,
  block_number integer not null check (block_number > 0),
  allocation_order text not null check (
    char_length(allocation_order) = 4
    and char_length(replace(allocation_order, 'A', '')) = 2
    and char_length(replace(allocation_order, 'B', '')) = 2
  ),
  allocated_count integer not null default 0 check (allocated_count between 0 and 4),
  created_at timestamptz not null default now(),
  primary key (study_status, block_number)
);

comment on table public.condition_assignment_blocks is
  'Server-only permuted-block allocation state, stratified by study status.';

alter table public.condition_assignment_blocks enable row level security;

create or replace function public.create_study_session_with_assignment(
  p_public_session_id text,
  p_participant_code text,
  p_participant_access_token_hash text,
  p_study_status text,
  p_session_status text,
  p_session_data jsonb,
  p_manual_condition text default null
)
returns public.study_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  l_condition text;
  l_method text;
  l_assigned_at timestamptz := clock_timestamp();
  l_block_number integer;
  l_block_order text;
  l_position integer;
  l_sequence integer;
  l_block_id text;
  l_session_data jsonb;
  l_row public.study_sessions;
begin
  if p_study_status not in ('development_test', 'pilot', 'formal', 'excluded') then
    raise exception 'invalid_study_status';
  end if;

  if p_manual_condition is not null then
    if p_manual_condition not in ('A', 'B') then raise exception 'invalid_manual_condition'; end if;
    l_condition := p_manual_condition;
    l_method := 'researcher_manual';
  else
    l_method := 'balanced_random';
    perform pg_advisory_xact_lock(hashtext('condition-assignment:' || p_study_status));

    select block_number, allocation_order, allocated_count + 1
      into l_block_number, l_block_order, l_position
    from public.condition_assignment_blocks
    where study_status = p_study_status and allocated_count < 4
    order by block_number desc
    limit 1
    for update;

    if not found then
      select coalesce(max(block_number), 0) + 1
        into l_block_number
      from public.condition_assignment_blocks
      where study_status = p_study_status;
      l_block_order := (array['AABB', 'ABAB', 'ABBA', 'BAAB', 'BABA', 'BBAA'])[1 + floor(random() * 6)::integer];
      l_position := 1;
      insert into public.condition_assignment_blocks (study_status, block_number, allocation_order, allocated_count)
      values (p_study_status, l_block_number, l_block_order, 0);
    end if;

    l_condition := substring(l_block_order from l_position for 1);
    l_sequence := ((l_block_number - 1) * 4) + l_position;
    l_block_id := p_study_status || '-block-' || l_block_number::text;

    update public.condition_assignment_blocks
    set allocated_count = l_position
    where study_status = p_study_status and block_number = l_block_number;
  end if;

  l_session_data := p_session_data || jsonb_build_object(
    'condition', l_condition,
    'assignmentMethod', l_method,
    'assignmentTimestamp', l_assigned_at,
    'assignmentStudyStatus', p_study_status
  );
  if l_method = 'balanced_random' then
    l_session_data := l_session_data || jsonb_build_object(
      'assignmentBlockId', l_block_id,
      'assignmentPosition', l_position,
      'assignmentSequence', l_sequence
    );
  end if;
  l_session_data := jsonb_set(
    l_session_data,
    '{postTaskQuestionnaires,additional,required}',
    to_jsonb(l_condition = 'B'),
    true
  );

  insert into public.study_sessions (
    public_session_id,
    participant_code,
    participant_access_token_hash,
    trace_enabled,
    study_status,
    session_status,
    session_data,
    assignment_method,
    assignment_timestamp,
    assignment_block_id,
    assignment_position,
    assignment_sequence
  ) values (
    p_public_session_id,
    p_participant_code,
    p_participant_access_token_hash,
    l_condition = 'B',
    p_study_status,
    p_session_status,
    l_session_data,
    l_method,
    l_assigned_at,
    l_block_id,
    l_position,
    l_sequence
  ) returning * into l_row;

  return l_row;
end;
$$;

revoke all on table public.condition_assignment_blocks from anon, authenticated;
revoke all on function public.create_study_session_with_assignment(text, text, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.create_study_session_with_assignment(text, text, text, text, text, jsonb, text) to service_role;

-- No anonymous policies are created. Allocation and insertion are available
-- only through the server-only privileged client.
