"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BriefPanel } from "@/components/BriefPanel";
import { ChatPanel } from "@/components/ChatPanel";
import { DecisionTrace } from "@/components/DecisionTrace";
import { GeneratedVisuals } from "@/components/GeneratedVisuals";
import { FinalReviewSummary } from "@/components/FinalReviewSummary";
import { TaskGuideContent } from "@/components/TaskGuideContent";
import { WorkingBoard } from "@/components/WorkingBoard";
import { requestChatResponse, ChatRequestError } from "@/services/chatService";
import { ImageRequestError, requestGeneratedImages } from "@/services/imageService";
import { requestDecisionTrace, DecisionTraceRequestError } from "@/services/decisionTraceService";
import { DECISION_TRACE_PROMPT_VERSION } from "@/services/decisionTraceClassifier";
import { getConversationAllowanceCount } from "@/services/conversationAllowance";
import { isTransientChatFailure } from "@/services/chatAttemptPolicy";
import { applyTraceClassificationFailure, expirePendingTraceClassifications, hasActiveTraceClassification } from "@/services/decisionTraceSessionState";
import { getBoardErrors, getBoardProgress, reconcileImageSectionConfirmations } from "@/services/boardUtils";
import { DEFAULT_IMAGE_REQUEST_LIMIT, DEFAULT_IMAGE_TOTAL_LIMIT, DEFAULT_IMAGES_PER_REQUEST, ELSEWHERE_IMAGE_PROMPT_VERSION, PARTICIPANT_MESSAGE_LIMIT } from "@/data/experiment";
import { createPostTaskQuestionnaires } from "@/services/postTaskQuestionnaires";
import type { SaveStatus } from "@/services/remoteSessionClient";
import type { AITextFailureCategory, AITextRequest, BoardInteractionEvent, BoardSectionId, DecisionAction, DecisionObject, DecisionSource, FinalDirectionBoard, GeneratedImage, ImageDiagnosticCode, ImageErrorCode, ImageRequestRecord, ImageUsageTarget, Message, ResearchEvent, ResearchEventType, Session, TraceClassificationRecord } from "@/types";

interface Props {
  session: Session;
  onChange: (session: Session) => void;
  onUpdate: (updater: (current: Session) => Session) => Session | null;
  onCriticalChange?: (session: Session) => Promise<boolean>;
  onRemoteCommit?: (envelope: { session: Session; revision: number; updatedAt: string }) => void;
  saveStatus?: SaveStatus;
}
type View = "studio" | "brief" | "conversation" | "visuals" | "board" | "review";

interface BoardEventOptions {
  action?: DecisionAction;
  source?: DecisionSource;
  relatedImageId?: string;
  eventType?: BoardInteractionEvent["eventType"];
  beforeValue?: unknown;
  afterValue?: unknown;
}

function WorkspaceStatus({ board, onOpenGuide }: { board: FinalDirectionBoard; onOpenGuide: () => void }) {
  const progress = getBoardProgress(board);
  return <section className="workspaceStatus"><p className="eyebrow">TASK PROGRESS</p><div><span>Required direction</span><strong>{progress.requiredComplete} / 8</strong></div><div><span>Supporting areas</span><strong>{progress.supportingComplete} / 3</strong></div><button type="button" onClick={onOpenGuide}>Open task guide →</button></section>;
}

