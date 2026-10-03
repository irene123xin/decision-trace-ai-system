import "server-only";

import { GoogleGenAI } from "@google/genai";
import { buildElsewhereImagePrompt, buildVariantPrompt, ELSEWHERE_IMAGE_PROMPT_VERSION } from "@/services/server/elsewhereImageInstruction";
import {
  assertDistinctImageResults,
  classifyProviderException,
  parseGeminiImageResponse,
  resolveVariantResults,
  type ImageResponseDiagnostic,
  type ParsedImagePayload,
} from "@/services/server/imageResponseParser";
import type { ImageDiagnosticCode, ImageErrorCode } from "@/types";

const REQUEST_TIMEOUT_MS = 120_000;

export type GeneratedImagePayload = ParsedImagePayload;

export interface ImageServiceResult {
  requestId: string;
  effectivePrompt: string;
  provider: "Google Gemini";
  model: string;
  promptVersion: string;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  images: GeneratedImagePayload[];
}

export class SafeImageGenerationError extends Error {
  constructor(
    public readonly code: ImageErrorCode,
    public readonly diagnosticCode: ImageDiagnosticCode,
  ) {
    super("Image generation failed");
    this.name = "SafeImageGenerationError";
  }
}

interface SafeDiagnosticLog {
  requestId: string;
  variant: "A" | "B";
  failureStage: ImageDiagnosticCode;
  providerStatus?: number;
  sdkErrorName: string;
  elapsedMs: number;
  candidateCount: number;
  partMimeTypes: string[];
  inlineDataPresent: boolean;
  sanitizedMessage: string;
}

const responseCache = new Map<string, Promise<ImageServiceResult>>();

function sanitizeErrorMessage(error: unknown): string {
  const source = error instanceof Error ? error.message : "Unknown image provider error";
  const apiKey = process.env.GEMINI_API_KEY;
  let safe = source;
  if (apiKey) safe = safe.split(apiKey).join("[redacted]");
  return safe
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, "[redacted]")
    .replace(/(?:api[_-]?key|key|authorization)\s*[=:]\s*[^\s,&]+/gi, "credential=[redacted]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240) || "Image generation failed";
}

function logSafeDiagnostic(input: SafeDiagnosticLog): void {
  console.error("[gemini-image-diagnostic]", JSON.stringify(input));
}

function publicErrorCode(diagnosticCode: ImageDiagnosticCode): ImageErrorCode {
  return diagnosticCode === "NO_IMAGE_PART_RETURNED" || diagnosticCode === "INVALID_INLINE_IMAGE_DATA" || diagnosticCode === "DUPLICATE_IMAGE_RESULTS"
    ? "INVALID_IMAGE_RESPONSE"
    : "IMAGE_PROVIDER_ERROR";
}

function diagnosticDefaults(responseDiagnostic?: ImageResponseDiagnostic) {
  return {
    candidateCount: responseDiagnostic?.candidateCount ?? 0,
    partMimeTypes: responseDiagnostic?.partMimeTypes ?? [],
    inlineDataPresent: responseDiagnostic?.inlineDataPresent ?? false,
  };
}

async function executeImageRequest(requestId: string, promptText: string): Promise<ImageServiceResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GEMINI_IMAGE_MODEL?.trim();
  if (!apiKey || !model) throw new SafeImageGenerationError("IMAGE_PROVIDER_ERROR", "PROVIDER_SDK_ERROR");

  const effectivePrompt = buildElsewhereImagePrompt(promptText);
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const ai = new GoogleGenAI({ apiKey });
    const generateVariant = async (variant: "A" | "B", imageIndex: number): Promise<GeneratedImagePayload> => {
      const variantStarted = Date.now();
      try {
        const response = await ai.models.generateContent({
          model,
          contents: buildVariantPrompt(effectivePrompt, variant),
          config: {
            responseModalities: ["IMAGE"],
            imageConfig: { aspectRatio: "1:1" },
            abortSignal: controller.signal,
          },
        });
        return parseGeminiImageResponse(response, imageIndex);
      } catch (caught) {
        const failure = classifyProviderException(caught);
        logSafeDiagnostic({
          requestId,
          variant,
          failureStage: failure.diagnosticCode,
          providerStatus: failure.providerStatus,
          sdkErrorName: caught instanceof Error ? caught.name : "UnknownError",
          elapsedMs: Date.now() - variantStarted,
          ...diagnosticDefaults(failure.responseDiagnostic),
          sanitizedMessage: sanitizeErrorMessage(caught),
        });
        throw failure;
      }
    };

    // Generate both image variants concurrently under the same 120second abort signal
    const settled = await Promise.allSettled([
      generateVariant("A", 1),
      generateVariant("B", 2),
    ]) as [PromiseSettledResult<GeneratedImagePayload>, PromiseSettledResult<GeneratedImagePayload>];

    let images: [GeneratedImagePayload, GeneratedImagePayload];
    try {
      images = resolveVariantResults(settled);
    } catch (caught) {
      settled.forEach((result, index) => {
        if (result.status !== "rejected") return;
        const underlying = classifyProviderException(result.reason);
        logSafeDiagnostic({
          requestId,
          variant: index === 0 ? "A" : "B",
          failureStage: "ONE_VARIANT_FAILED",
          providerStatus: underlying.providerStatus,
          sdkErrorName: result.reason instanceof Error ? result.reason.name : "UnknownError",
          elapsedMs: Date.now() - started,
          ...diagnosticDefaults(underlying.responseDiagnostic),
          sanitizedMessage: "The logical request was rejected because both variants are required.",
        });
      });
      throw caught;
    }

    try {
      assertDistinctImageResults(images);
    } catch (caught) {
      const failure = classifyProviderException(caught);
      for (const variant of ["A", "B"] as const) {
        logSafeDiagnostic({
          requestId,
          variant,
          failureStage: failure.diagnosticCode,
          sdkErrorName: failure.name,
          elapsedMs: Date.now() - started,
          ...diagnosticDefaults(),
          sanitizedMessage: sanitizeErrorMessage(failure),
        });
      }
      throw failure;
    }

    return {
      requestId,
      effectivePrompt,
      provider: "Google Gemini",
      model,
      promptVersion: ELSEWHERE_IMAGE_PROMPT_VERSION,
      startedAt,
      completedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      images,
    };
  } catch (caught) {
    if (caught instanceof SafeImageGenerationError) throw caught;
    const failure = classifyProviderException(caught);
    throw new SafeImageGenerationError(publicErrorCode(failure.diagnosticCode), failure.diagnosticCode);
  } finally {
    clearTimeout(timeout);
  }
}

export function requestImageGeneration(requestId: string, promptText: string): Promise<ImageServiceResult> {
  const existing = responseCache.get(requestId);
  if (existing) return existing;
  const pending = executeImageRequest(requestId, promptText).catch((error) => {
    responseCache.delete(requestId);
    throw error;
  });
  responseCache.set(requestId, pending);
  return pending;
}
