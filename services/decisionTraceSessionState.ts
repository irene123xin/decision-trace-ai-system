import { createDecisionIdempotencyKey, deduplicateAiPropositions } from "./decisionTraceClassifier.ts";
import type { DecisionTraceResponse } from "./decisionTraceService.ts";
import type { Confidence, DecisionAction, DecisionCategory, DecisionObject, DecisionSource, DecisionUnit, Message, Session, TraceClassificationCode } from "@/types";

export const TRACE_CLIENT_TIMEOUT_MS = 40_000;
export const TRACE_PENDING_EXPIRY_MS = 45_000;

const categoryAction: Record<DecisionCategory, DecisionAction> = {
  accept: "Accept", modify: "Modify", reject: "Reject", human_initiated: "Human-initiated", uncertain: "Uncertain",
};

const categorySource: Record<DecisionCategory, DecisionSource> = {
  accept: "AI-initiated", modify: "Mixed", reject: "AI-initiated", human_initiated: "Human-initiated", uncertain: "Unclear",
};

function inferTraceObject(text: string): DecisionObject {
  const value = text.toLowerCase();
  if (/concept|idea|metaphor|position/.test(value)) return "Brand concept";
  if (/keyword/.test(value)) return "Keywords";
  if (/personality|trait|character/.test(value)) return "Brand personality";
  if (/audience|young adult|need/.test(value)) return "Audience interpretation";
  if (/colou?r|palette|beige|monochrome|saturation|mineral/.test(value)) return "Colour palette";
  if (/typograph|typeface|font|serif|sans|wordmark/.test(value)) return "Typography";
  if (/logo|symbol|mark|circle|bottle|map|ticket|coordinate/.test(value)) return "Logo or symbol";
  if (/tone|voice|speak|language/.test(value)) return "Tone of voice";
  if (/image|visual|mood|photo|texture|material|imagery|collage/.test(value)) return "Visual style";
  return "Other";
}

function nextDecisionNumber(decisions: DecisionUnit[]): number {
  const values = decisions.map((decision) => Number(decision.id.replace(/\D/g, ""))).filter(Number.isFinite);
  return Math.max(0, ...values) + 1;
}

