import type { DecisionUnit, HumanCodedUnit, Session } from "@/types";

const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

export function buildSessionJson(session: Session): string {
  const blockedKeys = new Set([
    "apikey", "api_key", "authorization", "authorizationheader", "headers",
    "researcheraccesspin", "researcher_access_pin", "systeminstruction",
    "rawproviderresponse", "raw_provider_response", "participantaccesstoken",
    "participant_access_token", "participant_access_token_hash", "tokenhash",
    "supabase_secret_key", "researcher_cookie_secret", "cookie",
    "signedurl", "signed_url", "publicurl", "public_url",
  ]);
  return JSON.stringify(session, (key, value) => blockedKeys.has(key.toLowerCase()) ? undefined : value, 2);
}

export function buildSessionSummaryCsv(session: Session): string {
  const requests = session.imageRequests ?? [];
  const activeVisual = session.images.filter((image) => image.usageTargets?.includes("visualStyleReferences")).length;
  const activeLogo = session.images.filter((image) => image.usageTargets?.includes("logoSymbolDirection")).length;
  const preAi = session.preAiStartingPoint;
  const questionnaires = session.postTaskQuestionnaires;
  const header = ["session_id", "participant_id", "researcher_id", "attempt_number", "condition", "configured_duration_minutes", "configured_image_request_limit", "configured_image_total_limit", "configured_images_per_request", "image_prompt_version", "pre_ai_status", "pre_ai_initial_interpretation", "pre_ai_keyword_1", "pre_ai_keyword_2", "pre_ai_keyword_3", "pre_ai_visual_question", "pre_ai_started_at", "pre_ai_submitted_at", "pre_ai_duration_ms", "trace_prompt_version", "trace_classifications_total", "trace_classified", "trace_no_decision", "trace_needs_review", "trace_failed", "decision_units_total", "decision_units_uncertain", "image_requests_succeeded", "image_requests_failed", "images_generated", "images_used", "images_used_visual_references", "images_used_logo_symbol", "main_questionnaire_required", "main_questionnaire_opened_at", "main_questionnaire_confirmed", "main_questionnaire_confirmed_at", "additional_questionnaire_required", "additional_questionnaire_opened_at", "additional_questionnaire_confirmed", "additional_questionnaire_confirmed_at", "study_completed_at", "image_ids", "image_request_ids", "image_storage_backends", "image_storage_paths", "image_mime_types", "image_byte_sizes", "image_checksums", "image_created_times", "assignment_method", "assignment_timestamp", "assignment_block_id", "assignment_position", "assignment_sequence", "assignment_study_status"];
  const usedIds = new Set(session.images.filter((image) => (image.usageTargets?.length ?? 0) > 0).map((image) => image.id));
  const trace = session.traceClassifications ?? [];
  const row = [session.id, session.participantId, session.researcherId, session.attemptNumber, session.condition, session.configuredDurationMinutes ?? session.taskDurationMinutes, session.configuredImageRequestLimit, session.configuredImageTotalLimit, session.configuredImagesPerRequest, session.imagePromptVersion, preAi?.status ?? "not_available", preAi?.initialInterpretation, preAi?.keywords[0], preAi?.keywords[1], preAi?.keywords[2], preAi?.visualQuestion, preAi?.startedAt, preAi?.submittedAt, preAi?.durationMs, trace.at(-1)?.classifierPromptVersion, trace.length, trace.filter((item) => item.status === "TRACE_CLASSIFIED").length, trace.filter((item) => item.status === "TRACE_NO_DECISION").length, trace.filter((item) => item.status === "TRACE_NEEDS_REVIEW").length, trace.filter((item) => ["TRACE_PROVIDER_ERROR", "TRACE_SCHEMA_ERROR", "TRACE_CONTEXT_ERROR"].includes(item.status)).length, session.decisions.length, session.decisions.filter((item) => item.category === "uncertain" || item.currentReviewedCategory === "uncertain").length, requests.filter((request) => request.status === "succeeded").length, requests.filter((request) => request.status === "failed").length, session.images.length, usedIds.size, activeVisual, activeLogo, questionnaires?.main.required, questionnaires?.main.openedAt, questionnaires?.main.participantConfirmedSubmitted, questionnaires?.main.confirmedAt, questionnaires?.additional.required, questionnaires?.additional.openedAt, questionnaires?.additional.participantConfirmedSubmitted, questionnaires?.additional.confirmedAt, questionnaires?.studyCompletedAt, session.images.map((image) => image.id).join("|"), session.images.map((image) => image.requestId ?? "").join("|"), session.images.map((image) => image.storageBackend ?? (image.storageReference ? "indexeddb_legacy" : "historical_mock")).join("|"), session.images.map((image) => image.storagePath ?? "").join("|"), session.images.map((image) => image.mimeType ?? "").join("|"), session.images.map((image) => image.byteSize ?? "").join("|"), session.images.map((image) => image.checksum ?? "").join("|"), session.images.map((image) => image.createdAt).join("|"), session.assignmentMethod, session.assignmentTimestamp, session.assignmentBlockId, session.assignmentPosition, session.assignmentSequence, session.assignmentStudyStatus];
  return [header, row].map((values) => values.map(csvCell).join(",")).join("\n");
}

