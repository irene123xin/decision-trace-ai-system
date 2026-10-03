export type Condition = "A" | "B";
export type SessionStatus = "ready" | "briefing" | "starting_point" | "active" | "questionnaire" | "ended" | "submitted" | "restarted";
export type ResearchEventType =
  | "briefing_opened"
  | "briefing_confirmed"
  | "task_started"
  | "pre_ai_started"
  | "pre_ai_draft_updated"
  | "pre_ai_submitted"
  | "suggested_time_reached"
  | "task_guide_reopened"
  | "workspace_exited"
  | "researcher_restart"
  | "researcher_end_session"
  | "final_review_opened"
  | "final_submission"
  | "ai_text_request_started"
  | "ai_text_request_succeeded"
  | "ai_text_request_failed"
  | "ai_text_request_retried"
  | "ai_image_request_started"
  | "ai_image_request_succeeded"
  | "ai_image_request_failed"
  | "ai_image_request_retried";
export type MessageRole = "participant" | "assistant" | "system";
export type AITextMode = "mock" | "live";
export type AITextRequestStatus = "started" | "succeeded" | "failed";
export type AITextFailureCategory =
  | "configuration"
  | "permission_denied"
  | "model_not_found"
  | "invalid_request"
  | "rate_limit"
  | "provider_unavailable"
  | "connection_interruption"
  | "timeout"
  | "empty_response"
  | "max_tokens"
  | "safety"
  | "recitation"
  | "invalid_response"
  | "unknown";
export type AITextErrorStage = "configuration" | "request_validation" | "provider_timeout" | "provider_http" | "provider_sdk" | "response_policy" | "none";
export type AITextRetryReason = "timeout" | "connection_interruption" | "rate_limit" | "provider_unavailable" | "empty_response";
export interface AITextAttempt {
  attempt: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: "succeeded" | "failed";
  providerStatusCode?: number;
  errorCategory?: AITextFailureCategory;
  errorStage?: AITextErrorStage;
  finishReason?: string;
  candidateCount?: number;
  inputTokenCount?: number;
  outputTokenCount?: number;
  timeout: boolean;
  retryReason?: AITextRetryReason;
  safeErrorMessage?: string;
}
export type DecisionAction = "Accept" | "Modify" | "Reject" | "Human-initiated" | "Uncertain";
export type DecisionSource = "AI-initiated" | "Human-initiated" | "Mixed" | "Unclear";
export type DecisionObject =
  | "Brand concept"
  | "Keywords"
  | "Brand personality"
  | "Audience interpretation"
  | "Colour palette"
  | "Typography"
  | "Logo or symbol"
  | "Visual style"
  | "Tone of voice"
  | "Visual principles"
  | "Prompt or constraint"
  | "Final selection"
  | "Other";
export type Confidence = "High" | "Medium" | "Low";
export type ReviewStatus = "Unreviewed" | "Confirmed" | "Corrected";
export type DecisionCategory = "accept" | "modify" | "reject" | "human_initiated" | "uncertain";
export type DecisionAnalysisResult = "decision_units" | "no_decision";
export type DecisionReasonCode =
  | "explicit_adoption"
  | "implicit_commitment"
  | "conditional_adoption"
  | "partial_retention_with_change"
  | "combination_of_ai_options"
  | "explicit_rejection"
  | "implicit_exclusion"
  | "participant_new_proposition"
  | "unresolved_reference"
  | "weak_commitment"
  | "conflicting_language"
  | "no_actionable_design_choice";
export type TraceClassificationCode =
  | "TRACE_CLASSIFICATION_PENDING"
  | "TRACE_CLASSIFIED"
  | "TRACE_NO_DECISION"
  | "TRACE_NEEDS_REVIEW"
  | "TRACE_PROVIDER_ERROR"
  | "TRACE_SCHEMA_ERROR"
  | "TRACE_CONTEXT_ERROR"
  | "TRACE_DUPLICATE_SKIPPED";
