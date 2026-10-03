import type { AITextAttempt, AITextErrorStage, AITextFailureCategory, AITextRetryReason } from "@/types";

export interface ChatAttemptSuccess<T> {
  value: T;
  finishReason: string;
  candidateCount: number;
  inputTokenCount?: number;
  outputTokenCount?: number;
}

export class ChatAttemptFailure extends Error {
  readonly category: AITextFailureCategory;
  readonly errorStage: AITextErrorStage;
  readonly options: {
    providerStatusCode?: number;
    finishReason?: string;
    candidateCount?: number;
    inputTokenCount?: number;
    outputTokenCount?: number;
    timeout?: boolean;
    safeErrorMessage?: string;
  };
  constructor(
    category: AITextFailureCategory,
    errorStage: AITextErrorStage,
    options: {
      providerStatusCode?: number;
      finishReason?: string;
      candidateCount?: number;
      inputTokenCount?: number;
      outputTokenCount?: number;
      timeout?: boolean;
      safeErrorMessage?: string;
    } = {},
  ) {
    super("AI text attempt failed");
    this.name = "ChatAttemptFailure";
    this.category = category;
    this.errorStage = errorStage;
    this.options = options;
  }
}

export function retryReasonFor(failure: ChatAttemptFailure): AITextRetryReason | null {
  if (failure.category === "timeout") return "timeout";
  if (failure.category === "connection_interruption") return "connection_interruption";
  if (failure.category === "rate_limit") return "rate_limit";
  if (failure.category === "provider_unavailable") return "provider_unavailable";
  if (failure.category === "empty_response") return "empty_response";
  return null;
}

export function isTransientChatFailure(category: AITextFailureCategory): boolean {
  return ["timeout", "connection_interruption", "rate_limit", "provider_unavailable", "empty_response"].includes(category);
}

export function createAttemptAbortContext(timeoutMs: number): { controller: AbortController; clear: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, clear: () => clearTimeout(timeout) };
}

export async function runBoundedChatAttempts<T>(
  execute: (attempt: number) => Promise<ChatAttemptSuccess<T>>,
  options: { wait?: (milliseconds: number) => Promise<void>; jitter?: () => number } = {},
): Promise<{ result: ChatAttemptSuccess<T>; attempts: AITextAttempt[] }> {
  const attempts: AITextAttempt[] = [];
  const wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const jitter = options.jitter ?? Math.random;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const started = Date.now();
    const startedAt = new Date().toISOString();
    try {
      const result = await execute(attempt);
      attempts.push({ attempt, startedAt, completedAt: new Date().toISOString(), durationMs: Date.now() - started, status: "succeeded", finishReason: result.finishReason, candidateCount: result.candidateCount, inputTokenCount: result.inputTokenCount, outputTokenCount: result.outputTokenCount, timeout: false });
      return { result, attempts };
    } catch (error) {
      const failure = error instanceof ChatAttemptFailure ? error : new ChatAttemptFailure("unknown", "provider_sdk", { safeErrorMessage: "Unclassified provider SDK failure." });
      const retryReason = retryReasonFor(failure);
      attempts.push({ attempt, startedAt, completedAt: new Date().toISOString(), durationMs: Date.now() - started, status: "failed", providerStatusCode: failure.options.providerStatusCode, errorCategory: failure.category, errorStage: failure.errorStage, finishReason: failure.options.finishReason, candidateCount: failure.options.candidateCount, inputTokenCount: failure.options.inputTokenCount, outputTokenCount: failure.options.outputTokenCount, timeout: Boolean(failure.options.timeout), retryReason: attempt === 1 && retryReason ? retryReason : undefined, safeErrorMessage: failure.options.safeErrorMessage });
      if (attempt === 2 || !retryReason) throw Object.assign(failure, { attempts });
      await wait(250 + Math.floor(jitter() * 151));
    }
  }
  throw new ChatAttemptFailure("unknown", "provider_sdk");
}
