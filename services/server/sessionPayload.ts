import "server-only";

import type { Session } from "@/types";
import { getBoardErrors } from "@/services/boardUtils";
import { canCompleteQuestionnaireWorkflow } from "@/services/postTaskQuestionnaires";
import { getParticipantVisibleDecisions } from "@/services/decisionTraceClassifier";
import { mergeTraceClassificationRecords } from "@/services/traceClassificationMerge";

export const MAX_SESSION_PAYLOAD_BYTES = 2_000_000;

export function isSessionPayload(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Session>;
  return typeof candidate.id === "string"
    && typeof candidate.participantId === "string"
    && (candidate.condition === "A" || candidate.condition === "B")
    && typeof candidate.status === "string"
    && Array.isArray(candidate.messages)
    && Array.isArray(candidate.images)
    && Array.isArray(candidate.decisions)
    && Array.isArray(candidate.boardEvents)
    && Array.isArray(candidate.researchEvents)
    && Boolean(candidate.board && typeof candidate.board === "object");
}

export interface ParticipantSessionDto extends Omit<Session, "condition" | "decisions"> {
  traceEnabled: boolean;
  decisions: Array<{
    id: string;
    timestampSeconds: number;
    relatedTurn: number | null;
    action: Session["decisions"][number]["action"];
    source: Session["decisions"][number]["source"];
    object: Session["decisions"][number]["object"];
    summary: string;
    evidenceText?: string;
  }>;
}

export function participantSafeSession(session: Session): ParticipantSessionDto {
  const copy = structuredClone(session);
  const traceEnabled = session.condition === "B";
  const safeDecisions = traceEnabled ? getParticipantVisibleDecisions(session.decisions).map((decision) => ({
    id: decision.id,
    timestampSeconds: decision.timestampSeconds,
    relatedTurn: decision.relatedTurn,
    action: decision.finalReviewedLabel.action,
    source: decision.finalReviewedLabel.source,
    object: decision.finalReviewedLabel.object,
    summary: decision.finalReviewedLabel.summary,
    evidenceText: decision.evidenceText,
  })) : [];
  delete (copy as Partial<Session>).condition;
  delete copy.humanCoding;
  delete copy.studyStatus;
  delete copy.statusChangedAt;
  delete copy.statusChangedBy;
  delete copy.exclusionReason;
  delete copy.activeFrozenClassifierVersion;
  delete copy.assignmentMethod;
  delete copy.assignmentTimestamp;
  delete copy.assignmentBlockId;
  delete copy.assignmentPosition;
  delete copy.assignmentSequence;
  delete copy.assignmentStudyStatus;
  delete copy.brandBriefId;
  delete copy.taskGuideVersion;
  delete copy.textPromptVersion;
  delete copy.imagePromptVersion;
  copy.decisions = [];
  copy.aiPropositions = [];
  copy.traceClassifications = [];
  copy.messages = copy.messages.map(({ provider: _provider, modelId: _modelId, promptVersion: _promptVersion, integrationMode: _integrationMode, finishReason: _finishReason, ...message }) => message);
  copy.aiTextRequests = copy.aiTextRequests.map(({ provider: _provider, modelId: _modelId, promptVersion: _promptVersion, integrationMode: _integrationMode, latencyMs: _latencyMs, failureCategory: _failureCategory, finishReason: _finishReason, providerStatusCode: _providerStatusCode, attempts: _attempts, attemptCount: _attemptCount, errorStage: _errorStage, candidateCount: _candidateCount, inputTokenCount: _inputTokenCount, outputTokenCount: _outputTokenCount, finalResolution: _finalResolution, safeErrorMessage: _safeErrorMessage, ...request }) => request);
  copy.imageRequests = copy.imageRequests.map(({ effectivePrompt: _effectivePrompt, provider: _provider, model: _model, latencyMs: _latencyMs, diagnosticCode: _diagnosticCode, safeErrorMessage: _safeErrorMessage, ...request }) => request);
  copy.images = copy.images.map(({ storagePath: _storagePath, storageReference: _storageReference, byteSize: _byteSize, checksum: _checksum, ...image }) => image);
  copy.researcherId = "";
  return { ...copy, traceEnabled, decisions: safeDecisions } as ParticipantSessionDto;
}

