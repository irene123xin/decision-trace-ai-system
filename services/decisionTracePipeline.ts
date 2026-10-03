import { extractAiPropositions } from "./decisionTraceClassifier.ts";
import type { DecisionTraceContext } from "./decisionTraceClassifier.ts";
import type { TraceClassificationAttempt, TraceErrorStage } from "@/types";

export interface PreparedDecisionTraceContext {
  context: DecisionTraceContext;
  extractionStatus: "structured" | "raw_context_fallback" | "failed";
  extractionAttemptCount: number;
}

export function prepareDecisionTraceContext(
  input: DecisionTraceContext,
  extractor: typeof extractAiPropositions = extractAiPropositions,
): PreparedDecisionTraceContext {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const propositions = extractor(input.recentMessages, input.aiPropositions).slice(-32);
      return {
        context: { ...input, aiPropositions: propositions },
        extractionStatus: propositions.length ? "structured" : "raw_context_fallback",
        extractionAttemptCount: attempt,
      };
    } catch {
      if (attempt === 2) return { context: input, extractionStatus: "failed", extractionAttemptCount: attempt };
    }
  }
  return { context: input, extractionStatus: "failed", extractionAttemptCount: 2 };
}

export class TraceAttemptFailure extends Error {
  readonly errorStage: TraceErrorStage;
  readonly providerStatusCode?: number;
  readonly retryReason?: TraceClassificationAttempt["retryReason"];
  readonly finishReason?: string;
  readonly diagnostics?: Pick<TraceClassificationAttempt, "candidateCount" | "inputTokenCount" | "outputTokenCount" | "responseTextPresent" | "validationPath">;
  constructor(
    errorStage: TraceErrorStage,
    providerStatusCode?: number,
    retryReason?: TraceClassificationAttempt["retryReason"],
    finishReason?: string,
    diagnostics?: TraceAttemptFailure["diagnostics"],
  ) {
    super("Decision Trace attempt failed");
    this.name = "TraceAttemptFailure";
    this.errorStage = errorStage;
    this.providerStatusCode = providerStatusCode;
    this.retryReason = retryReason;
    this.finishReason = finishReason;
    this.diagnostics = diagnostics;
  }
}

export interface TraceAttemptRun<T> {
  value: T;
  attempts: TraceClassificationAttempt[];
  resolution: "primary_model_success" | "repaired_model_response" | "provider_retry_success";
}

export class TraceAttemptsExhaustedError extends Error {
  readonly attempts: TraceClassificationAttempt[];
  readonly finalFailure: TraceAttemptFailure;
  constructor(attempts: TraceClassificationAttempt[], finalFailure: TraceAttemptFailure) {
    super("Decision Trace attempts exhausted");
    this.name = "TraceAttemptsExhaustedError";
    this.attempts = attempts;
    this.finalFailure = finalFailure;
  }
}

const retryableProviderStage = (failure: TraceAttemptFailure) => failure.retryReason === "timeout"
  || failure.retryReason === "rate_limit"
  || failure.retryReason === "provider_unavailable"
  || failure.retryReason === "connection_interruption";

export async function runBoundedTraceAttempts<T>(
  execute: (stage: TraceClassificationAttempt["stage"], attempt: number) => Promise<{ value: T; finishReason?: string; diagnostics?: TraceAttemptFailure["diagnostics"] }>,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  retryDelayMs = 250,
): Promise<TraceAttemptRun<T>> {
  const attempts: TraceClassificationAttempt[] = [];
  let stage: TraceClassificationAttempt["stage"] = "primary";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    try {
      const result = await execute(stage, attempt);
      attempts.push({ attempt, stage, startedAt, completedAt: new Date().toISOString(), status: "succeeded", finishReason: result.finishReason, latencyMs: Date.now() - started, ...result.diagnostics });
      return { value: result.value, attempts, resolution: stage === "schema_repair" ? "repaired_model_response" : stage === "provider_retry" ? "provider_retry_success" : "primary_model_success" };
    } catch (caught) {
      const failure = caught instanceof TraceAttemptFailure ? caught : new TraceAttemptFailure("provider_sdk", undefined, "connection_interruption");
      attempts.push({ attempt, stage, startedAt, completedAt: new Date().toISOString(), status: "failed", errorStage: failure.errorStage, providerStatusCode: failure.providerStatusCode, retryReason: failure.retryReason, finishReason: failure.finishReason, latencyMs: Date.now() - started, ...failure.diagnostics });
      if (attempt === 2) throw new TraceAttemptsExhaustedError(attempts, failure);
      if (failure.errorStage === "invalid_json" || failure.errorStage === "schema_validation") stage = "schema_repair";
      else if (retryableProviderStage(failure)) stage = "provider_retry";
      else throw new TraceAttemptsExhaustedError(attempts, failure);
      await wait(retryDelayMs);
    }
  }
  throw new TraceAttemptsExhaustedError(attempts, new TraceAttemptFailure("provider_sdk"));
}