export type DecisionSourceStatus = "matched_structured_proposition" | "matched_raw_ai_context" | "absent_from_ai_context" | "source_unclear";
export interface DecisionSourceMatchDiagnostics {
  matchedExcerpt?: string;
  meaningfulMatchedTokens: string[];
  similarityScore: number;
  matcherRule: "multiple_meaningful_tokens" | "distinctive_design_token" | "no_match";
  rejectedWeakMatchReason?: "generic_token_only" | "insufficient_meaningful_overlap" | "no_meaningful_overlap";
}
export type TraceAttemptStage = "primary" | "schema_repair" | "provider_retry";
export type TraceErrorStage = "configuration" | "request_validation" | "provider_timeout" | "provider_http" | "provider_sdk" | "invalid_json" | "schema_validation" | "none";
export interface TraceClassificationAttempt {
  attempt: number;
  stage: TraceAttemptStage;
  startedAt: string;
  completedAt: string;
  status: "succeeded" | "failed";
  errorStage?: TraceErrorStage;
  providerStatusCode?: number;
  retryReason?: "schema_repair" | "timeout" | "rate_limit" | "provider_unavailable" | "connection_interruption";
  finishReason?: string;
  latencyMs: number;
  candidateCount?: number;
  inputTokenCount?: number;
  outputTokenCount?: number;
  responseTextPresent?: boolean;
  validationPath?: string;
}
export type TraceCandidateStatus = "classified" | "uncertain" | "failed" | "overflow";
export interface TraceCandidateOutcome {
  candidateId: string;
  evidenceText: string;
  status: TraceCandidateStatus;
  decisionUnitId?: string;
  attempts: TraceClassificationAttempt[];
  attemptCount: number;
  errorStage?: TraceErrorStage;
  providerStatusCode?: number;
  retryReason?: TraceClassificationAttempt["retryReason"];
  finalResolution: "primary_model_success" | "repaired_model_response" | "provider_retry_success" | "failed_classification" | "manual_review_required";
  validationPath?: string;
}
export type StudyStatus = "development_test" | "pilot" | "formal" | "excluded";
export type HumanCodingCategory = DecisionCategory | "no_decision";
export type HumanCodingStatus = "not_coded" | "coded";
export type AdjudicationStatus = "not_required" | "pending" | "resolved";
export type CalibrationDecision = "accepted" | "rejected" | "deferred";
export type ClassifierFreezeStatus = "draft" | "frozen" | "superseded";
export type ImageKind = "logo" | "visual";
export type ImageRequestStatus = "pending" | "succeeded" | "failed";
export type ImageErrorCode =
  | "EMPTY_PROMPT"
  | "INVALID_REQUEST"
  | "SESSION_NOT_FOUND"
  | "SESSION_NOT_ACTIVE"
  | "IMAGE_LIMIT_REACHED"
  | "IMAGE_PROVIDER_ERROR"
  | "INVALID_IMAGE_RESPONSE"
  | "IMAGE_STORAGE_ERROR";
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
export type ImageUsageTarget = "visualStyleReferences" | "logoSymbolDirection";

export interface ImageUsageEvent {
  target: ImageUsageTarget;
  action: "used" | "removed";
  createdAt: string;
}

export interface ImageRequestRecord {
  requestId: string;
  sessionId: string;
  participantId: string;
  participantMessageId?: string;
  relatedTurn?: number;
  createdAt: string;
  completedAt?: string;
  promptText: string;
  effectivePrompt?: string;
  provider?: string;
  model?: string;
  promptVersion: string;
  requestedImageCount: number;
  returnedImageCount: number;
  status: ImageRequestStatus;
  imageIds: string[];
  errorCode?: ImageErrorCode;
  diagnosticCode?: ImageDiagnosticCode;
  safeErrorMessage?: string;
  latencyMs?: number;
  retryOfRequestId?: string;
}
export type BoardSectionId =
  | "concept"
  | "keywords"
  | "personality"
  | "audience"
  | "palette"
  | "typography"
  | "logo"
  | "visuals"
  | "tone"
  | "principles"
  | "rationale";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  turn: number;
  createdAt: string;
  relatedImageIds?: string[];
  provider?: string;
  modelId?: string;
  promptVersion?: string;
  integrationMode?: AITextMode;
  requestId?: string;
  finishReason?: string;
}

