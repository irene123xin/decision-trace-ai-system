import "server-only";

import { GoogleGenAI } from "@google/genai";
import {
  DECISION_CATEGORIES,
  DECISION_REASON_CODES,
  matchDecisionSource,
  ruleBasedDecisionTrace,
  type ClassifierDecisionUnit,
  type DecisionTraceAnalysis,
  type DecisionTraceContext,
} from "@/services/decisionTraceClassifier";
import { prepareDecisionTraceContext, runBoundedTraceAttempts, TraceAttemptFailure, TraceAttemptsExhaustedError } from "@/services/decisionTracePipeline";
import {
  buildReducedSchemaRepairInput,
  splitDecisionCandidateSpans,
  validateMinimalUncertain,
  validateSegmentationResult,
  type MinimalUncertainResult,
  type SegmentationResult,
} from "@/services/decisionTraceSegmentation";
import { DECISION_TRACE_PROMPT_VERSION, ELSEWHERE_DECISION_TRACE_INSTRUCTION } from "@/services/server/elsewhereDecisionTraceInstruction";
import type {
  AIProposition,
  AITextMode,
  DecisionCategory,
  DecisionReasonCode,
  DecisionSourceStatus,
  TraceCandidateOutcome,
  TraceClassificationAttempt,
  TraceClassificationCode,
  TraceErrorStage,
} from "@/types";

const STAGE_ATTEMPT_TIMEOUT_MS = 8_000;
const WORKFLOW_TIMEOUT_MS = 28_000;
const SEGMENTATION_MAX_OUTPUT_TOKENS = 220;
const UNIT_MAX_OUTPUT_TOKENS = 320;
const MAX_ATOMIC_UNITS = 3;
const TRACE_THINKING_BUDGET_TOKENS = 128;

const segmentationSchema = {
  type: "object", additionalProperties: false,
  required: ["classification_status", "spans", "overflow"],
  properties: {
    classification_status: { type: "string", enum: ["no_decision", "candidate_spans", "uncertain"] },
    spans: { type: "array", maxItems: 6, items: { type: "string", maxLength: 600 } },
    overflow: { type: "boolean" },
  },
} as const;