export function ParticipantWorkspace({ session, onChange, onUpdate, onCriticalChange, onRemoteCommit, saveStatus = "idle" }: Props) {
  const latestSession = useRef(session);
  const requestPending = useRef(false);
  const manualRetryFailures = useRef<Record<string, number>>({});
  const [view, setView] = useState<View>("studio");
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(() => session.aiTextRequests.at(-1)?.status === "failed" ? "The AI assistant is currently unavailable." : "");
  const [failedRequestId, setFailedRequestId] = useState<string | null>(null);
  const [retryCooldownUntil, setRetryCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [guideOpen, setGuideOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [boardSectionTarget, setBoardSectionTarget] = useState<BoardSectionId>("concept");
  const participantTurnCount = session.messages.filter((message) => message.role === "participant").length;
  const userMessageCount = getConversationAllowanceCount(session);
  const imageRequestLimit = session.configuredImageRequestLimit ?? DEFAULT_IMAGE_REQUEST_LIMIT;
  const imageTotalLimit = session.configuredImageTotalLimit ?? DEFAULT_IMAGE_TOTAL_LIMIT;
  const imagesPerRequest = session.configuredImagesPerRequest ?? DEFAULT_IMAGES_PER_REQUEST;
  const successfulImageRequests = session.imageRequests.filter((request) => request.status === "succeeded").length || session.imageRequestCount;
  const remainingImages = Math.max(0, imageTotalLimit - session.images.length);
  const remainingRequests = Math.max(0, imageRequestLimit - successfulImageRequests);
  const taskStartedAt = session.participantStartedAt ?? session.startedAt;
  const elapsedSeconds = Math.max(0, Math.floor((now - new Date(taskStartedAt).getTime()) / 1000));
  const remainingSeconds = Math.max(0, session.taskDurationMinutes * 60 - elapsedSeconds);
  const suggestedTimeEnded = elapsedSeconds >= session.taskDurationMinutes * 60;
  const timer = `${String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:${String(remainingSeconds % 60).padStart(2, "0")}`;
  const boardProgress = useMemo(() => getBoardProgress(session.board), [session.board]);

  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  useEffect(() => {
    if (latestSession.current.id !== session.id) latestSession.current = session;
  }, [session]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [session.id, view]);
  const nextTurn = participantTurnCount + 1;
  const latestStoredRequest = session.aiTextRequests.at(-1);
  const retryRequestId = failedRequestId ?? (latestStoredRequest?.status === "failed" ? latestStoredRequest.requestId : null);

  const saveSession = (next: Session) => {
    latestSession.current = next;
    onChange(next);
    return next;
  };

  const updateLatestSession = (updater: (current: Session) => Session) => {
    const next = onUpdate(updater);
    if (next) latestSession.current = next;
    return next;
  };

  useEffect(() => {
    updateLatestSession((current) => expirePendingTraceClassifications(current));
  // Reconcile expired pending classifications when the session workspace mounts
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  const appendAIResearchEvent = (base: Session, type: ResearchEventType, summary: string, requestId: string, failureCategory?: AITextFailureCategory) => {
    const event: ResearchEvent = {
      id: `RE${String(base.researchEvents.length + 1).padStart(2, "0")}`,
      type,
      summary,
      actor: "system",
      createdAt: new Date().toISOString(),
      timestampSeconds: elapsedSeconds,
      requestId,
      failureCategory,
    };
    return { ...base, researchEvents: [...base.researchEvents, event] };
  };

  const recordResearchEvent = (type: ResearchEventType, summary: string, base = latestSession.current, actor: "participant" | "researcher" | "system" = "participant") => {
    const event = { id: `RE${String(base.researchEvents.length + 1).padStart(2, "0")}`, type, summary, actor, createdAt: new Date().toISOString(), timestampSeconds: elapsedSeconds };
    const next = { ...base, researchEvents: [...base.researchEvents, event] };
    latestSession.current = next;
    onChange(next);
    return next;
  };

  useEffect(() => {
    if (!suggestedTimeEnded || session.status !== "active" || session.suggestedTimeReachedAt || session.researchEvents.some((event) => event.type === "suggested_time_reached") || latestSession.current.suggestedTimeReachedAt || latestSession.current.researchEvents.some((event) => event.type === "suggested_time_reached")) return;
    const reachedAt = new Date().toISOString();
    const base = { ...latestSession.current, suggestedTimeReachedAt: reachedAt };
    const event = { id: `RE${String(base.researchEvents.length + 1).padStart(2, "0")}`, type: "suggested_time_reached" as const, summary: "The configured suggested task duration was reached.", actor: "system" as const, createdAt: reachedAt, timestampSeconds: elapsedSeconds };
    const next = { ...base, researchEvents: [...base.researchEvents, event] };
    latestSession.current = next;
    onChange(next);
  }, [elapsedSeconds, onChange, suggestedTimeEnded, session.status, session.suggestedTimeReachedAt, session.researchEvents]);

  const runTraceClassification = async (requestId: string, participantMessage: Message, contextSession: Session) => {
    try {
      const response = await requestDecisionTrace(contextSession, participantMessage, requestId);
      latestSession.current = response.session;
      onRemoteCommit?.(response);
    } catch (caught) {
      const code = caught instanceof DecisionTraceRequestError ? caught.code : "TRACE_PROVIDER_ERROR";
      const diagnostics = caught instanceof DecisionTraceRequestError ? caught.diagnostics : undefined;
      updateLatestSession((current) => applyTraceClassificationFailure(current, requestId, code, new Date().toISOString(), diagnostics));
    }
  };

  const recordBoardEvent = (object: DecisionObject, summary: string, options: BoardEventOptions = {}, base = latestSession.current) => {
    const action = options.action ?? "Human-initiated";
    const boardEvent: BoardInteractionEvent = {
      id: `BE${String(base.boardEvents.length + 1).padStart(2, "0")}`,
      createdAt: new Date().toISOString(), timestampSeconds: elapsedSeconds, object, action, summary,
      eventType: options.eventType, beforeValue: options.beforeValue, afterValue: options.afterValue, relatedImageId: options.relatedImageId,
    };
    const next = { ...base, boardEvents: [...base.boardEvents, boardEvent] };
    latestSession.current = next;
    onChange(next);
  };

  const runTextRequest = async (request: AITextRequest, messages: Message[]) => {
    try {
      const response = await requestChatResponse(latestSession.current.id, request.requestId, messages);
      const base = latestSession.current;
      const assistant: Message = {
        id: `M${String(base.messages.length + 1).padStart(2, "0")}`,
        role: "assistant",
        content: response.content,
        turn: request.turn,
        createdAt: response.completedAt,
        provider: response.provider,
        modelId: response.modelId,
        promptVersion: response.promptVersion,
        integrationMode: response.integrationMode,
        requestId: response.requestId,
        finishReason: response.finishReason,
      };
      const updatedRequests = base.aiTextRequests.map((item) => item.requestId === request.requestId ? {
        ...item,
        serverStartedAt: response.startedAt,
        completedAt: response.completedAt,
        status: "succeeded" as const,
        provider: response.provider,
        modelId: response.modelId,
        promptVersion: response.promptVersion,
        integrationMode: response.integrationMode,
        latencyMs: response.latencyMs,
        failureCategory: undefined,
        finishReason: response.finishReason,
        attempts: response.attempts,
        attemptCount: response.attemptCount,
        candidateCount: response.candidateCount,
        inputTokenCount: response.inputTokenCount,
        outputTokenCount: response.outputTokenCount,
        finalResolution: response.finalResolution,
        errorStage: undefined,
        safeErrorMessage: undefined,
      } : item);
      const succeeded = appendAIResearchEvent({ ...base, messages: [...base.messages, assistant], aiTextRequests: updatedRequests }, "ai_text_request_succeeded", "AI text request completed successfully.", request.requestId);
      if (onCriticalChange) {
        latestSession.current = succeeded;
        if (!(await onCriticalChange(succeeded))) throw new ChatRequestError("connection_interruption");
      } else saveSession(succeeded);
      setFailedRequestId(null);
      delete manualRetryFailures.current[request.participantMessageId];
      setRetryCooldownUntil(0);
      setError("");
    } catch (caught) {
      const category = caught instanceof ChatRequestError ? caught.category : "unknown";
      const finishReason = caught instanceof ChatRequestError ? caught.finishReason : undefined;
      const providerStatusCode = caught instanceof ChatRequestError ? caught.providerStatusCode : undefined;
      const diagnostics = caught instanceof ChatRequestError ? caught.diagnostics : {};
      const base = latestSession.current;
      const completedAt = new Date().toISOString();
      const updatedRequests = base.aiTextRequests.map((item) => item.requestId === request.requestId ? {
        ...item,
        completedAt,
        status: "failed" as const,
        failureCategory: category,
        latencyMs: Math.max(0, Date.now() - new Date(item.startedAt).getTime()),
        finishReason,
        providerStatusCode,
        attempts: diagnostics.attempts,
        attemptCount: diagnostics.attempts?.length,
        errorStage: diagnostics.errorStage,
        candidateCount: diagnostics.candidateCount,
        inputTokenCount: diagnostics.inputTokenCount,
        outputTokenCount: diagnostics.outputTokenCount,
        finalResolution: diagnostics.finalResolution,
        safeErrorMessage: diagnostics.safeErrorMessage,
      } : item);
      const failed = appendAIResearchEvent({ ...base, aiTextRequests: updatedRequests }, "ai_text_request_failed", "AI text request did not complete.", request.requestId, category);
      if (onCriticalChange) {
        latestSession.current = failed;
        await onCriticalChange(failed);
      } else saveSession(failed);
      setFailedRequestId(request.requestId);
      if (request.retryOfRequestId) {
        const failures = (manualRetryFailures.current[request.participantMessageId] ?? 0) + 1;
        manualRetryFailures.current[request.participantMessageId] = failures;
        if (failures >= 2) setRetryCooldownUntil(Date.now() + 10_000);
      }
      setError(isTransientChatFailure(category) ? "The AI assistant is temporarily unavailable. Please try again in a moment." : "The AI assistant is currently unavailable.");
    } finally {
      requestPending.current = false;
      setIsLoading(false);
    }
  };

  const send = async (prompt: string) => {
    if (requestPending.current) return;
    if (userMessageCount >= PARTICIPANT_MESSAGE_LIMIT) { setError(`The ${PARTICIPANT_MESSAGE_LIMIT}-message task limit has been reached.`); return; }
    requestPending.current = true;
    setError(""); setIsLoading(true);
    setFailedRequestId(null);
    const base = latestSession.current;
    const startedAt = new Date().toISOString();
    const requestId = crypto.randomUUID();
    const traceRequestId = `trace-${crypto.randomUUID()}`;
    const userMessage: Message = { id: `M${String(base.messages.length + 1).padStart(2, "0")}`, role: "participant", content: prompt.trim(), turn: nextTurn, createdAt: startedAt };
    const request: AITextRequest = { requestId, participantMessageId: userMessage.id, turn: nextTurn, startedAt, status: "started" };
    const traceRecord: TraceClassificationRecord = {
      requestId: traceRequestId,
      participantMessageId: userMessage.id,
      startedAt,
      status: "TRACE_CLASSIFICATION_PENDING",
      classifierPromptVersion: DECISION_TRACE_PROMPT_VERSION,
      unitIds: [],
      propositionIds: [],
    };
    const interim = appendAIResearchEvent({
      ...base,
      messages: [...base.messages, userMessage],
      aiTextRequests: [...base.aiTextRequests, request],
      traceClassifications: [...(base.traceClassifications ?? []), traceRecord],
    }, "ai_text_request_started", "AI text request started.", requestId);
    saveSession(interim);
    if (onCriticalChange && !(await onCriticalChange(interim))) {
      requestPending.current = false;
      setIsLoading(false);
      setError("The session could not be saved. Please refresh before continuing.");
      return;
    }
    await runTextRequest(request, interim.messages);
    requestPending.current = true;
    await runTraceClassification(traceRequestId, userMessage, latestSession.current);
    requestPending.current = false;
  };

  const retryTextRequest = async () => {
    if (requestPending.current || !retryRequestId || Date.now() < retryCooldownUntil) return;
    const base = latestSession.current;
    const failedRequest = base.aiTextRequests.find((item) => item.requestId === retryRequestId && item.status === "failed");
    if (!failedRequest) return;
    const participantMessage = base.messages.find((message) => message.id === failedRequest.participantMessageId);
    if (!participantMessage) return;
    requestPending.current = true;
    setError(""); setIsLoading(true);
    const requestId = crypto.randomUUID();
    const request: AITextRequest = {
      requestId,
      participantMessageId: participantMessage.id,
      turn: participantMessage.turn,
      startedAt: new Date().toISOString(),
      status: "started",
      retryOfRequestId: failedRequest.requestId,
    };
    let next = appendAIResearchEvent(base, "ai_text_request_retried", "Participant retried an AI text request.", requestId);
    next = appendAIResearchEvent({ ...next, aiTextRequests: [...next.aiTextRequests, request] }, "ai_text_request_started", "AI text retry request started.", requestId);
    saveSession(next);
    await runTextRequest(request, next.messages);
  };

  const appendImageResearchEvent = (base: Session, type: ResearchEventType, summary: string, requestId: string, imageErrorCode?: ImageErrorCode, imageDiagnosticCode?: ImageDiagnosticCode) => {
    const event: ResearchEvent = {
      id: `RE${String(base.researchEvents.length + 1).padStart(2, "0")}`,
      type, summary, actor: "system", createdAt: new Date().toISOString(), timestampSeconds: elapsedSeconds, requestId, imageErrorCode, imageDiagnosticCode,
    };
    return { ...base, researchEvents: [...base.researchEvents, event] };
  };

  const runImageRequest = async (request: ImageRequestRecord) => {
    try {
      const base = latestSession.current;
      const response = await requestGeneratedImages({
        requestId: request.requestId,
        sessionId: base.id,
        promptText: request.promptText,
      });
      latestSession.current = response.remoteSession.session;
      onRemoteCommit?.(response.remoteSession);
      setError("");
      setView("visuals");
    } catch (caught) {
      const code: ImageErrorCode = caught instanceof ImageRequestError ? caught.code : "IMAGE_STORAGE_ERROR";
      const diagnosticCode: ImageDiagnosticCode | undefined = caught instanceof ImageRequestError ? caught.diagnosticCode : "REMOTE_IMAGE_STORAGE_ERROR";
      const current = latestSession.current;
      const completedAt = new Date().toISOString();
      const failedRequest: ImageRequestRecord = {
        ...request,
        completedAt,
        returnedImageCount: 0,
        status: "failed",
        imageIds: [],
        errorCode: code,
        diagnosticCode,
        safeErrorMessage: code === "IMAGE_LIMIT_REACHED" ? "All visual requests have been used." : "The visuals could not be generated. Please try again.",
        latencyMs: Math.max(0, Date.now() - new Date(request.createdAt).getTime()),
      };
      let next = { ...current, imageRequests: current.imageRequests.map((item) => item.requestId === request.requestId ? failedRequest : item) };
      next = appendImageResearchEvent(next, "ai_image_request_failed", "AI image request did not complete with two retained images.", request.requestId, code, diagnosticCode);
      saveSession(next);
      setError(failedRequest.safeErrorMessage!);
      setView("visuals");
    } finally {
      requestPending.current = false;
      setIsLoading(false);
      setIsGenerating(false);
    }
  };

  const generate = async (prompt: string, retryOfRequestId?: string) => {
    if (requestPending.current) return;
    const promptText = prompt.trim();
    if (!promptText) { setError("Enter a visual request before generating images."); return; }
    const base = latestSession.current;
    const succeededCount = base.imageRequests.filter((request) => request.status === "succeeded").length || base.imageRequestCount;
    const requestLimit = base.configuredImageRequestLimit ?? DEFAULT_IMAGE_REQUEST_LIMIT;
    const totalLimit = base.configuredImageTotalLimit ?? DEFAULT_IMAGE_TOTAL_LIMIT;
    if (succeededCount >= requestLimit || base.images.length + imagesPerRequest > totalLimit) { setError("All visual requests have been used."); return; }
    if (!retryOfRequestId && getConversationAllowanceCount(base) >= PARTICIPANT_MESSAGE_LIMIT) { setError(`The ${PARTICIPANT_MESSAGE_LIMIT}-message task limit has been reached.`); return; }
    requestPending.current = true;
    setError(""); setIsLoading(true); setIsGenerating(true);
    const createdAt = new Date().toISOString();
    const requestId = crypto.randomUUID();
    let participantMessageId: string | undefined;
    let relatedTurn: number;
    let next = base;
    if (retryOfRequestId) {
      const original = base.imageRequests.find((request) => request.requestId === retryOfRequestId);
      participantMessageId = original?.participantMessageId;
      relatedTurn = original?.relatedTurn ?? nextTurn;
      next = appendImageResearchEvent(next, "ai_image_request_retried", "Participant retried an AI image request.", requestId);
    } else {
      relatedTurn = base.messages.filter((message) => message.role === "participant").length + 1;
      participantMessageId = `M${String(base.messages.length + 1).padStart(2, "0")}`;
      const participantMessage: Message = { id: participantMessageId, role: "participant", content: promptText, turn: relatedTurn, createdAt };
      next = { ...next, messages: [...next.messages, participantMessage] };
    }
    const imageRequest: ImageRequestRecord = {
      requestId, sessionId: base.id, participantId: base.participantId, participantMessageId, relatedTurn,
      createdAt, promptText, promptVersion: base.imagePromptVersion ?? ELSEWHERE_IMAGE_PROMPT_VERSION,
      requestedImageCount: 2, returnedImageCount: 0, status: "pending", imageIds: [], retryOfRequestId,
    };
    next = appendImageResearchEvent({ ...next, imageRequests: [...next.imageRequests, imageRequest] }, "ai_image_request_started", "AI image request started.", requestId);
    saveSession(next);
    const pendingSaved = onCriticalChange ? await onCriticalChange(next) : true;
    if (!pendingSaved) {
      requestPending.current = false;
      setIsLoading(false);
      setIsGenerating(false);
      setError("The visuals could not be generated. Please try again.");
      return;
    }
    await runImageRequest(imageRequest);
  };

  const retryImageRequest = (requestId: string) => {
    const request = latestSession.current.imageRequests.find((item) => item.requestId === requestId && item.status === "failed");
    if (request) void generate(request.promptText, request.requestId);
  };

  const selectImage = (id: string, target: "logo" | "visual") => {
    const base = latestSession.current;
    const image = base.images.find((item) => item.id === id); if (!image) return;
    const timestamp = new Date().toISOString();
    const targetName: ImageUsageTarget = target === "logo" ? "logoSymbolDirection" : "visualStyleReferences";
    const updateUsage = (item: GeneratedImage, action: "used" | "removed", usageTarget = targetName): GeneratedImage => {
      const currentTargets = item.usageTargets ?? [];
      const usageTargets = action === "used" ? [...new Set([...currentTargets, usageTarget])] : currentTargets.filter((value) => value !== usageTarget);
      return { ...item, usageTargets, usageEvents: [...(item.usageEvents ?? []), { target: usageTarget, action, createdAt: timestamp }], selectedAt: action === "used" ? timestamp : item.selectedAt };
    };
    if (target === "logo") {
      const removing = base.board.selectedLogoImageId === id;
      const previousId = base.board.selectedLogoImageId;
      const board = reconcileImageSectionConfirmations({ ...base.board, selectedLogoImageId: removing ? undefined : id });
      const images = base.images.map((item) => item.id === id ? updateUsage(item, removing ? "removed" : "used") : previousId && item.id === previousId && !removing ? updateUsage(item, "removed", "logoSymbolDirection") : item);
      const next = { ...base, board, images };
      recordBoardEvent("Logo or symbol", removing ? `Image ${id} removed from logo / symbol direction.` : `Image ${id} added to logo / symbol direction.`, {
        action: "Human-initiated", relatedImageId: id,
        eventType: removing ? "removal" : previousId ? "replacement" : "selection", beforeValue: previousId ?? null, afterValue: removing ? null : id,
      }, next);
      return;
    }
    const selected = base.board.selectedVisualImageIds.includes(id);
    if (!selected && base.board.selectedVisualImageIds.length >= 3) { setError("Up to three visual references can be selected. Remove one before adding another."); return; }
    const selectedVisualImageIds = selected ? base.board.selectedVisualImageIds.filter((item) => item !== id) : [...base.board.selectedVisualImageIds, id];
    const board = reconcileImageSectionConfirmations({ ...base.board, selectedVisualImageIds });
    const images = base.images.map((item) => item.id === id ? updateUsage(item, selected ? "removed" : "used") : item);
    const next = { ...base, board, images };
    recordBoardEvent("Visual style", selected ? `Image ${id} removed from visual style references.` : `Image ${id} added to visual style references.`, {
      action: "Human-initiated", relatedImageId: id,
      eventType: selected ? "removal" : "selection", beforeValue: base.board.selectedVisualImageIds, afterValue: selectedVisualImageIds,
    }, next);
  };

  const submit = async () => {
    const errors = getBoardErrors(latestSession.current.board);
    if (errors.length) { setValidationErrors(errors); setView("review"); return; }
    setValidationErrors([]);
    const submittedAt = new Date().toISOString();
    const base = latestSession.current;
    const progress = getBoardProgress(base.board);
    const actualElapsedSeconds = base.participantStartedAt ? Math.max(0, Math.floor((Date.now() - new Date(base.participantStartedAt).getTime()) / 1000)) : 0;
    const boardSnapshot = structuredClone(base.board);
    const submitted = {
      ...base, status: "questionnaire" as const, submittedAt,
      postTaskQuestionnaires: base.postTaskQuestionnaires ?? createPostTaskQuestionnaires(base.condition),
      finalSubmission: {
        id: `SUB-${base.id}-${Date.now()}`, sessionId: base.id, submittedAt, actualElapsedSeconds,
        board: boardSnapshot,
        selectedLogoImage: base.images.find((image) => image.id === boardSnapshot.selectedLogoImageId),
        selectedVisualImages: base.images.filter((image) => boardSnapshot.selectedVisualImageIds.includes(image.id)),
        requiredSectionsComplete: progress.requiredComplete, supportingSectionsComplete: progress.supportingComplete,
        validationErrors: [], isValid: true,
      },
    };
    const finalEvent = { id: `RE${String(submitted.researchEvents.length + 1).padStart(2, "0")}`, type: "final_submission" as const, summary: "Participant submitted the final direction.", actor: "participant" as const, createdAt: new Date().toISOString(), timestampSeconds: actualElapsedSeconds };
    const next = { ...submitted, researchEvents: [...submitted.researchEvents, finalEvent] };
    if (onCriticalChange) {
      const saved = await onCriticalChange(next);
      if (!saved) { setError("Your work could not be saved remotely. Saving will retry when the connection returns."); return; }
      latestSession.current = next;
    } else saveSession(next);
  };

  const openReview = () => {
    setValidationErrors(getBoardErrors(latestSession.current.board)); setView("review");
    const openedAt = new Date().toISOString();
    recordResearchEvent("final_review_opened", "Participant opened the final review.", latestSession.current.finalReviewOpenedAt ? latestSession.current : { ...latestSession.current, finalReviewOpenedAt: openedAt });
  };
  const editSection = (section: BoardSectionId) => { setBoardSectionTarget(section); setView("board"); window.setTimeout(() => document.getElementById(`board-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); };
  const openGuide = () => { setMenuOpen(false); setGuideOpen(true); recordResearchEvent("task_guide_reopened", "Participant reopened the task guide during the timed task."); };
  const leaveWorkspace = () => { const next = recordResearchEvent("workspace_exited", "Participant exited the timed workspace."); onChange({ ...next, participantExitedAt: new Date().toISOString() }); };

  const boardProps = { board: session.board, images: session.images, onChange: (board: FinalDirectionBoard) => { const next = { ...latestSession.current, board }; latestSession.current = next; onChange(next); }, onEvent: recordBoardEvent, onSelectImage: selectImage, submitted: session.status === "submitted" };
  const navItems: { id: View; label: string; meta?: string }[] = [{ id: "brief", label: "Brief" }, { id: "conversation", label: "AI conversation", meta: `${Math.max(0, PARTICIPANT_MESSAGE_LIMIT - userMessageCount)} messages left` }, { id: "visuals", label: "Generated visuals", meta: `${session.images.length}/${imageTotalLimit}` }, { id: "board", label: "Working board", meta: `${boardProgress.requiredComplete}/8 required` }, { id: "review", label: "Final review" }];
  const chatPanel = <ChatPanel messages={session.messages} images={session.images} isLoading={isLoading} isGenerating={isGenerating} error={error} canRetry={Boolean(retryRequestId) && now >= retryCooldownUntil} userMessageCount={userMessageCount} remainingImages={remainingImages} remainingRequests={remainingRequests} onSend={send} onRetry={retryTextRequest} onGenerate={generate} />;

  const mainView = view === "studio" ? <main className="workspaceConversation">{chatPanel}</main> : <div className="workspaceMain">
    {view === "brief" && <main className="focusedWorkspace"><BriefPanel durationMinutes={session.taskDurationMinutes} /></main>}
    {view === "conversation" && <main className="focusedWorkspace conversationFocus">{chatPanel}</main>}
    {view === "visuals" && <main className="focusedWorkspace"><GeneratedVisuals images={session.images} requests={session.imageRequests} board={session.board} requestLimit={imageRequestLimit} imageLimit={imageTotalLimit} requestsRemaining={remainingRequests} imagesRemaining={remainingImages} isGenerating={isGenerating} onSelect={selectImage} onRetry={retryImageRequest} /></main>}
    {view === "board" && <main className="focusedWorkspace boardFocus"><WorkingBoard key={boardSectionTarget} {...boardProps} full initialSection={boardSectionTarget} /></main>}
    {view === "review" && <main className="focusedWorkspace boardFocus"><FinalReviewSummary session={session} onEdit={editSection} onSubmit={submit} /></main>}
  </div>;

  return <div className="appShell participantShell">
    <header className="taskHeader"><button className="brandLockup" onClick={() => setView("studio")}><span>E</span><div><p>AI-ASSISTED CREATIVE WORKSPACE</p><h1>Elsewhere · Early Brand Identity</h1></div></button><div className="taskMetrics"><div><span>Participant</span><strong>{session.participantId}</strong></div><div><span>Time guide</span><strong className="timer">{timer}</strong></div><div><span>Conversation</span><strong>{userMessageCount} / {PARTICIPANT_MESSAGE_LIMIT}</strong><small>{Math.max(0, PARTICIPANT_MESSAGE_LIMIT - userMessageCount)} messages left</small></div><div><span>Images</span><strong>{remainingImages} left</strong><small>{remainingRequests} {remainingRequests === 1 ? "request" : "requests"}</small></div></div><div className="sessionMenu"><button aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>Session <span>⌄</span></button>{menuOpen && <div role="menu"><button role="menuitem" onClick={openGuide}>View task guide</button><button role="menuitem" onClick={() => { setMenuOpen(false); setExitOpen(true); }}>Exit workspace</button></div>}</div></header>
    <nav className="workspaceNav" aria-label="Creative workspace"><button className={view === "studio" ? "active" : ""} onClick={() => setView("studio")}><span>Workspace</span><small>Overview</small></button>{navItems.map((item, index) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => item.id === "review" ? openReview() : setView(item.id)}><i>{String(index + 1).padStart(2, "0")}</i><span>{item.label}</span>{item.meta && <small>{item.meta}</small>}</button>)}</nav>
    {suggestedTimeEnded && <div className="timeGuideNotice" role="status">The {session.taskDurationMinutes}-minute time guide has been reached. The workspace remains available.</div>}
    {error && view !== "studio" && view !== "conversation" && <div className="workspaceNotice" role="status"><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
    <div className="workspaceFrame">{mainView}<aside className="workspaceRail"><WorkspaceStatus board={session.board} onOpenGuide={openGuide} />{session.condition === "B" && <DecisionTrace decisions={session.decisions} pending={hasActiveTraceClassification(session, now)} />}</aside></div>
    <footer className="appFooter"><span>Elsewhere · AI-assisted creative workspace</span><span>{saveStatus === "saving" ? "Saving…" : saveStatus === "retrying" ? "Save failed — retrying" : saveStatus === "saved" ? "Saved" : "Saved locally"} · Required {boardProgress.requiredComplete}/8 · All {boardProgress.allComplete}/11</span></footer>
    {guideOpen && <div className="modalBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setGuideOpen(false); }}><section className="taskGuideModal" role="dialog" aria-modal="true" aria-labelledby="guide-title"><header><div><p className="eyebrow">TASK GUIDE</p><h2 id="guide-title">Workspace guide</h2></div><button aria-label="Close task guide" onClick={() => setGuideOpen(false)}>×</button></header><p className="timerContinues">The timed task continues while this guide is open.</p><TaskGuideContent session={session} compact /></section></div>}
    {exitOpen && <div className="modalBackdrop"><section className="confirmDialog" role="alertdialog" aria-modal="true" aria-labelledby="exit-title"><p className="eyebrow">EXIT WORKSPACE</p><h2 id="exit-title">Leave the timed workspace?</h2><p>Your progress is saved. The session timer may continue while the workspace is closed. Contact the researcher if you intended to finish.</p><div><button onClick={() => setExitOpen(false)}>Continue working</button><button className="primaryButton" onClick={leaveWorkspace}>Leave workspace</button></div></section></div>}
  </div>;
}
