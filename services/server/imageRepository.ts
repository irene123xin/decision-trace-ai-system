import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "@/services/server/supabaseAdmin";
import { repositoryFailure } from "@/services/server/repositorySupport";
import type { Database, GeneratedImageInsert, GeneratedImageRow, Json } from "@/types/database";

export interface CreateGeneratedImageRecordInput {
  sessionId: string;
  existingImageId: string;
  requestId: string;
  storagePath: string;
  mimeType: string;
  byteSize: number;
  sha256Checksum?: string | null;
  metadata?: Json;
}

export function buildGeneratedImageInsert(input: CreateGeneratedImageRecordInput): GeneratedImageInsert {
  return {
    session_id: input.sessionId,
    existing_image_id: input.existingImageId,
    request_id: input.requestId,
    storage_path: input.storagePath,
    mime_type: input.mimeType,
    byte_size: input.byteSize,
    sha256_checksum: input.sha256Checksum ?? null,
    metadata: input.metadata ?? {},
  };
}

const client = (override?: SupabaseClient<Database>) => override ?? getSupabaseAdminClient();

export async function createGeneratedImageRecords(inputs: CreateGeneratedImageRecordInput[], override?: SupabaseClient<Database>): Promise<GeneratedImageRow[]> {
  if (!inputs.length) return [];
  const { data, error } = await client(override).from("generated_images").insert(inputs.map(buildGeneratedImageInsert)).select();
  if (error || !data || data.length !== inputs.length) repositoryFailure("generated_image_pair_create_failed");
  return data;
}

export async function listGeneratedImagesForSession(sessionId: string, override?: SupabaseClient<Database>): Promise<GeneratedImageRow[]> {
  const { data, error } = await client(override).from("generated_images").select("*").eq("session_id", sessionId).order("created_at", { ascending: true });
  if (error) repositoryFailure("generated_image_list_failed");
  return data ?? [];
}

export async function listGeneratedImagesForRequest(sessionId: string, requestId: string, override?: SupabaseClient<Database>): Promise<GeneratedImageRow[]> {
  const { data, error } = await client(override).from("generated_images").select("*").eq("session_id", sessionId).eq("request_id", requestId).order("created_at", { ascending: true });
  if (error) repositoryFailure("generated_image_request_read_failed");
  return data ?? [];
}

export async function findGeneratedImageForSession(sessionId: string, existingImageId: string, override?: SupabaseClient<Database>): Promise<GeneratedImageRow | null> {
  const { data, error } = await client(override).from("generated_images").select("*").eq("session_id", sessionId).eq("existing_image_id", existingImageId).maybeSingle();
  if (error) repositoryFailure("generated_image_read_failed");
  return data;
}

export async function deleteGeneratedImageRecord(id: string, override?: SupabaseClient<Database>): Promise<boolean> {
  const { data, error } = await client(override).from("generated_images").delete().eq("id", id).select("id").maybeSingle();
  if (error) repositoryFailure("generated_image_delete_failed");
  return Boolean(data);
}

export async function deleteGeneratedImageRecords(ids: string[], override?: SupabaseClient<Database>): Promise<number> {
  if (!ids.length) return 0;
  const { data, error } = await client(override).from("generated_images").delete().in("id", ids).select("id");
  if (error) repositoryFailure("generated_image_pair_delete_failed");
  return data?.length ?? 0;
}