const unitResponseSchema = {
  type: "object", additionalProperties: false,
  required: ["classification_status", "units"],
  properties: {
    classification_status: { type: "string", enum: ["classified", "uncertain", "no_decision"] },
    units: {
      type: "array", maxItems: 1,
      items: {
        type: "object", additionalProperties: false,
        required: ["category", "evidence", "summary", "source_status", "linked_proposition_id", "source_ai_message_id", "confidence", "reason_code"],
        properties: {
          category: { type: "string", enum: ["accept", "modify", "reject", "human_initiated", "uncertain"] },
          evidence: { type: "string", maxLength: 600 },
          summary: { type: "string", maxLength: 220 },
          source_status: { type: "string", enum: ["matched_structured_proposition", "matched_raw_ai_context", "absent_from_ai_context", "source_unclear"] },
          linked_proposition_id: { anyOf: [{ type: "string" }, { type: "null" }] },
          source_ai_message_id: { anyOf: [{ type: "string" }, { type: "null" }] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          reason_code: { type: "string", enum: DECISION_REASON_CODES },
        },
      },
    },
  },
} as const;

const uncertainSchema = {
  type: "object", additionalProperties: false,
  required: ["status", "evidence", "confidence", "reason_code", "possible_reference"],
  properties: {
    status: { type: "string", enum: ["uncertain"] },
    evidence: { type: "string", maxLength: 600 },
    confidence: { type: "number", minimum: 0, maximum: 0.79 },
    reason_code: { type: "string", enum: ["unresolved_reference", "weak_commitment", "conflicting_language"] },
    possible_reference: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
} as const;

export interface DecisionTraceServiceResult {
  requestId: string;
  analysis: DecisionTraceAnalysis;
  propositions: AIProposition[];
  status: TraceClassificationCode;
  provider: string;
  modelId: string;
  promptVersion: string;
  integrationMode: AITextMode;
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

export class SafeDecisionTraceError extends Error {
  constructor(
    public readonly code: Extract<TraceClassificationCode, "TRACE_PROVIDER_ERROR" | "TRACE_SCHEMA_ERROR" | "TRACE_CONTEXT_ERROR">,
    public readonly diagnostics: {
      attempts: TraceClassificationAttempt[];
      attemptCount: number;
      errorStage: TraceErrorStage;
      providerStatusCode?: number;
      retryReason?: TraceClassificationAttempt["retryReason"];
      finalResolution: "failed_classification";
      totalDurationMs: number;
      extractionStatus: "structured" | "raw_context_fallback" | "failed";
      extractionAttemptCount: number;
      segmentationStatus?: "failed";
      segmentationEvidence?: string[];
      segmentationOverflow?: boolean;
      candidateOutcomes?: TraceCandidateOutcome[];
    } = { attempts: [], attemptCount: 0, errorStage: "configuration", finalResolution: "failed_classification", totalDurationMs: 0, extractionStatus: "failed", extractionAttemptCount: 0 },
  ) {
    super("Decision Trace classification failed");
    this.name = "SafeDecisionTraceError";
  }
}

const responseCache = new Map<string, Promise<DecisionTraceServiceResult>>();
const compact = (value: string) => value.trim().replace(/\s+/g, " ");

function getMode(): AITextMode {
  const value = process.env.AI_TEXT_MODE ?? "mock";
  if (value !== "mock" && value !== "live") throw new SafeDecisionTraceError("TRACE_CONTEXT_ERROR");
  return value;
}

function safeLog(fields: Record<string, unknown>) {
  console.info("[decision-trace]", JSON.stringify(fields));
}

function providerFailure(error: unknown): TraceAttemptFailure {
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status?: unknown }).status) : undefined;
  if (error instanceof Error && (error.name === "AbortError" || /abort|timeout/i.test(error.message))) return new TraceAttemptFailure("provider_timeout", status, "timeout");
  if (status === 429) return new TraceAttemptFailure("provider_http", status, "rate_limit");
  if (status && [500, 502, 503, 504].includes(status)) return new TraceAttemptFailure("provider_http", status, "provider_unavailable");
  if (status) return new TraceAttemptFailure("provider_http", status);
  return new TraceAttemptFailure("provider_sdk", undefined, "connection_interruption");
}

const deterministicRetryDelay = (requestId: string) => 180 + [...requestId].reduce((total, character) => total + character.charCodeAt(0), 0) % 121;

interface StructuredRun<T> {
  value: T;
  attempts: TraceClassificationAttempt[];
  resolution: "primary_model_success" | "repaired_model_response" | "provider_retry_success";
}