export interface AITextRequest {
  requestId: string;
  participantMessageId: string;
  turn: number;
  startedAt: string;
  serverStartedAt?: string;
  completedAt?: string;
  status: AITextRequestStatus;
  provider?: string;
  modelId?: string;
  promptVersion?: string;
  integrationMode?: AITextMode;
  latencyMs?: number;
  failureCategory?: AITextFailureCategory;
  retryOfRequestId?: string;
  finishReason?: string;
  providerStatusCode?: number;
  attempts?: AITextAttempt[];
  attemptCount?: number;
  errorStage?: AITextErrorStage;
  candidateCount?: number;
  inputTokenCount?: number;
  outputTokenCount?: number;
  finalResolution?: "succeeded" | "failed_transient" | "failed_non_retryable" | "incomplete_response";
  safeErrorMessage?: string;
}

export interface GeneratedImage {
  id: string;
  kind: ImageKind;
  prompt: string;
  createdAt: string;
  relatedTurn: number;
  palette: string[];
  label: string;
  requestId?: string;
  sessionId?: string;
  imageIndex?: number;
  mimeType?: string;
  storageReference?: string;
  storageBackend?: "supabase" | "indexeddb_legacy";
  storagePath?: string;
  byteSize?: number;
  checksum?: string;
  width?: number;
  height?: number;
  displayedAt?: string;
  usageTargets?: ImageUsageTarget[];
  usageEvents?: ImageUsageEvent[];
  selectedAt?: string;
}

export interface DecisionLabel {
  action: DecisionAction;
  source: DecisionSource;
  object: DecisionObject;
  summary: string;
}

export interface DecisionUnit extends DecisionLabel {
  id: string;
  timestampSeconds: number;
  relatedTurn: number | null;
  relatedBoardEventId?: string;
  relatedImageId?: string;
  confidence: Confidence;
  modelGeneratedLabel: string;
  reviewStatus: ReviewStatus;
  originalModelLabel: DecisionLabel;
  finalReviewedLabel: DecisionLabel;
  category?: DecisionCategory;
  originalModelCategory?: DecisionCategory;
  currentReviewedCategory?: DecisionCategory | null;
  evidenceText?: string;
  participantMessageId?: string;
  linkedAiMessageIds?: string[];
  linkedAiPropositionIds?: string[];
  confidenceScore?: number;
  reasonCode?: DecisionReasonCode;
  reversesDecisionUnitId?: string | null;
  supersedesDecisionUnitId?: string | null;
  idempotencyKey?: string;
  classifierStatus?: TraceClassificationCode;
  classifierPromptVersion?: string;
  classifierProvider?: string;
  classifierModelId?: string;
  classifierIntegrationMode?: "mock" | "live";
  participantFacingLabel?: "Accept" | "Modify" | "Reject" | "New Direction" | "Uncertain";
  visibilityStatus?: "participant_visible" | "researcher_review" | "hidden_uncertain";
  sourceStatus?: DecisionSourceStatus;
  sourceMatchDiagnostics?: DecisionSourceMatchDiagnostics;
  classificationRequestId?: string;
  classifiedAt?: string;
  reviewedAt?: string;
  reviewerId?: string;
  reviewNote?: string;
}

export interface AIProposition {
  id: string;
  aiMessageId: string;
  turn: number;
  summary: string;
  optionLabel?: string;
  createdAt: string;
}

