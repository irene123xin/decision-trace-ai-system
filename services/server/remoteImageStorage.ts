import "server-only";

import { createHash } from "node:crypto";
import { getSupabaseAdminClient } from "@/services/server/supabaseAdmin";

export const GENERATED_IMAGES_BUCKET = "generated-images";
export const MAX_GENERATED_IMAGE_BYTES = 12_000_000;
export const SUPPORTED_GENERATED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export interface ValidatedImageBinary {
  bytes: Buffer;
  mimeType: string;
  byteSize: number;
  checksum: string;
  extension: string;
}

export function decodeGeneratedImage(data: string, mimeType: string): ValidatedImageBinary {
  const normalizedMimeType = mimeType.toLowerCase();
  if (!SUPPORTED_GENERATED_IMAGE_MIME_TYPES.has(normalizedMimeType)) throw new Error("unsupported_image_mime_type");
  if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error("invalid_image_base64");
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.byteLength > MAX_GENERATED_IMAGE_BYTES) throw new Error("image_size_invalid");
  return {
    bytes,
    mimeType: normalizedMimeType,
    byteSize: bytes.byteLength,
    checksum: createHash("sha256").update(bytes).digest("hex"),
    extension: EXTENSIONS[normalizedMimeType],
  };
}

function safePathPart(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid_storage_path_part");
  return value;
}

export function buildGeneratedImageStoragePath(studySessionUuid: string, requestId: string, existingImageId: string, extension: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(studySessionUuid) || !/^(png|jpg|webp)$/.test(extension)) throw new Error("invalid_storage_path_part");
  return `${studySessionUuid}/${safePathPart(requestId)}/${safePathPart(existingImageId)}.${extension}`;
}

export async function uploadPrivateGeneratedImage(path: string, binary: ValidatedImageBinary): Promise<void> {
  const { error } = await getSupabaseAdminClient().storage.from(GENERATED_IMAGES_BUCKET).upload(path, binary.bytes, {
    contentType: binary.mimeType,
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw new Error("private_image_upload_failed");
}

export async function removePrivateGeneratedImages(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { error } = await getSupabaseAdminClient().storage.from(GENERATED_IMAGES_BUCKET).remove(paths);
  if (error) throw new Error("private_image_cleanup_failed");
}

export async function downloadPrivateGeneratedImage(path: string): Promise<Blob> {
  const { data, error } = await getSupabaseAdminClient().storage.from(GENERATED_IMAGES_BUCKET).download(path);
  if (error || !data) throw new Error("private_image_download_failed");
  return data;
}