async function runStructured<T>(options: {
  ai: GoogleGenAI;
  modelId: string;
  requestId: string;
  semanticInput: unknown;
  schema: object;
  schemaName: string;
  schemaSummary: string;
  maxOutputTokens: number;
  workflowSignal: AbortSignal;
  validate: (value: unknown) => { value: T | null; path: string };
}): Promise<StructuredRun<T>> {
  let malformedResponse = "";
  let validationPath = "";
  return runBoundedTraceAttempts(async (stage) => {
    const controller = new AbortController();
    const abortFromWorkflow = () => controller.abort();
    options.workflowSignal.addEventListener("abort", abortFromWorkflow, { once: true });
    if (options.workflowSignal.aborted) controller.abort();
    const timeout = setTimeout(() => controller.abort(), STAGE_ATTEMPT_TIMEOUT_MS);
    try {
      const repairInput = buildReducedSchemaRepairInput(options.schemaName, malformedResponse, validationPath, options.schemaSummary);
      const response = await options.ai.models.generateContent({
        model: options.modelId,
        contents: [{ role: "user", parts: [{ text: JSON.stringify(stage === "schema_repair" ? repairInput : options.semanticInput) }] }],
        config: {
          systemInstruction: ELSEWHERE_DECISION_TRACE_INSTRUCTION,
          responseMimeType: "application/json",
          responseJsonSchema: options.schema,
          temperature: 0,
          thinkingConfig: { thinkingBudget: TRACE_THINKING_BUDGET_TOKENS, includeThoughts: false },
          maxOutputTokens: options.maxOutputTokens,
          abortSignal: controller.signal,
        },
      });
      const finishReason = response.candidates?.[0]?.finishReason;
      const raw = response.text?.trim() ?? "";
      const diagnostics = {
        candidateCount: response.candidates?.length ?? 0,
        inputTokenCount: response.usageMetadata?.promptTokenCount,
        outputTokenCount: response.usageMetadata?.candidatesTokenCount,
        responseTextPresent: Boolean(raw),
      };
      if (!raw) throw new TraceAttemptFailure("invalid_json", undefined, "schema_repair", finishReason, { ...diagnostics, validationPath: "$:empty_response" });
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch {
        malformedResponse = raw;
        validationPath = "$:invalid_json";
        throw new TraceAttemptFailure("invalid_json", undefined, "schema_repair", finishReason, { ...diagnostics, validationPath });
      }
      const checked = options.validate(parsed);
      if (!checked.value) {
        malformedResponse = raw;
        validationPath = checked.path;
        throw new TraceAttemptFailure("schema_validation", undefined, "schema_repair", finishReason, { ...diagnostics, validationPath });
      }
      return { value: checked.value, finishReason, diagnostics: { ...diagnostics, validationPath: "$:valid" } };
    } catch (error) {
      if (error instanceof TraceAttemptFailure) throw error;
      throw providerFailure(error);
    } finally {
      clearTimeout(timeout);
      options.workflowSignal.removeEventListener("abort", abortFromWorkflow);
    }
  }, undefined, deterministicRetryDelay(options.requestId));
}

function validateUnitResponse(value: unknown, evidenceSpan: string, context: DecisionTraceContext): { value: ClassifierDecisionUnit | null; path: string } {
  if (!value || typeof value !== "object") return { value: null, path: "$" };
  const response = value as Record<string, unknown>;
  if (!["classified", "uncertain", "no_decision"].includes(response.classification_status as string)) return { value: null, path: "$.classification_status" };
  if (!Array.isArray(response.units)) return { value: null, path: "$.units" };
  if (response.classification_status === "no_decision") return { value: null, path: "$.classification_status:no_decision_candidate" };
  if (response.units.length !== 1 || !response.units[0] || typeof response.units[0] !== "object") return { value: null, path: "$.units:length" };
  const item = response.units[0] as Record<string, unknown>;
  if (!DECISION_CATEGORIES.includes(item.category as DecisionCategory)) return { value: null, path: "$.units[0].category" };
  if (typeof item.evidence !== "string" || !evidenceSpan.includes(item.evidence)) return { value: null, path: "$.units[0].evidence" };
  if (typeof item.summary !== "string" || !compact(item.summary) || item.summary.length > 220) return { value: null, path: "$.units[0].summary" };
  if (!["matched_structured_proposition", "matched_raw_ai_context", "absent_from_ai_context", "source_unclear"].includes(item.source_status as string)) return { value: null, path: "$.units[0].source_status" };
  if (typeof item.confidence !== "number" || item.confidence < 0 || item.confidence > 1) return { value: null, path: "$.units[0].confidence" };
  if (!DECISION_REASON_CODES.includes(item.reason_code as DecisionReasonCode)) return { value: null, path: "$.units[0].reason_code" };

  const propositionId = typeof item.linked_proposition_id === "string" ? item.linked_proposition_id : null;
  const sourceMessageId = typeof item.source_ai_message_id === "string" ? item.source_ai_message_id : null;
  if (propositionId && !context.aiPropositions.some((proposition) => proposition.id === propositionId)) return { value: null, path: "$.units[0].linked_proposition_id" };
  if (sourceMessageId && !context.recentMessages.some((message) => message.role === "assistant" && message.id === sourceMessageId)) return { value: null, path: "$.units[0].source_ai_message_id" };

  const deterministicSource = matchDecisionSource(item.evidence, context);
  let category = item.category as DecisionCategory;
  let confidence = item.confidence;
  let reasonCode = item.reason_code as DecisionReasonCode;
  let sourceStatus = item.source_status as DecisionSourceStatus;
  const propositionIds = propositionId ? [propositionId] : deterministicSource.propositionIds;
  const messageIds = sourceMessageId ? [sourceMessageId] : deterministicSource.aiMessageIds;
  if (confidence < 0.65) {
    category = "uncertain";
    reasonCode = "unresolved_reference";
  }
  if (category === "human_initiated" && deterministicSource.status !== "absent_from_ai_context") {
    category = "uncertain";
    confidence = Math.min(confidence, 0.79);
    reasonCode = "unresolved_reference";
    sourceStatus = deterministicSource.status;
  }
  return { value: {
    category,
    summary: compact(item.summary),
    evidenceText: item.evidence,
    participantMessageId: context.participantMessage.id,
    linkedAiMessageIds: [...new Set(messageIds)],
    linkedAiPropositionIds: [...new Set(propositionIds)],
    sourceStatus,
    sourceMatchDiagnostics: deterministicSource.diagnostics,
    confidence,
    reasonCode,
    reversesDecisionUnitId: null,
    supersedesDecisionUnitId: null,
  }, path: "$:valid" };
}

