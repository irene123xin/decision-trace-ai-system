import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "@/services/server/supabaseAdmin";
import { repositoryFailure, type RepositoryMutationResult } from "@/services/server/repositorySupport";
import type { CalibrationWorkspaceRow, Database, Json } from "@/types/database";

const client = (override?: SupabaseClient<Database>) => override ?? getSupabaseAdminClient();

export async function loadCalibrationWorkspace(id: string, override?: SupabaseClient<Database>): Promise<CalibrationWorkspaceRow | null> {
  const { data, error } = await client(override).from("calibration_workspaces").select("*").eq("id", id).maybeSingle();
  if (error) repositoryFailure("calibration_workspace_read_failed");
  return data;
}

export async function saveCalibrationWorkspaceWithRevision(
  id: string,
  data: Json,
  expectedRevision: number,
  override?: SupabaseClient<Database>,
): Promise<RepositoryMutationResult<CalibrationWorkspaceRow>> {
  if (expectedRevision === 0) {
    const result = await client(override).from("calibration_workspaces").insert({ id, data, revision: 1 }).select().single();
    if (result.error?.code === "23505") return { status: "conflict", expectedRevision };
    if (result.error || !result.data) repositoryFailure("calibration_workspace_create_failed");
    return { status: "updated", row: result.data };
  }
  const result = await client(override).from("calibration_workspaces").update({ data, revision: expectedRevision + 1 }).eq("id", id).eq("revision", expectedRevision).select().maybeSingle();
  if (result.error) repositoryFailure("calibration_workspace_update_failed");
  return result.data ? { status: "updated", row: result.data } : { status: "conflict", expectedRevision };
}
