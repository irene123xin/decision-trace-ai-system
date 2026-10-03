import { DECISION_TRACE_PROMPT_VERSION, type DecisionTraceAnalysis } from "./decisionTraceClassifier.ts";
import type { AIProposition, Message, Session, TraceCandidateOutcome, TraceClassificationAttempt, TraceClassificationCode, TraceErrorStage } from "@/types";
import { TRACE_CLIENT_TIMEOUT_MS } from "./decisionTraceSessionState.ts";
import { isCompletedAssistantMessage } from "./textResponsePolicy.ts";
import { hydrateParticipantEnvelope, type RemoteSessionEnvelope } from "./remoteSessionClient.ts";
import type { ParticipantSessionDto } from "./server/sessionPayload.ts";

export interface DecisionTraceResponse {
  requestId: string;
  analysis: DecisionTraceAnalysis;
  propositions: AIProposition[];
  status: TraceClassificationCode;
  provider: string;
  modelId: string;
  promptVersion: string;
  integrationMode: "mock" | "live";
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  extractionStatus: "structured" | "raw_context_fallback" | "failed";
  extractionAttemptCount: number;
  attempts: TraceClassificationAttempt[];
  attemptCount: number;
  errorStage: TraceErrorStage;
  providerStatusCode?: number;
  retryReason?: TraceClassificationAttempt["retryReason"];
  finalResolution: "primary_model_success" | "repaired_model_response" | "provider_retry_success" | "partial_success" | "manual_review_required";
  segmentationStatus: "no_decision" | "single" | "multiple" | "uncertain" | "failed";
  segmentationEvidence: string[];
  segmentationOverflow: boolean;
  candidateOutcomes: TraceCandidateOutcome[];
}

export interface DecisionTraceFailureDiagnostics {
  attempts?: TraceClassificationAttempt[];
  attemptCount?: number;
  errorStage?: TraceErrorStage;
  providerStatusCode?: number;
  retryReason?: TraceClassificationAttempt["retryReason"];
  finalResolution?: "failed_classification";
  totalDurationMs?: number;
  extractionStatus?: "structured" | "raw_context_fallback" | "failed";
  extractionAttemptCount?: number;
  segmentationStatus?: "failed";
  segmentationEvidence?: string[];
  segmentationOverflow?: boolean;
  candidateOutcomes?: TraceCandidateOutcome[];
}

export class DecisionTraceRequestError extends Error {
  readonly code: TraceClassificationCode;
  readonly diagnostics?: DecisionTraceFailureDiagnostics;
  constructor(code: TraceClassificationCode, diagnostics?: DecisionTraceFailureDiagnostics) {
    super("Decision Trace classification failed");
    this.name = "DecisionTraceRequestError";
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

export function buildDecisionTracePayload(session: Session, participantMessage: Message, requestId: string) {
  const participantTime = new Date(participantMessage.createdAt).getTime();
  const beforeCurrent = session.messages.filter((message) => message.id !== participantMessage.id
    && (message.role === "participant" || message.role === "assistant")
    && !message.relatedImageIds?.length
    && isCompletedAssistantMessage(message)
    && (message.turn < participantMessage.turn || new Date(message.createdAt).getTime() <= participantTime));
  const participantHistory = beforeCurrent.filter((message) => message.role === "participant").slice(-4);
  const assistantHistory = beforeCurrent.filter((message) => message.role === "assistant").slice(-4);
  const recentMessages = [...participantHistory, ...assistantHistory, participantMessage]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.turn - b.turn)
    .map(({ id, role, content, createdAt, turn }) => ({ id, role, content, createdAt, turn }));
  return {
    requestId,
    sessionId: session.id,
    classifierVersion: session.studyStatus === "formal" ? session.activeFrozenClassifierVersion ?? DECISION_TRACE_PROMPT_VERSION : DECISION_TRACE_PROMPT_VERSION,
    participantMessage: { id: participantMessage.id, role: participantMessage.role, content: participantMessage.content, createdAt: participantMessage.createdAt, turn: participantMessage.turn },
    recentMessages,
    aiPropositions: (session.aiPropositions ?? []).slice(-32),
    recentDecisionUnits: session.decisions.filter((decision) => decision.participantMessageId).slice(-16).map((decision) => ({
      id: decision.id,
      summary: decision.summary,
      category: decision.currentReviewedCategory ?? decision.category,
      participantMessageId: decision.participantMessageId,
      linkedAiPropositionIds: decision.linkedAiPropositionIds ?? [],
    })),
  };
}

export async function requestDecisionTrace(session: Session, participantMessage: Message, requestId: string): Promise<RemoteSessionEnvelope> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), TRACE_CLIENT_TIMEOUT_MS);
  try {
    const response = await fetch("/api/decision-trace", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.id, participantMessageId: participantMessage.id, requestId }),
      signal: controller.signal,
    });
    const value = await response.json() as { remoteSession?: { session: ParticipantSessionDto; revision: number; updatedAt: string }; error?: TraceClassificationCode };
    if (!response.ok || !value.remoteSession) {
      throw new DecisionTraceRequestError(value.error ?? "TRACE_SCHEMA_ERROR");
    }
    return hydrateParticipantEnvelope(value.remoteSession);
  } catch (error) {
    if (error instanceof DecisionTraceRequestError) throw error;
    throw new DecisionTraceRequestError("TRACE_PROVIDER_ERROR");
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