export function mergeParticipantSession(current: Session, incoming: Session): Session {
  const incomingDecisionById = new Map(incoming.decisions.map((decision) => [decision.id, decision]));
  const decisions = current.decisions.map((stored) => {
    const candidate = incomingDecisionById.get(stored.id);
    return candidate && (candidate.classifierStatus || typeof candidate.confidenceScore === "number") ? candidate : stored;
  });
  for (const candidate of incoming.decisions) if (!decisions.some((stored) => stored.id === candidate.id) && (candidate.classifierStatus || typeof candidate.confidenceScore === "number")) decisions.push(candidate);
  const aiPropositions = incoming.aiPropositions?.length ? incoming.aiPropositions : current.aiPropositions;
  const traceClassifications = mergeTraceClassificationRecords(current.traceClassifications, incoming.traceClassifications);
  const storedTextRequestById = new Map(current.aiTextRequests.map((request) => [request.requestId, request]));
  const aiTextRequests = incoming.aiTextRequests.map((request) => {
    const stored = storedTextRequestById.get(request.requestId);
    if (!stored) return request;
    const incomingHasDiagnostics = Boolean(request.provider || request.modelId || request.attempts?.length || request.failureCategory || request.finalResolution);
    return incomingHasDiagnostics ? { ...stored, ...request } : { ...request, ...stored };
  });
  for (const stored of current.aiTextRequests) if (!aiTextRequests.some((request) => request.requestId === stored.requestId)) aiTextRequests.push(stored);
  const centrallyStoredImages = current.images.filter((image) => image.storageBackend === "supabase");
  const incomingImagesById = new Map(incoming.images.map((image) => [image.id, image]));
  const images = centrallyStoredImages.length > 0
    ? current.images.map((stored) => {
      if (stored.storageBackend !== "supabase") return incomingImagesById.get(stored.id) ?? stored;
      const participantVersion = incomingImagesById.get(stored.id);
      return participantVersion ? {
        ...participantVersion,
        id: stored.id,
        requestId: stored.requestId,
        sessionId: stored.sessionId,
        imageIndex: stored.imageIndex,
        mimeType: stored.mimeType,
        storageBackend: stored.storageBackend,
        storagePath: stored.storagePath,
        byteSize: stored.byteSize,
        checksum: stored.checksum,
        createdAt: stored.createdAt,
      } : stored;
    })
    : incoming.images;
  const centrallySucceededRequestIds = new Set(current.imageRequests.filter((request) => request.status === "succeeded").map((request) => request.requestId));
  const incomingRequestById = new Map(incoming.imageRequests.map((request) => [request.requestId, request]));
  const imageRequests = [
    ...current.imageRequests.filter((request) => centrallySucceededRequestIds.has(request.requestId)).map((request) => request),
    ...incoming.imageRequests.filter((request) => !centrallySucceededRequestIds.has(request.requestId) && request.status !== "succeeded"),
  ].filter((request, index, all) => all.findIndex((candidate) => candidate.requestId === request.requestId) === index)
    .map((request) => centrallySucceededRequestIds.has(request.requestId) ? request : incomingRequestById.get(request.requestId) ?? request);
  const protectedAssistantMessages = current.messages.filter((message) => message.role === "assistant" && message.requestId && centrallySucceededRequestIds.has(message.requestId));
  const storedMessageById = new Map(current.messages.map((message) => [message.id, message]));
  const messages = incoming.messages.map((message) => ({ ...storedMessageById.get(message.id), ...message }));
  for (const message of protectedAssistantMessages) if (!messages.some((candidate) => candidate.id === message.id || (candidate.requestId && candidate.requestId === message.requestId))) messages.push(message);
  const protectedResearchEvents = current.researchEvents.filter((event) => event.type === "ai_image_request_succeeded" && event.requestId && centrallySucceededRequestIds.has(event.requestId));
  const researchEvents = [...incoming.researchEvents];
  for (const event of protectedResearchEvents) if (!researchEvents.some((candidate) => candidate.id === event.id || (candidate.type === event.type && candidate.requestId === event.requestId))) researchEvents.push(event);
  const next: Session = {
    ...incoming,
    id: current.id,
    participantId: current.participantId,
    researcherId: current.researcherId,
    condition: current.condition,
    studyStatus: current.studyStatus,
    humanCoding: current.humanCoding,
    statusChangedAt: current.statusChangedAt,
    statusChangedBy: current.statusChangedBy,
    exclusionReason: current.exclusionReason,
    activeFrozenClassifierVersion: current.activeFrozenClassifierVersion,
    assignmentMethod: current.assignmentMethod,
    assignmentTimestamp: current.assignmentTimestamp,
    assignmentBlockId: current.assignmentBlockId,
    assignmentPosition: current.assignmentPosition,
    assignmentSequence: current.assignmentSequence,
    assignmentStudyStatus: current.assignmentStudyStatus,
    decisions,
    aiPropositions,
    traceClassifications,
    aiTextRequests,
    images,
    imageRequests,
    imageRequestCount: imageRequests.filter((request) => request.status === "succeeded").length,
    messages,
    researchEvents,
  };
  const allowedStatuses: Record<Session["status"], Session["status"][]> = {
    ready: ["ready", "briefing"],
    briefing: ["briefing", "starting_point"],
    starting_point: ["starting_point", "active"],
    active: ["active", "starting_point", "questionnaire"],
    questionnaire: ["questionnaire", "submitted"],
    ended: ["ended"],
    restarted: ["restarted"],
    submitted: ["submitted"],
  };
  if (!allowedStatuses[current.status]?.includes(next.status)) throw new Error("invalid_session_transition");
  if (current.status === "submitted" && next.status !== "submitted") return current;
  if (next.status === "ended" || next.status === "restarted") throw new Error("invalid_session_transition");
  if (next.status === "questionnaire" && (!next.finalSubmission || !next.finalSubmission.isValid || getBoardErrors(next.board).length > 0)) throw new Error("invalid_session_transition");
  if (next.status === "submitted" && (!next.postTaskQuestionnaires?.studyCompletedAt || !canCompleteQuestionnaireWorkflow(next.postTaskQuestionnaires))) throw new Error("invalid_session_transition");
  return next;
}