export interface TraceClassificationRecord {
  requestId: string;
  participantMessageId: string;
  startedAt: string;
  completedAt?: string;
  status: TraceClassificationCode;
  analysisResult?: DecisionAnalysisResult;
  classifierPromptVersion: string;
  provider?: string;
  modelId?: string;
  latencyMs?: number;
  unitIds: string[];
  propositionIds: string[];
  safeErrorMessage?: string;
  extractionStatus?: "structured" | "raw_context_fallback" | "failed";
  extractionAttemptCount?: number;
  attempts?: TraceClassificationAttempt[];
  attemptCount?: number;
  errorStage?: TraceErrorStage;
  providerStatusCode?: number;
  retryReason?: TraceClassificationAttempt["retryReason"];
  finalResolution?: "primary_model_success" | "repaired_model_response" | "provider_retry_success" | "partial_success" | "manual_review_required" | "failed_classification" | "no_decision" | "needs_review";
  totalDurationMs?: number;
  segmentationStatus?: "no_decision" | "single" | "multiple" | "uncertain" | "failed";
  segmentationEvidence?: string[];
  segmentationOverflow?: boolean;
  candidateOutcomes?: TraceCandidateOutcome[];
}

export interface HumanCodedUnit {
  id: string;
  category: HumanCodingCategory;
  evidenceText: string;
  neutralSummary: string;
  linkedAiMessageId: string | null;
  linkedAiPropositionId: string | null;
  coderNote?: string | null;
}

export interface HumanCoderRecord {
  coderId: string | null;
  status: HumanCodingStatus;
  codedAt: string | null;
  units: HumanCodedUnit[];
  note: string | null;
  automatedCodingRevealedBeforeSubmission: boolean;
  otherCoderRevealedBeforeSubmission: boolean;
}

export interface MessageHumanCoding {
  participantMessageId: string;
  sessionId: string;
  coder1: HumanCoderRecord;
  coder2: HumanCoderRecord;
  adjudication: {
    status: AdjudicationStatus;
    resolvedUnits: HumanCodedUnit[];
    resolvedAt: string | null;
    resolvedBy: string | null;
    note: string | null;
  };
}

export interface CalibrationLogEntry {
  id: string;
  date: string;
  classifierPromptVersion: string;
  observedIssue: string;
  representativeMessageIds: string[];
  proposedRuleAdjustment: string;
  decision: CalibrationDecision;
  rationale: string;
  author: string;
  implementationVersion?: string;
}

export interface ClassifierFreezeRecord {
  id: string;
  classifierPromptVersion: string;
  applicationVersion: string;
  geminiModelId: string;
  confidenceThresholds: string;
  freezeTimestamp: string | null;
  frozenBy: string | null;
  pilotSessionIds: string[];
  rationale: string;
  status: ClassifierFreezeStatus;
}

export interface CalibrationWorkspaceRecord {
  calibrationLog: CalibrationLogEntry[];
  freezeRecords: ClassifierFreezeRecord[];
}

export interface FinalDirectionBoard {
  concept: string;
  keywords: string[];
  personalityTraits: string[];
  audienceDescription: string;
  audienceCoreNeed: string;
  audienceEmotionalResponse: string;
  primaryColour: string;
  secondaryColour1: string;
  secondaryColour2: string;
  accentColour: string;
  paletteRationale: string;
  primaryTypeStyle: string;
  secondaryTypeStyle: string;
  typographyMood: string[];
  typographyRationale: string;
  selectedLogoImageId?: string;
  logoDirectionNote: string;
  selectedVisualImageIds: string[];
  visualReferenceNotes: Record<string, string>;
  toneTraits: string[];
  sampleLine: string;
  visualDos: string[];
  visualDonts: string[];
  rationale: string;
  confirmedSections: BoardSectionId[];
}

export interface BoardInteractionEvent {
  id: string;
  createdAt: string;
  timestampSeconds: number;
  object: DecisionObject;
  action: DecisionAction;
  summary: string;
  eventType?: "field_edit" | "selection" | "removal" | "replacement" | "reset" | "section_confirmation";
  beforeValue?: unknown;
  afterValue?: unknown;
  relatedImageId?: string;
}