function uncertainUnit(result: MinimalUncertainResult, context: DecisionTraceContext): ClassifierDecisionUnit {
  const source = matchDecisionSource(result.evidence, context);
  return {
    category: "uncertain",
    summary: result.possibleReference ? `Possible reference to ${compact(result.possibleReference)}.` : "Possible direction indicated without a resolved reference.",
    evidenceText: result.evidence,
    participantMessageId: context.participantMessage.id,
    linkedAiMessageIds: source.aiMessageIds,
    linkedAiPropositionIds: source.propositionIds,
    sourceStatus: "source_unclear",
    sourceMatchDiagnostics: source.diagnostics,
    confidence: Math.min(result.confidence, 0.79),
    reasonCode: result.reasonCode,
    reversesDecisionUnitId: null,
    supersedesDecisionUnitId: null,
  };
}

function candidateFailure(candidateId: string, evidenceText: string, error: unknown): TraceCandidateOutcome {
  if (error instanceof TraceAttemptsExhaustedError) {
    return {
      candidateId, evidenceText, status: "failed", attempts: error.attempts, attemptCount: error.attempts.length,
      errorStage: error.finalFailure.errorStage, providerStatusCode: error.finalFailure.providerStatusCode,
      retryReason: error.finalFailure.retryReason, finalResolution: "failed_classification",
      validationPath: error.finalFailure.diagnostics?.validationPath,
    };
  }
  return { candidateId, evidenceText, status: "failed", attempts: [], attemptCount: 0, errorStage: "provider_sdk", finalResolution: "failed_classification" };
}

function aggregateResolution(outcomes: TraceCandidateOutcome[]): DecisionTraceServiceResult["finalResolution"] {
  if (outcomes.some((outcome) => outcome.status === "failed" || outcome.status === "overflow")) return outcomes.some((outcome) => outcome.status === "classified" || outcome.status === "uncertain") ? "partial_success" : "manual_review_required";
  if (outcomes.some((outcome) => outcome.finalResolution === "repaired_model_response")) return "repaired_model_response";
  if (outcomes.some((outcome) => outcome.finalResolution === "provider_retry_success")) return "provider_retry_success";
  return "primary_model_success";
}

