import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "@/services/server/supabaseAdmin";
import { repositoryFailure, type RepositoryMutationResult } from "@/services/server/repositorySupport";
import type { Database, Json, StudySessionInsert, StudySessionRow } from "@/types/database";

export interface CreateStudySessionInput {
  publicSessionId: string;
  participantCode: string;
  participantAccessTokenHash: string;
  traceEnabled: boolean;
  studyStatus: string;
  sessionStatus: string;
  sessionData: Json;
}

export interface CreateAssignedStudySessionInput {
  publicSessionId: string;
  participantCode: string;
  participantAccessTokenHash: string;
  studyStatus: string;
  sessionStatus: string;
  sessionData: Json;
  manualCondition?: "A" | "B";
}

export interface StudySessionRevisionPatch {
  sessionData?: Json;
  studyStatus?: string;
  sessionStatus?: string;
  completedAt?: string | null;
}

export function buildStudySessionCreatePayload(input: CreateStudySessionInput): StudySessionInsert {
  return {
    public_session_id: input.publicSessionId,
    participant_code: input.participantCode,
    participant_access_token_hash: input.participantAccessTokenHash,
    trace_enabled: input.traceEnabled,
    study_status: input.studyStatus,
    session_status: input.sessionStatus,
    session_data: input.sessionData,
  };
}

const client = (override?: SupabaseClient<Database>) => override ?? getSupabaseAdminClient();

export async function createStudySession(input: CreateStudySessionInput, override?: SupabaseClient<Database>): Promise<StudySessionRow> {
  const { data, error } = await client(override).from("study_sessions").insert(buildStudySessionCreatePayload(input)).select().single();
  if (error || !data) repositoryFailure("study_session_create_failed");
  return data;
}

export async function createAssignedStudySession(input: CreateAssignedStudySessionInput, override?: SupabaseClient<Database>): Promise<StudySessionRow> {
  const { data, error } = await client(override).rpc("create_study_session_with_assignment", {
    p_public_session_id: input.publicSessionId,
    p_participant_code: input.participantCode,
    p_participant_access_token_hash: input.participantAccessTokenHash,
    p_study_status: input.studyStatus,
    p_session_status: input.sessionStatus,
    p_session_data: input.sessionData,
    p_manual_condition: input.manualCondition ?? null,
  }).single();
  if (error || !data) repositoryFailure("study_session_assignment_failed");
  return data;
}

export async function findStudySessionByPublicId(publicSessionId: string, override?: SupabaseClient<Database>): Promise<StudySessionRow | null> {
  const { data, error } = await client(override).from("study_sessions").select("*").eq("public_session_id", publicSessionId).maybeSingle();
  if (error) repositoryFailure("study_session_read_failed");
  return data;
}

export async function findStudySessionByParticipantCode(participantCode: string, override?: SupabaseClient<Database>): Promise<StudySessionRow | null> {
  const { data, error } = await client(override).from("study_sessions").select("*").eq("participant_code", participantCode).maybeSingle();
  if (error) repositoryFailure("study_session_read_failed");
  return data;
}

export async function findStudySessionById(id: string, override?: SupabaseClient<Database>): Promise<StudySessionRow | null> {
  const { data, error } = await client(override).from("study_sessions").select("*").eq("id", id).maybeSingle();
  if (error) repositoryFailure("study_session_read_failed");
  return data;
}

export async function listStudySessions(override?: SupabaseClient<Database>): Promise<StudySessionRow[]> {
  const { data, error } = await client(override).from("study_sessions").select("*").order("updated_at", { ascending: false });
  if (error) repositoryFailure("study_session_list_failed");
  return data ?? [];
}

export async function updateStudySessionWithRevision(
  id: string,
  expectedRevision: number,
  patch: StudySessionRevisionPatch,
  override?: SupabaseClient<Database>,
): Promise<RepositoryMutationResult<StudySessionRow>> {
  const update = {
    ...(patch.sessionData === undefined ? {} : { session_data: patch.sessionData }),
    ...(patch.studyStatus === undefined ? {} : { study_status: patch.studyStatus }),
    ...(patch.sessionStatus === undefined ? {} : { session_status: patch.sessionStatus }),
    ...(patch.completedAt === undefined ? {} : { completed_at: patch.completedAt }),
    revision: expectedRevision + 1,
  };
  const { data, error } = await client(override).from("study_sessions").update(update).eq("id", id).eq("revision", expectedRevision).select().maybeSingle();
  if (error) repositoryFailure("study_session_update_failed");
  return data ? { status: "updated", row: data } : { status: "conflict", expectedRevision };
}