import "server-only";

import { GoogleGenAI, type Content } from "@google/genai";
import { getMockChatResponse } from "@/services/mockChatService";
import { ELSEWHERE_TEXT_PROMPT_VERSION, ELSEWHERE_TEXT_SYSTEM_INSTRUCTION } from "@/services/server/elsewhereSystemInstruction";
import type { AITextAttempt, AITextErrorStage, AITextFailureCategory, AITextMode, MessageRole } from "@/types";
import { ELSEWHERE_IMAGE_PROMPT_VERSION } from "@/data/experiment";
import { completedAssistantContent } from "@/services/textResponsePolicy";
import { ChatAttemptFailure, createAttemptAbortContext, runBoundedChatAttempts } from "@/services/chatAttemptPolicy";

const REQUEST_TIMEOUT_MS = 25_000;
const MAX_OUTPUT_TOKENS = 1_024;
const THINKING_BUDGET_TOKENS = 128;

export interface AITextConfigurationStatus {
  mode: string;
  provider: string;
  modelId: string;
  apiKeyConfigured: boolean;
  promptVersion: string;
  imageModelId: string;
  imagePromptVersion: string;
}

export function getAITextConfigurationStatus(): AITextConfigurationStatus {
  const configuredMode = process.env.AI_TEXT_MODE ?? "mock";
  const live = configuredMode === "live";
  return {
    mode: configuredMode,
    provider: live ? "Google Gemini" : configuredMode === "mock" ? "Mock" : "Unavailable",
    modelId: live ? process.env.GEMINI_TEXT_MODEL?.trim() || "Not configured" : "mock-elsewhere-text-v2",
    apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    promptVersion: ELSEWHERE_TEXT_PROMPT_VERSION,
    imageModelId: process.env.GEMINI_IMAGE_MODEL?.trim() || "Not configured",
    imagePromptVersion: ELSEWHERE_IMAGE_PROMPT_VERSION,
  };
}

export interface TextHistoryItem {
  role: Extract<MessageRole, "participant" | "assistant">;
  content: string;
}

export interface TextServiceResult {
  requestId: string;
  content: string;
  provider: string;
  modelId: string;
  promptVersion: string;
  integrationMode: AITextMode;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  finishReason: string;
  attempts: AITextAttempt[];
  attemptCount: number;
  candidateCount: number;
  inputTokenCount?: number;
  outputTokenCount?: number;
  finalResolution: "succeeded";
}

export class SafeAITextError extends Error {
  constructor(
    public readonly category: AITextFailureCategory,
    public readonly finishReason?: string,
    public readonly providerStatusCode?: number,
    public readonly diagnostics: {
      attempts?: AITextAttempt[];
      errorStage?: AITextErrorStage;
      candidateCount?: number;
      inputTokenCount?: number;
      outputTokenCount?: number;
      finalResolution?: "failed_transient" | "failed_non_retryable" | "incomplete_response";
      safeErrorMessage?: string;
    } = {},
  ) {
    super("AI text request failed");
    this.name = "SafeAITextError";
  }
}

const responseCache = new Map<string, Promise<TextServiceResult>>();

function getMode(): AITextMode {
  const value = process.env.AI_TEXT_MODE ?? "mock";
  if (value !== "mock" && value !== "live") throw new SafeAITextError("configuration");
  return value;
}

function safeProviderMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Provider request failed.";
  return error.message
    .replace(/AIza[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/([?&]key=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(api[_ -]?key|authorization|bearer)\s*[:=]?\s*[^\s,;]+/gi, "$1 [redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || error.name;
}

function providerStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  for (const key of ["status", "statusCode", "code"] as const) {
    if (key in error) {
      const value = Number((error as Record<string, unknown>)[key]);
      if (Number.isInteger(value) && value >= 100 && value <= 599) return value;
    }
  }
  return undefined;
}

function classifyProviderError(error: unknown): ChatAttemptFailure {
  if (error instanceof ChatAttemptFailure) return error;
  const status = providerStatus(error);
  const message = safeProviderMessage(error);
  if (error instanceof Error && (error.name === "AbortError" || /abort|timeout/i.test(error.message))) return new ChatAttemptFailure("timeout", "provider_timeout", { providerStatusCode: status, timeout: true, safeErrorMessage: message });
  if (status === 400) return new ChatAttemptFailure("invalid_request", "provider_http", { providerStatusCode: status, safeErrorMessage: message });
  if (status === 401 || status === 403) return new ChatAttemptFailure("permission_denied", "provider_http", { providerStatusCode: status, safeErrorMessage: message });
  if (status === 404) return new ChatAttemptFailure("model_not_found", "provider_http", { providerStatusCode: status, safeErrorMessage: message });
  if (status === 429) return new ChatAttemptFailure("rate_limit", "provider_http", { providerStatusCode: status, safeErrorMessage: message });
  if (status && [500, 502, 503, 504].includes(status)) return new ChatAttemptFailure("provider_unavailable", "provider_http", { providerStatusCode: status, safeErrorMessage: message });
  if (error instanceof TypeError || /network|fetch|socket|connection|econn/i.test(message)) return new ChatAttemptFailure("connection_interruption", "provider_sdk", { safeErrorMessage: message });
  return new ChatAttemptFailure("unknown", "provider_sdk", { providerStatusCode: status, safeErrorMessage: message });
}

async function executeTextRequest(requestId: string, history: TextHistoryItem[]): Promise<TextServiceResult> {
  const mode = getMode();
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const lastParticipantMessage = [...history].reverse().find((message) => message.role === "participant");
  if (!lastParticipantMessage) throw new SafeAITextError("invalid_response");

  if (mode === "mock") {
    const content = await getMockChatResponse(lastParticipantMessage.content);
    const completedAt = new Date().toISOString();
    return {
      requestId,
      content,
      provider: "Mock",
      modelId: "mock-elsewhere-text-v2",
      promptVersion: ELSEWHERE_TEXT_PROMPT_VERSION,
      integrationMode: mode,
      startedAt,
      completedAt,
      latencyMs: Date.now() - started,
      finishReason: "MOCK_COMPLETE",
      attempts: [{ attempt: 1, startedAt, completedAt, durationMs: Date.now() - started, status: "succeeded", finishReason: "MOCK_COMPLETE", candidateCount: 1, timeout: false }],
      attemptCount: 1,
      candidateCount: 1,
      finalResolution: "succeeded",
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const modelId = process.env.GEMINI_TEXT_MODEL;
  if (!apiKey || !modelId) throw new SafeAITextError("configuration");

  try {
    const ai = new GoogleGenAI({ apiKey });
    const contents: Content[] = history.map((message) => ({
      role: message.role === "participant" ? "user" : "model",
      parts: [{ text: message.content }],
    }));
    const execution = await runBoundedChatAttempts(async () => {
      // A controller and timeout belong to one provider attempt only
      // an internal retry or a later participant-initiated Retry request
      const attemptContext = createAttemptAbortContext(REQUEST_TIMEOUT_MS);
      try {
        const response = await ai.models.generateContent({
          model: modelId,
          contents,
          config: {
            systemInstruction: ELSEWHERE_TEXT_SYSTEM_INSTRUCTION,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            thinkingConfig: { thinkingBudget: THINKING_BUDGET_TOKENS },
            abortSignal: attemptContext.controller.signal,
          },
        });
        const finishReason = response.candidates?.[0]?.finishReason ?? "UNKNOWN";
        const candidateCount = response.candidates?.length ?? 0;
        const inputTokenCount = response.usageMetadata?.promptTokenCount;
        const outputTokenCount = response.usageMetadata?.candidatesTokenCount;
        const rawText = response.text;
        const content = completedAssistantContent(rawText, finishReason);
        if (content) return { value: content, finishReason, candidateCount, inputTokenCount, outputTokenCount };
        const common = { finishReason, candidateCount, inputTokenCount, outputTokenCount };
        if (finishReason === "STOP" && !rawText?.trim()) throw new ChatAttemptFailure("empty_response", "response_policy", { ...common, safeErrorMessage: "Provider returned STOP without text." });
        if (finishReason === "MAX_TOKENS") throw new ChatAttemptFailure("max_tokens", "response_policy", { ...common, safeErrorMessage: rawText?.trim() ? "Provider output reached the token limit and was not committed as complete." : "Provider reached the token limit without usable text." });
        if (finishReason === "SAFETY") throw new ChatAttemptFailure("safety", "response_policy", { ...common, safeErrorMessage: "Provider ended the response for safety policy." });
        if (finishReason === "RECITATION") throw new ChatAttemptFailure("recitation", "response_policy", { ...common, safeErrorMessage: "Provider ended the response for recitation policy." });
        throw new ChatAttemptFailure("invalid_response", "response_policy", { ...common, safeErrorMessage: `Provider returned unsupported finish reason ${finishReason}.` });
      } catch (error) {
        throw classifyProviderError(error);
      } finally {
        attemptContext.clear();
      }
    });
    const { value: content, finishReason, candidateCount, inputTokenCount, outputTokenCount } = execution.result;
    const completedAt = new Date().toISOString();
    const result: TextServiceResult = {
      requestId,
      content,
      provider: "Google Gemini",
      modelId,
      promptVersion: ELSEWHERE_TEXT_PROMPT_VERSION,
      integrationMode: mode,
      startedAt,
      completedAt,
      latencyMs: Date.now() - started,
      finishReason,
      attempts: execution.attempts,
      attemptCount: execution.attempts.length,
      candidateCount,
      inputTokenCount,
      outputTokenCount,
      finalResolution: "succeeded",
    };
    return result;
  } catch (error) {
    const failure = classifyProviderError(error);
    const attempts = "attempts" in failure && Array.isArray((failure as ChatAttemptFailure & { attempts?: AITextAttempt[] }).attempts) ? (failure as ChatAttemptFailure & { attempts: AITextAttempt[] }).attempts : [];
    const finalResolution = failure.category === "max_tokens" ? "incomplete_response" : ["timeout", "connection_interruption", "rate_limit", "provider_unavailable", "empty_response"].includes(failure.category) ? "failed_transient" : "failed_non_retryable";
    const diagnostics = {
      attempts,
      errorStage: failure.errorStage,
      candidateCount: failure.options.candidateCount,
      inputTokenCount: failure.options.inputTokenCount,
      outputTokenCount: failure.options.outputTokenCount,
      finalResolution,
      safeErrorMessage: failure.options.safeErrorMessage,
    } as const;
    console.error(`[ai-text] ${JSON.stringify({ requestId, attemptCount: attempts.length, finalResolution, durationMs: Date.now() - started, category: failure.category, errorStage: failure.errorStage, providerStatusCode: failure.options.providerStatusCode, finishReason: failure.options.finishReason, candidateCount: failure.options.candidateCount, inputTokenCount: failure.options.inputTokenCount, outputTokenCount: failure.options.outputTokenCount, timeout: failure.options.timeout ?? false, safeErrorMessage: failure.options.safeErrorMessage })}`);
    throw new SafeAITextError(failure.category, failure.options.finishReason, failure.options.providerStatusCode, diagnostics);
  }
}

export function requestTextCompletion(requestId: string, history: TextHistoryItem[]): Promise<TextServiceResult> {
  const existing = responseCache.get(requestId);
  if (existing) return existing;
  const pending = executeTextRequest(requestId, history).catch((error) => {
    responseCache.delete(requestId);
    throw error;
  });
  responseCache.set(requestId, pending);
  return pending;
}