async function execute(requestId: string, input: DecisionTraceContext): Promise<DecisionTraceServiceResult> {
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const mode = getMode();
  const prepared = prepareDecisionTraceContext(input);
  const context = prepared.context;
  const propositions = context.aiPropositions;
  let analysis: DecisionTraceAnalysis;
  let provider: string;
  let modelId: string;
  let attempts: TraceClassificationAttempt[] = [];
  let segmentationStatus: DecisionTraceServiceResult["segmentationStatus"];
  let segmentationEvidence: string[] = [];
  let segmentationOverflow = false;
  let candidateOutcomes: TraceCandidateOutcome[] = [];

  if (mode === "mock") {
    analysis = ruleBasedDecisionTrace(context);
    provider = "Mock";
    modelId = "mock-decision-trace-v1";
    const completedAt = new Date().toISOString();
    attempts = [{ attempt: 1, stage: "primary", startedAt, completedAt, status: "succeeded", latencyMs: Date.now() - started }];
    segmentationEvidence = analysis.units.map((unit) => unit.evidenceText);
    segmentationStatus = analysis.analysisResult === "no_decision" ? "no_decision" : analysis.units.some((unit) => unit.category === "uncertain") ? "uncertain" : analysis.units.length > 1 ? "multiple" : "single";
    candidateOutcomes = analysis.units.map((unit, index) => ({ candidateId: `${requestId}:candidate:${index + 1}`, evidenceText: unit.evidenceText, status: unit.category === "uncertain" ? "uncertain" : "classified", attempts, attemptCount: 1, finalResolution: "primary_model_success" }));
  } else {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    modelId = process.env.GEMINI_TEXT_MODEL?.trim() ?? "";
    if (!apiKey || !modelId) throw new SafeDecisionTraceError("TRACE_CONTEXT_ERROR", { attempts: [], attemptCount: 0, errorStage: "configuration", finalResolution: "failed_classification", totalDurationMs: Date.now() - started, extractionStatus: prepared.extractionStatus, extractionAttemptCount: prepared.extractionAttemptCount });
    provider = "Google Gemini";
    const ai = new GoogleGenAI({ apiKey });
    const workflowController = new AbortController();
    const workflowTimer = setTimeout(() => workflowController.abort(), WORKFLOW_TIMEOUT_MS);
    try {
      let segmentation: SegmentationResult;
      try {
        const run = await runStructured({
          ai, modelId, requestId: `${requestId}:segment`, schema: segmentationSchema, schemaName: "segmentation",
          schemaSummary: "{classification_status:no_decision|candidate_spans|uncertain,spans:exact participant substrings[],overflow:boolean}",
          maxOutputTokens: SEGMENTATION_MAX_OUTPUT_TOKENS, workflowSignal: workflowController.signal,
          semanticInput: {
            task: "Segment only the current participant message into zero, one, or multiple atomic design-decision evidence spans. Do not assign categories. Return exact continuous substrings. Requests for options are no_decision. Vague unresolved references are uncertain.",
            participant_message: context.participantMessage.content,
            maximum_spans: MAX_ATOMIC_UNITS,
          },
          validate: (value) => {
            const checked = validateSegmentationResult(value, context.participantMessage.content, MAX_ATOMIC_UNITS);
            return { value: checked, path: checked ? "$:valid" : "$.classification_status|spans" };
          },
        });
        segmentation = run.value;
        attempts.push(...run.attempts);
      } catch (error) {
        const fallback = splitDecisionCandidateSpans(context.participantMessage.content, MAX_ATOMIC_UNITS);
        if (fallback.spans.length > 1) {
          segmentation = fallback;
          if (error instanceof TraceAttemptsExhaustedError) attempts.push(...error.attempts);
        } else {
          const exhausted = error instanceof TraceAttemptsExhaustedError ? error : null;
          throw new SafeDecisionTraceError(exhausted?.finalFailure.errorStage === "invalid_json" || exhausted?.finalFailure.errorStage === "schema_validation" ? "TRACE_SCHEMA_ERROR" : "TRACE_PROVIDER_ERROR", {
            attempts: exhausted?.attempts ?? [], attemptCount: exhausted?.attempts.length ?? 0,
            errorStage: exhausted?.finalFailure.errorStage ?? "provider_sdk", providerStatusCode: exhausted?.finalFailure.providerStatusCode,
            retryReason: exhausted?.finalFailure.retryReason, finalResolution: "failed_classification", totalDurationMs: Date.now() - started,
            extractionStatus: prepared.extractionStatus, extractionAttemptCount: prepared.extractionAttemptCount,
            segmentationStatus: "failed", segmentationEvidence: [], segmentationOverflow: false, candidateOutcomes: [],
          });
        }
      }

      segmentationEvidence = segmentation.spans;
      segmentationOverflow = segmentation.overflow;
      segmentationStatus = segmentation.classificationStatus === "no_decision" ? "no_decision" : segmentation.classificationStatus === "uncertain" ? "uncertain" : segmentation.spans.length > 1 ? "multiple" : "single";

      if (segmentation.classificationStatus === "no_decision") {
        analysis = { analysisResult: "no_decision", units: [] };
      } else if (segmentation.classificationStatus === "uncertain") {
        const evidence = segmentation.spans[0] ?? context.participantMessage.content;
        try {
          const run = await runStructured({
            ai, modelId, requestId: `${requestId}:uncertain`, schema: uncertainSchema, schemaName: "uncertain",
            schemaSummary: "{status:uncertain,evidence:exact substring,confidence:0..0.79,reason_code:unresolved_reference|weak_commitment|conflicting_language,possible_reference:string|null}",
            maxOutputTokens: SEGMENTATION_MAX_OUTPUT_TOKENS, workflowSignal: workflowController.signal,
            semanticInput: { task: "Record this ambiguous candidate using the minimal uncertain schema.", participant_message: context.participantMessage.content, candidate_evidence: evidence },
            validate: (value) => { const checked = validateMinimalUncertain(value, context.participantMessage.content); return { value: checked, path: checked ? "$:valid" : "$.uncertain" }; },
          });
          attempts.push(...run.attempts);
          const unit = uncertainUnit(run.value, context);
          analysis = { analysisResult: "decision_units", units: [unit] };
          candidateOutcomes = [{ candidateId: `${requestId}:candidate:1`, evidenceText: unit.evidenceText, status: "uncertain", attempts: run.attempts, attemptCount: run.attempts.length, finalResolution: run.resolution }];
        } catch (error) {
          const failed = candidateFailure(`${requestId}:candidate:1`, evidence, error);
          attempts.push(...failed.attempts);
          candidateOutcomes = [failed];
          analysis = { analysisResult: "no_decision", units: [] };
        }
      } else {
        const candidateRuns = segmentation.spans.map(async (evidence, index) => {
          const candidateId = `${requestId}:candidate:${index + 1}`;
          const source = matchDecisionSource(evidence, context);
          try {
            const run = await runStructured({
              ai, modelId, requestId: candidateId, schema: unitResponseSchema, schemaName: "atomic unit",
              schemaSummary: "{classification_status:classified|uncertain|no_decision,units:[{category,evidence,summary,source_status,linked_proposition_id|null,source_ai_message_id|null,confidence,reason_code}]}",
              maxOutputTokens: UNIT_MAX_OUTPUT_TOKENS, workflowSignal: workflowController.signal,
              semanticInput: {
                task: "Classify exactly this one atomic candidate span. Return no more than one unit.",
                participant_message: context.participantMessage.content,
                candidate_evidence: evidence,
                recent_ai_propositions: context.aiPropositions,
                raw_recent_ai_context: context.recentMessages.filter((message) => message.role === "assistant").map(({ id, content }) => ({ id, content })),
                deterministic_source_check: source,
              },
              validate: (value) => validateUnitResponse(value, evidence, context),
            });
            return { unit: run.value, outcome: { candidateId, evidenceText: evidence, status: run.value.category === "uncertain" ? "uncertain" : "classified", attempts: run.attempts, attemptCount: run.attempts.length, finalResolution: run.resolution } satisfies TraceCandidateOutcome };
          } catch (error) {
            return { unit: null, outcome: candidateFailure(candidateId, evidence, error) };
          }
        });
        const settled = await Promise.all(candidateRuns);
        const units = settled.flatMap((item) => item.unit ? [item.unit] : []);
        candidateOutcomes = settled.map((item) => item.outcome);
        if (segmentation.overflow) candidateOutcomes.push({ candidateId: `${requestId}:overflow`, evidenceText: "Additional candidate spans require manual review.", status: "overflow", attempts: [], attemptCount: 0, finalResolution: "manual_review_required" });
        attempts.push(...candidateOutcomes.flatMap((outcome) => outcome.attempts));
        analysis = { analysisResult: units.length ? "decision_units" : "no_decision", units };
      }
    } finally {
      clearTimeout(workflowTimer);
    }
  }

  const completedAt = new Date().toISOString();
  const latencyMs = Date.now() - started;
  const hasCandidateFailure = candidateOutcomes.some((outcome) => outcome.status === "failed" || outcome.status === "overflow");
  const status: TraceClassificationCode = hasCandidateFailure || analysis.units.some((unit) => unit.category === "uncertain" || unit.confidence < 0.8)
    ? "TRACE_NEEDS_REVIEW"
    : analysis.analysisResult === "no_decision" ? "TRACE_NO_DECISION" : "TRACE_CLASSIFIED";
  const finalResolution = aggregateResolution(candidateOutcomes);
  safeLog({
    requestId, sessionId: input.sessionId, participantMessageId: input.participantMessage.id, elapsedMs: latencyMs,
    status, unitCount: analysis.units.length, provider, modelId, attemptCount: attempts.length, finalResolution,
    extractionStatus: prepared.extractionStatus, segmentationStatus, segmentationOverflow,
    candidateOutcomes: candidateOutcomes.map((outcome) => ({ candidateId: outcome.candidateId, status: outcome.status, attemptCount: outcome.attemptCount, errorStage: outcome.errorStage, providerStatusCode: outcome.providerStatusCode, retryReason: outcome.retryReason, validationPath: outcome.validationPath })),
    attempts: attempts.map((attempt) => ({ attempt: attempt.attempt, stage: attempt.stage, status: attempt.status, errorStage: attempt.errorStage, providerStatusCode: attempt.providerStatusCode, retryReason: attempt.retryReason, finishReason: attempt.finishReason, latencyMs: attempt.latencyMs, candidateCount: attempt.candidateCount, inputTokenCount: attempt.inputTokenCount, outputTokenCount: attempt.outputTokenCount, responseTextPresent: attempt.responseTextPresent, validationPath: attempt.validationPath })),
    units: analysis.units.map((unit) => ({ category: unit.category, confidence: unit.confidence, sourceStatus: unit.sourceStatus, reasonCode: unit.reasonCode, linkedAiMessageIds: unit.linkedAiMessageIds, linkedAiPropositionIds: unit.linkedAiPropositionIds })),
  });
  return {
    requestId, analysis, propositions, status, provider, modelId, promptVersion: DECISION_TRACE_PROMPT_VERSION,
    integrationMode: mode, startedAt, completedAt, latencyMs, extractionStatus: prepared.extractionStatus,
    extractionAttemptCount: prepared.extractionAttemptCount, attempts, attemptCount: attempts.length,
    errorStage: "none", retryReason: attempts.find((attempt) => attempt.retryReason)?.retryReason,
    finalResolution, segmentationStatus, segmentationEvidence, segmentationOverflow, candidateOutcomes,
  };
}

export function requestDecisionTraceClassification(requestId: string, context: DecisionTraceContext): Promise<DecisionTraceServiceResult> {
  const existing = responseCache.get(requestId);
  if (existing) return existing;
  const pending = execute(requestId, context).catch((error) => {
    responseCache.delete(requestId);
    const code = error instanceof SafeDecisionTraceError ? error.code : "TRACE_PROVIDER_ERROR";
    const diagnostics = error instanceof SafeDecisionTraceError ? error.diagnostics : undefined;
    safeLog({ requestId, sessionId: context.sessionId, participantMessageId: context.participantMessage.id, status: code, unitCount: 0, ...diagnostics });
    throw error;
  });
  responseCache.set(requestId, pending);
  return pending;
}
