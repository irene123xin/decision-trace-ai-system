import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildReducedSchemaRepairInput,
  splitDecisionCandidateSpans,
  validateMinimalUncertain,
  validateSegmentationResult,
} from "../services/decisionTraceSegmentation.ts";
import { applyTraceClassificationResponse } from "../services/decisionTraceSessionState.ts";
import { buildDecisionsCsv } from "../services/exportService.ts";
import { getParticipantVisibleDecisions } from "../services/decisionTraceClassifier.ts";
import { buildDecisionTraceTurnGroups, getCurrentDecisionGroup } from "../services/decisionTracePresentation.ts";

const message = "Keep the muted palette, remove the serif type, and introduce embossed location numbers.";

test("three action clauses segment into three exact evidence spans without categories", () => {
  const result = splitDecisionCandidateSpans(message);
  assert.equal(result.classificationStatus, "candidate_spans");
  assert.deepEqual(result.spans, ["Keep the muted palette", "remove the serif type", "introduce embossed location numbers."]);
  assert.equal(Object.hasOwn(result, "categories"), false);
});

test("model segmentation validation preserves exact spans and detects overflow", () => {
  const result = validateSegmentationResult({ classification_status: "candidate_spans", spans: ["Keep the muted palette", "remove the serif type", "introduce embossed location numbers."], overflow: false }, message);
  assert.equal(result?.spans.length, 3);
  const overflow = splitDecisionCandidateSpans("Keep A; remove B; add C; reject D");
  assert.equal(overflow.overflow, true);
  assert.equal(overflow.spans.length, 3);
});

test("uncertain uses a minimal valid record without proposition links", () => {
  const result = validateMinimalUncertain({ status: "uncertain", evidence: "Maybe the second one.", confidence: 0.52, reason_code: "unresolved_reference", possible_reference: "the second one" }, "Maybe the second one.");
  assert.equal(result?.status, "uncertain");
  assert.equal(result?.confidence, 0.52);
  assert.equal(Object.hasOwn(result ?? {}, "linked_proposition_id"), false);
});

test("schema repair payload excludes conversation and semantic context", () => {
  const repaired = buildReducedSchemaRepairInput("atomic unit", "{bad", "$.units[0].confidence", "minimal-schema");
  assert.deepEqual(Object.keys(repaired).sort(), ["malformed_response", "required_schema", "task", "validation_error_path"]);
  assert.equal(JSON.stringify(repaired).includes("recentConversation"), false);
});

test("structured stages use the model-supported bounded thinking budget", () => {
  const service = readFileSync(new URL("../services/server/geminiDecisionTraceService.ts", import.meta.url), "utf8");
  assert.match(service, /TRACE_THINKING_BUDGET_TOKENS\s*=\s*128/);
  assert.match(service, /thinkingConfig:\s*\{\s*thinkingBudget:\s*TRACE_THINKING_BUDGET_TOKENS,\s*includeThoughts:\s*false\s*\}/);
  assert.match(service, /WORKFLOW_TIMEOUT_MS\s*=\s*28_000/);
  assert.match(service, /Promise\.all\(candidateRuns\)/);
});

function unit(category, evidence, summary, confidence = 0.95) {
  return {
    category, evidenceText: evidence, summary, participantMessageId: "M03",
    linkedAiMessageIds: category === "human_initiated" ? [] : ["M02"],
    linkedAiPropositionIds: category === "human_initiated" ? [] : [`P-${category}`],
    sourceStatus: category === "human_initiated" ? "absent_from_ai_context" : "matched_structured_proposition",
    confidence, reasonCode: category === "accept" ? "explicit_adoption" : category === "reject" ? "explicit_rejection" : "participant_new_proposition",
    reversesDecisionUnitId: null, supersedesDecisionUnitId: null,
  };
}

function baseSession() {
  return {
    id: "S-MULTI", participantId: "P-TEST", condition: "B", studyStatus: "development_test", configuredDurationMinutes: 45,
    taskStartedAt: "2026-08-02T12:00:00.000Z", messages: [], decisions: [], aiPropositions: [], boardEvents: [], images: [], imageRequests: [],
    traceClassifications: [{ requestId: "trace-multi", participantMessageId: "M03", startedAt: "2026-08-02T12:00:01.000Z", status: "TRACE_CLASSIFICATION_PENDING", classifierPromptVersion: "elsewhere-decision-trace-v3", unitIds: [], propositionIds: [] }],
  };
}

