import { createHash } from "node:crypto";

export type ImageDiagnosticCode =
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_HTTP_ERROR"
  | "PROVIDER_SDK_ERROR"
  | "NO_IMAGE_PART_RETURNED"
  | "INVALID_INLINE_IMAGE_DATA"
  | "ONE_VARIANT_FAILED"
  | "DUPLICATE_IMAGE_RESULTS"
  | "LOCAL_IMAGE_STORAGE_ERROR"
  | "REMOTE_IMAGE_STORAGE_ERROR";

export interface ImageResponseDiagnostic {
  candidateCount: number;
  partMimeTypes: string[];
  inlineDataPresent: boolean;
}

export interface ParsedImagePayload {
  imageIndex: number;
  mimeType: string;
  data: string;
}

export class ImageDiagnosticError extends Error {
  readonly diagnosticCode: ImageDiagnosticCode;
  readonly responseDiagnostic?: ImageResponseDiagnostic;
  readonly providerStatus?: number;

  constructor(
    diagnosticCode: ImageDiagnosticCode,
    message: string,
    responseDiagnostic?: ImageResponseDiagnostic,
    providerStatus?: number,
  ) {
    super(message);
    this.name = "ImageDiagnosticError";
    this.diagnosticCode = diagnosticCode;
    this.responseDiagnostic = responseDiagnostic;
    this.providerStatus = providerStatus;
  }
}

const VALID_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_BASE64_CHARACTERS = 16_000_000;

type GeminiResponseShape = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: { data?: unknown; mimeType?: unknown };
      }>;
    };
  }>;
};

function isValidBase64(value: string): boolean {
  if (!value || value.length > MAX_IMAGE_BASE64_CHARACTERS || value.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

export function parseGeminiImageResponse(response: GeminiResponseShape, imageIndex: number): ParsedImagePayload {
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  const parts = candidates.flatMap((candidate) => Array.isArray(candidate.content?.parts) ? candidate.content.parts : []);
  const partMimeTypes = parts.slice(0, 20).map((part) => typeof part.inlineData?.mimeType === "string" ? part.inlineData.mimeType.toLowerCase().slice(0, 80) : "none");
  const inlineParts = parts.filter((part) => part.inlineData !== undefined);
  const diagnostic: ImageResponseDiagnostic = {
    candidateCount: candidates.length,
    partMimeTypes,
    inlineDataPresent: inlineParts.length > 0,
  };

  if (!inlineParts.length) {
    throw new ImageDiagnosticError("NO_IMAGE_PART_RETURNED", "The provider response did not contain an inline image part.", diagnostic);
  }

  const validPart = inlineParts.find((part) => {
    const mimeType = typeof part.inlineData?.mimeType === "string" ? part.inlineData.mimeType.toLowerCase() : "";
    const data = part.inlineData?.data;
    return VALID_IMAGE_MIME_TYPES.has(mimeType) && typeof data === "string" && isValidBase64(data);
  });

  if (!validPart || typeof validPart.inlineData?.data !== "string" || typeof validPart.inlineData.mimeType !== "string") {
    throw new ImageDiagnosticError("INVALID_INLINE_IMAGE_DATA", "The provider returned an invalid inline image part.", diagnostic);
  }

  return {
    imageIndex,
    mimeType: validPart.inlineData.mimeType.toLowerCase(),
    data: validPart.inlineData.data,
  };
}

export function resolveVariantResults(
  results: [PromiseSettledResult<ParsedImagePayload>, PromiseSettledResult<ParsedImagePayload>],
): [ParsedImagePayload, ParsedImagePayload] {
  if (results[0].status !== "fulfilled" || results[1].status !== "fulfilled") {
    throw new ImageDiagnosticError("ONE_VARIANT_FAILED", "At least one image variant did not complete successfully.");
  }
  return [results[0].value, results[1].value];
}

export function assertDistinctImageResults(images: [ParsedImagePayload, ParsedImagePayload]): void {
  const hashes = images.map((image) => createHash("sha256").update(image.data).digest("hex"));
  if (hashes[0] === hashes[1]) {
    throw new ImageDiagnosticError("DUPLICATE_IMAGE_RESULTS", "The provider returned duplicate image variants.");
  }
}

function extractStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as { status?: unknown; code?: unknown; response?: { status?: unknown } };
  const status = typeof record.status === "number" ? record.status : typeof record.response?.status === "number" ? record.response.status : undefined;
  if (status) return status;
  return typeof record.code === "number" && record.code >= 400 && record.code <= 599 ? record.code : undefined;
}

export function classifyProviderException(error: unknown): ImageDiagnosticError {
  if (error instanceof ImageDiagnosticError) return error;
  const name = error instanceof Error ? error.name : "UnknownError";
  const message = error instanceof Error ? error.message : "Unknown provider error";
  if (name === "AbortError" || /abort|timed?\s*out|timeout/i.test(message)) {
    return new ImageDiagnosticError("PROVIDER_TIMEOUT", message);
  }
  const status = extractStatus(error);
  if (status !== undefined) return new ImageDiagnosticError("PROVIDER_HTTP_ERROR", message, undefined, status);
  return new ImageDiagnosticError("PROVIDER_SDK_ERROR", message);
}