export function buildDecisionsCsv(session: Session): string {
  const header = ["session_id", "participant_id", "researcher_id", "attempt_number", "condition", "configured_duration_minutes", "decision_id", "classification_request_id", "timestamp_seconds", "participant_message_id", "related_turn", "category", "original_model_category", "current_reviewed_category", "action", "source", "source_status", "object", "summary", "evidence_text", "linked_ai_message_ids", "linked_ai_proposition_ids", "confidence_label", "confidence_score", "reason_code", "classifier_status", "classifier_prompt_version", "classified_at", "reverses_decision_unit_id", "supersedes_decision_unit_id", "idempotency_key", "review_status", "reviewed_at", "reviewer_id", "review_note", "original_action", "original_source", "original_object", "original_summary", "reviewed_action", "reviewed_source", "reviewed_object", "reviewed_summary", "related_board_event_id", "related_image_id", "participant_facing_label", "visibility_status", "classifier_provider", "classifier_model_id", "classifier_integration_mode", "study_status", "participant_turn", "decision_unit_id", "automatic_category", "decision_summary", "confidence", "linked_proposition_id", "source_ai_message_id", "classifier_version", "attempt_count", "final_resolution", "created_at", "reviewed_category", "coder_1_category", "coder_2_category", "adjudicated_category"];

  const codingCategory = (decision: DecisionUnit, units: HumanCodedUnit[] | undefined): string => {
    if (!units?.length) return "";
    const evidenceMatch = units.find((unit) => unit.evidenceText.trim() && unit.evidenceText.trim() === decision.evidenceText?.trim());
    if (evidenceMatch) return evidenceMatch.category;
    const automaticForMessage = session.decisions.filter((item) => item.participantMessageId === decision.participantMessageId);
    const index = automaticForMessage.findIndex((item) => item.id === decision.id);
    return units.length === automaticForMessage.length && index >= 0 ? units[index]?.category ?? "" : "";
  };

  const rows = session.decisions.map((decision) => {
    const classification = (session.traceClassifications ?? []).find((item) => item.requestId === decision.classificationRequestId)
      ?? (session.traceClassifications ?? []).find((item) => item.participantMessageId === decision.participantMessageId);
    const coding = (session.humanCoding ?? []).find((item) => item.participantMessageId === decision.participantMessageId);
    return [session.id, session.participantId, session.researcherId, session.attemptNumber, session.condition, session.taskDurationMinutes, decision.id, decision.classificationRequestId, decision.timestampSeconds, decision.participantMessageId, decision.relatedTurn, decision.category, decision.originalModelCategory, decision.currentReviewedCategory, decision.action, decision.source, decision.sourceStatus, decision.object, decision.summary, decision.evidenceText, decision.linkedAiMessageIds?.join("|"), decision.linkedAiPropositionIds?.join("|"), decision.confidence, decision.confidenceScore, decision.reasonCode, decision.classifierStatus, decision.classifierPromptVersion, decision.classifiedAt, decision.reversesDecisionUnitId, decision.supersedesDecisionUnitId, decision.idempotencyKey, decision.reviewStatus, decision.reviewedAt, decision.reviewerId, decision.reviewNote, decision.originalModelLabel.action, decision.originalModelLabel.source, decision.originalModelLabel.object, decision.originalModelLabel.summary, decision.finalReviewedLabel.action, decision.finalReviewedLabel.source, decision.finalReviewedLabel.object, decision.finalReviewedLabel.summary, decision.relatedBoardEventId, decision.relatedImageId, decision.participantFacingLabel, decision.visibilityStatus, decision.classifierProvider, decision.classifierModelId, decision.classifierIntegrationMode,
      session.studyStatus ?? "development_test", decision.relatedTurn, decision.id, decision.originalModelCategory ?? decision.category, decision.originalModelLabel.summary, decision.confidenceScore, decision.linkedAiPropositionIds?.join("|"), decision.linkedAiMessageIds?.join("|"), decision.classifierPromptVersion, classification?.attemptCount, classification?.finalResolution, decision.classifiedAt, decision.currentReviewedCategory, codingCategory(decision, coding?.coder1.units), codingCategory(decision, coding?.coder2.units), codingCategory(decision, coding?.adjudication.resolvedUnits)];
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}