export function applyTraceClassificationResponse(
  current: Session,
  participantMessage: Message,
  requestId: string,
  response: DecisionTraceResponse,
  taskStartedAt: string,
): Session {
  const existingKeys = new Set(current.decisions.map((decision) => decision.idempotencyKey).filter(Boolean));
  let nextNumber = nextDecisionNumber(current.decisions);
  const added: DecisionUnit[] = [];

  for (const classified of response.analysis.units) {
    const key = createDecisionIdempotencyKey(current.id, participantMessage.id, classified.summary, classified.category, classified.linkedAiPropositionIds);
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    const action = categoryAction[classified.category];
    const source = categorySource[classified.category];
    const object = inferTraceObject(`${classified.summary} ${classified.evidenceText}`);
    const confidence: Confidence = classified.confidence >= 0.8 ? "High" : classified.confidence >= 0.65 ? "Medium" : "Low";
    const label = { action, source, object, summary: classified.summary };
    added.push({
      id: `D${String(nextNumber).padStart(2, "0")}`,
      timestampSeconds: Math.max(0, Math.floor((new Date(participantMessage.createdAt).getTime() - new Date(taskStartedAt).getTime()) / 1000)),
      relatedTurn: participantMessage.turn,
      confidence,
      modelGeneratedLabel: `${action} · ${source} · ${object}`,
      reviewStatus: "Unreviewed",
      ...label,
      originalModelLabel: { ...label },
      finalReviewedLabel: { ...label },
      category: classified.category,
      originalModelCategory: classified.category,
      currentReviewedCategory: classified.category,
      evidenceText: classified.evidenceText,
      participantMessageId: participantMessage.id,
      linkedAiMessageIds: classified.linkedAiMessageIds,
      linkedAiPropositionIds: classified.linkedAiPropositionIds,
      sourceStatus: classified.sourceStatus,
      sourceMatchDiagnostics: classified.sourceMatchDiagnostics,
      classificationRequestId: requestId,
      confidenceScore: classified.confidence,
      reasonCode: classified.reasonCode,
      reversesDecisionUnitId: classified.reversesDecisionUnitId,
      supersedesDecisionUnitId: classified.supersedesDecisionUnitId,
      idempotencyKey: key,
      classifierStatus: response.status,
      classifierPromptVersion: response.promptVersion,
      classifierProvider: response.provider,
      classifierModelId: response.modelId,
      classifierIntegrationMode: response.integrationMode,
      participantFacingLabel: action === "Human-initiated" ? "New Direction" : action,
      visibilityStatus: classified.confidence >= 0.8 && classified.category !== "uncertain" ? "participant_visible" : classified.confidence >= 0.65 ? "researcher_review" : "hidden_uncertain",
      classifiedAt: response.completedAt,
    });
    nextNumber += 1;
  }

  const status: TraceClassificationCode = response.analysis.analysisResult === "decision_units" && response.analysis.units.length > 0 && added.length === 0
    ? "TRACE_DUPLICATE_SKIPPED"
    : response.status;
  const traceClassifications = (current.traceClassifications ?? []).map((record) => record.requestId === requestId ? {
    ...record,
    completedAt: response.completedAt,
    status,
    analysisResult: response.analysis.analysisResult,
    classifierPromptVersion: response.promptVersion,
    provider: response.provider,
    modelId: response.modelId,
    latencyMs: response.latencyMs,
    unitIds: added.map((item) => item.id),
    propositionIds: response.propositions.map((item) => item.id),
    safeErrorMessage: undefined,
    extractionStatus: response.extractionStatus,
    extractionAttemptCount: response.extractionAttemptCount,
    attempts: response.attempts,
    attemptCount: response.attemptCount,
    errorStage: response.errorStage,
    providerStatusCode: response.providerStatusCode,
    retryReason: response.retryReason,
    finalResolution: response.finalResolution,
    totalDurationMs: response.latencyMs,
    segmentationStatus: response.segmentationStatus,
    segmentationEvidence: response.segmentationEvidence,
    segmentationOverflow: response.segmentationOverflow,
    candidateOutcomes: (response.candidateOutcomes ?? []).map((outcome) => ({
      ...outcome,
      decisionUnitId: added.find((decision) => decision.evidenceText === outcome.evidenceText)?.id,
    })),
  } : record);

  return {
    ...current,
    decisions: [...current.decisions, ...added],
    aiPropositions: deduplicateAiPropositions([...(current.aiPropositions ?? []), ...response.propositions]),
    traceClassifications,
  };
}

export function applyTraceClassificationFailure(current: Session, requestId: string, code: TraceClassificationCode, completedAt = new Date().toISOString(), diagnostics?: Partial<Pick<NonNullable<Session["traceClassifications"]>[number], "attempts" | "attemptCount" | "errorStage" | "providerStatusCode" | "retryReason" | "finalResolution" | "totalDurationMs" | "extractionStatus" | "extractionAttemptCount" | "segmentationStatus" | "segmentationEvidence" | "segmentationOverflow" | "candidateOutcomes">>): Session {
  return {
    ...current,
    traceClassifications: (current.traceClassifications ?? []).map((record) => record.requestId === requestId ? {
      ...record,
      completedAt,
      status: code,
      safeErrorMessage: "Classification did not complete.",
      finalResolution: "failed_classification",
      totalDurationMs: Math.max(0, new Date(completedAt).getTime() - new Date(record.startedAt).getTime()),
      ...diagnostics,
    } : record),
  };
}

export function expirePendingTraceClassifications(current: Session, now = Date.now(), expiryMs = TRACE_PENDING_EXPIRY_MS): Session {
  let changed = false;
  const traceClassifications = (current.traceClassifications ?? []).map((record) => {
    if (record.status !== "TRACE_CLASSIFICATION_PENDING" || now - new Date(record.startedAt).getTime() < expiryMs) return record;
    changed = true;
    return { ...record, completedAt: new Date(now).toISOString(), status: "TRACE_PROVIDER_ERROR" as const, safeErrorMessage: "Classification did not complete." };
  });
  return changed ? { ...current, traceClassifications } : current;
}

export function hasActiveTraceClassification(session: Session, now = Date.now(), expiryMs = TRACE_PENDING_EXPIRY_MS): boolean {
  return (session.traceClassifications ?? []).some((record) => record.status === "TRACE_CLASSIFICATION_PENDING" && now - new Date(record.startedAt).getTime() < expiryMs);
}