test("three independently classified units merge under one turn and export as separate rows", () => {
  const participant = { id: "M03", role: "participant", content: message, turn: 2, createdAt: "2026-08-02T12:00:02.000Z" };
  const response = {
    requestId: "trace-multi", analysis: { analysisResult: "decision_units", units: [
      unit("accept", "Keep the muted palette", "Retain the muted palette."),
      unit("reject", "remove the serif type", "Exclude the serif type."),
      unit("human_initiated", "introduce embossed location numbers", "Introduce embossed location numbers."),
    ] }, propositions: [], status: "TRACE_NEEDS_REVIEW", provider: "Google Gemini", modelId: "gemini-3.6-flash", promptVersion: "elsewhere-decision-trace-v3", integrationMode: "live",
    startedAt: "2026-08-02T12:00:02.000Z", completedAt: "2026-08-02T12:00:04.000Z", latencyMs: 2000, extractionStatus: "structured", extractionAttemptCount: 1,
    attempts: [], attemptCount: 4, errorStage: "none", finalResolution: "partial_success", segmentationStatus: "multiple", segmentationEvidence: ["Keep the muted palette", "remove the serif type", "introduce embossed location numbers"], segmentationOverflow: false,
    candidateOutcomes: [
      { candidateId: "trace-multi:candidate:1", evidenceText: "Keep the muted palette", status: "classified", attempts: [], attemptCount: 1, finalResolution: "primary_model_success" },
      { candidateId: "trace-multi:candidate:2", evidenceText: "remove the serif type", status: "classified", attempts: [], attemptCount: 1, finalResolution: "primary_model_success" },
      { candidateId: "trace-multi:candidate:3", evidenceText: "introduce embossed location numbers", status: "classified", attempts: [], attemptCount: 1, finalResolution: "primary_model_success" },
    ],
  };
  const next = applyTraceClassificationResponse(baseSession(), participant, "trace-multi", response, "2026-08-02T12:00:00.000Z");
  assert.deepEqual(next.decisions.map((item) => item.category), ["accept", "reject", "human_initiated"]);
  assert.ok(next.decisions.every((item) => item.relatedTurn === 2 && item.participantMessageId === "M03"));
  const visible = getParticipantVisibleDecisions(next.decisions);
  assert.equal(visible.length, 3);
  assert.deepEqual(getCurrentDecisionGroup(visible).map((item) => item.category), ["accept", "reject", "human_initiated"]);
  assert.equal(buildDecisionTraceTurnGroups(visible).length, 1);
  assert.deepEqual(["accept", "modify", "reject", "human_initiated"].map((category) => visible.filter((item) => item.category === category).length), [1, 0, 1, 1]);
  const rows = buildDecisionsCsv(next).trim().split("\n");
  assert.equal(rows.length, 4);
  assert.equal(rows.slice(1).every((row) => row.includes("M03")), true);
});

test("one failed candidate preserves two successful units and remains researcher-visible", () => {
  const participant = { id: "M03", role: "participant", content: message, turn: 2, createdAt: "2026-08-02T12:00:02.000Z" };
  const response = {
    requestId: "trace-multi", analysis: { analysisResult: "decision_units", units: [unit("accept", "Keep the muted palette", "Retain the muted palette."), unit("reject", "remove the serif type", "Exclude the serif type.")] },
    propositions: [], status: "TRACE_NEEDS_REVIEW", provider: "Google Gemini", modelId: "gemini-3.6-flash", promptVersion: "elsewhere-decision-trace-v3", integrationMode: "live",
    startedAt: "2026-08-02T12:00:02.000Z", completedAt: "2026-08-02T12:00:04.000Z", latencyMs: 2000, extractionStatus: "structured", extractionAttemptCount: 1,
    attempts: [], attemptCount: 4, errorStage: "none", finalResolution: "partial_success", segmentationStatus: "multiple", segmentationEvidence: ["Keep the muted palette", "remove the serif type", "introduce embossed location numbers"], segmentationOverflow: false,
    candidateOutcomes: [
      { candidateId: "trace-multi:candidate:1", evidenceText: "Keep the muted palette", status: "classified", attempts: [], attemptCount: 1, finalResolution: "primary_model_success" },
      { candidateId: "trace-multi:candidate:2", evidenceText: "remove the serif type", status: "classified", attempts: [], attemptCount: 1, finalResolution: "primary_model_success" },
      { candidateId: "trace-multi:candidate:3", evidenceText: "introduce embossed location numbers", status: "failed", attempts: [], attemptCount: 2, errorStage: "schema_validation", validationPath: "$.units[0].confidence", finalResolution: "failed_classification" },
    ],
  };
  const next = applyTraceClassificationResponse(baseSession(), participant, "trace-multi", response, "2026-08-02T12:00:00.000Z");
  assert.equal(next.decisions.length, 2);
  assert.equal(next.traceClassifications[0].candidateOutcomes[2].status, "failed");
  assert.equal(next.traceClassifications[0].candidateOutcomes[2].validationPath, "$.units[0].confidence");
});

test("legacy sessions without segmentation fields remain readable", () => {
  const legacy = baseSession();
  delete legacy.traceClassifications[0].segmentationStatus;
  assert.equal(legacy.traceClassifications[0].requestId, "trace-multi");
});