export interface ResearchEvent {
  id: string;
  type: ResearchEventType;
  createdAt: string;
  timestampSeconds: number;
  summary: string;
  actor: "participant" | "researcher" | "system";
  requestId?: string;
  failureCategory?: AITextFailureCategory;
  imageErrorCode?: ImageErrorCode;
  imageDiagnosticCode?: ImageDiagnosticCode;
}

export interface FinalSubmissionSnapshot {
  id: string;
  sessionId: string;
  submittedAt: string;
  actualElapsedSeconds: number;
  board: FinalDirectionBoard;
  selectedLogoImage?: GeneratedImage;
  selectedVisualImages: GeneratedImage[];
  requiredSectionsComplete: number;
  supportingSectionsComplete: number;
  validationErrors: string[];
  isValid: boolean;
}

export interface PreAiStartingPoint {
  status: "draft" | "submitted";
  initialInterpretation: string;
  keywords: [string, string, string];
  visualQuestion: string;
  startedAt: string | null;
  submittedAt: string | null;
  durationMs: number | null;
}

export interface PostTaskQuestionnaireItem {
  required: boolean;
  openedAt: string | null;
  participantConfirmedSubmitted: boolean;
  confirmedAt: string | null;
}

export interface PostTaskQuestionnaires {
  main: PostTaskQuestionnaireItem;
  additional: PostTaskQuestionnaireItem;
  studyCompletedAt: string | null;
}

export type AssignmentMethod = "balanced_random" | "researcher_manual";
export type ManualAssignment = "automatic" | Condition;

export interface Session {
  id: string;
  participantId: string;
  researcherId: string;
  condition: Condition;
  assignmentMethod?: AssignmentMethod;
  assignmentTimestamp?: string;
  assignmentBlockId?: string;
  assignmentPosition?: number;
  assignmentSequence?: number;
  assignmentStudyStatus?: StudyStatus;
  sessionDate: string;
  taskDurationMinutes: number;
  brandBriefId?: string;
  taskGuideVersion?: string;
  textPromptVersion?: string;
  imagePromptVersion?: string;
  configuredDurationMinutes?: number;
  configuredImageRequestLimit?: number;
  configuredImageTotalLimit?: number;
  configuredImagesPerRequest?: number;
  startedAt: string;
  status: SessionStatus;
  messages: Message[];
  images: GeneratedImage[];
  decisions: DecisionUnit[];
  aiPropositions?: AIProposition[];
  traceClassifications?: TraceClassificationRecord[];
  studyStatus?: StudyStatus;
  statusChangedAt?: string;
  statusChangedBy?: string;
  exclusionReason?: string;
  activeFrozenClassifierVersion?: string;
  humanCoding?: MessageHumanCoding[];
  boardEvents: BoardInteractionEvent[];
  researchEvents: ResearchEvent[];
  aiTextRequests: AITextRequest[];
  imageRequests: ImageRequestRecord[];
  board: FinalDirectionBoard;
  imageRequestCount: number;
  attemptNumber: number;
  previousAttemptId?: string;
  endReason?: "researcher_restart" | "researcher_end" | "participant_submission";
  suggestedTimeReachedAt?: string;
  finalReviewOpenedAt?: string;
  completionTimeSeconds?: number;
  finalSubmission?: FinalSubmissionSnapshot;
  preAiStartingPoint?: PreAiStartingPoint;
  postTaskQuestionnaires?: PostTaskQuestionnaires;
  participantStartedAt?: string;
  briefingOpenedAt?: string;
  briefingConfirmedAt?: string;
  participantExitedAt?: string;
  endedAt?: string;
  submittedAt?: string;
}

export interface SessionSetupData {
  participantId: string;
  researcherId: string;
  condition: Condition;
  sessionDate: string;
  taskDurationMinutes: number;
}

export interface PublicSessionSetupData {
  participantId: string;
  manualAssignment?: ManualAssignment;
}
