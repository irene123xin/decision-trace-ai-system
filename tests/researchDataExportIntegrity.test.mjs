import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildDecisionsCsv, buildSessionJson } from "../services/exportService.ts";
import { auditSessionIntegrity, buildControlledStabilitySummary, CONTROLLED_STABILITY_CASES, evaluateControlledDevelopmentSession } from "../services/researchDataAudit.ts";

const researcherViewSource = readFileSync(new URL("../components/ResearcherView.tsx", import.meta.url), "utf8");
const now = "2026-08-02T10:00:00.000Z";

function label(category, summary) {
  const action = { accept: "Accept", modify: "Modify", reject: "Reject", human_initiated: "Human-initiated", uncertain: "Uncertain" }[category];
  const source = category === "modify" ? "Mixed" : category === "human_initiated" ? "Human-initiated" : category === "uncertain" ? "Unclear" : "AI-initiated";
  return { action, source, object: "Other", summary };
}

function decision(id, messageId, turn, category, options = {}) {
  const summary = options.summary ?? `${category} direction`;
  const original = label(category, summary);
  const reviewedCategory = options.reviewedCategory ?? category;
  return {
    id, timestampSeconds: turn, relatedTurn: turn, confidence: options.confidenceScore >= 0.8 ? "High" : options.confidenceScore >= 0.65 ? "Medium" : "Low",
    modelGeneratedLabel: category, reviewStatus: options.reviewedCategory ? "Corrected" : "Unreviewed", ...original,
    originalModelLabel: original, finalReviewedLabel: label(reviewedCategory, summary), category, originalModelCategory: category,
    currentReviewedCategory: reviewedCategory, evidenceText: options.evidence ?? summary, participantMessageId: messageId,
    linkedAiMessageIds: options.linkedAiMessageIds ?? ["A1"], linkedAiPropositionIds: options.linkedAiPropositionIds ?? ["PROP1"],
    confidenceScore: options.confidenceScore ?? 0.9, reasonCode: options.reasonCode ?? "explicit_adoption", sourceStatus: options.sourceStatus ?? "matched_structured_proposition",
    classificationRequestId: `TRACE-${messageId}`, classifierStatus: options.classifierStatus ?? "TRACE_CLASSIFIED", classifierPromptVersion: "elsewhere-decision-trace-v2",
    classifierProvider: "Google Gemini", classifierModelId: "configured-model", classifierIntegrationMode: "live",
    participantFacingLabel: category === "human_initiated" ? "New Direction" : original.action,
    visibilityStatus: (options.confidenceScore ?? 0.9) >= 0.8 && category !== "uncertain" ? "participant_visible" : category === "uncertain" ? "hidden_uncertain" : "researcher_review",
    classifiedAt: now, idempotencyKey: `key-${id}`,
  };
}

function baseSession(condition = "B") {
  return {
    id: `SESSION-${condition}`, participantId: `P-${condition}`, researcherId: "R01", condition, sessionDate: "2026-08-02", taskDurationMinutes: 45,
    configuredDurationMinutes: 45, startedAt: now, participantStartedAt: now, status: "active", studyStatus: "development_test", attemptNumber: 1,
    brandBriefId: "elsewhere-fragrance-v2", taskGuideVersion: "elsewhere-guide-v2", textPromptVersion: "elsewhere-text-v2",
    messages: [{ id: "A1", role: "assistant", content: "Use a muted palette and editorial serif.", turn: 1, createdAt: now, modelId: "configured-model", finishReason: "STOP" }],
    images: [], decisions: [], aiPropositions: [{ id: "PROP1", aiMessageId: "A1", turn: 1, summary: "Use a muted palette.", createdAt: now }],
    traceClassifications: [], humanCoding: [], boardEvents: [], researchEvents: [], aiTextRequests: [], imageRequests: [], imageRequestCount: 0,
    preAiStartingPoint: { status: "submitted", initialInterpretation: "A sensory fragrance identity direction.", keywords: ["sensory", "memory", "place"], visualQuestion: "How might place become a graphic system?", startedAt: now, submittedAt: now, durationMs: 120000 },
    board: { concept: "", keywords: [], personalityTraits: [], audienceDescription: "", audienceCoreNeed: "", audienceEmotionalResponse: "", primaryColour: "", secondaryColour1: "", secondaryColour2: "", accentColour: "", paletteRationale: "", primaryTypeStyle: "", secondaryTypeStyle: "", typographyMood: [], typographyRationale: "", logoDirectionNote: "", selectedVisualImageIds: [], visualReferenceNotes: {}, toneTraits: [], sampleLine: "", visualDos: [], visualDonts: [], rationale: "", confirmedSections: [] },
  };
}

function addCase(session, category, options = {}) {
  const turn = session.messages.filter((message) => message.role === "participant").length + 2;
  const messageId = `M${turn}`;
  session.messages.push({ id: messageId, role: "participant", content: options.message ?? `${category} test`, turn, createdAt: now });
  const item = decision(`D${turn}`, messageId, turn, category, options);
  session.decisions.push(item);
  session.traceClassifications.push({ requestId: `TRACE-${messageId}`, participantMessageId: messageId, startedAt: now, completedAt: now, status: options.classifierStatus ?? (category === "uncertain" ? "TRACE_NEEDS_REVIEW" : "TRACE_CLASSIFIED"), analysisResult: "decision_units", classifierPromptVersion: "elsewhere-decision-trace-v2", provider: "Google Gemini", modelId: "configured-model", latencyMs: 900, totalDurationMs: 900, unitIds: [item.id], propositionIds: ["PROP1"], attempts: [{ attempt: 1, stage: "primary", startedAt: now, completedAt: now, status: "succeeded", latencyMs: 900 }], attemptCount: options.attemptCount ?? 1, finalResolution: options.finalResolution ?? "primary_model_success", errorStage: "none" });
  return { messageId, item };
}

function parseCsv(csv) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (char === '"' && quoted && csv[index + 1] === '"') { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if (char === "\n" && !quoted) { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  row.push(cell); rows.push(row);
  const [header, ...values] = rows;
  return values.map((items) => Object.fromEntries(header.map((name, index) => [name, items[index] ?? ""])));
}

for (const category of ["accept", "modify", "reject", "human_initiated"]) {
  test(`${category} automatic data is retained in researcher UI, JSON and CSV`, () => {
    const session = baseSession();
    addCase(session, category);
    const json = JSON.parse(buildSessionJson(session));
    const rows = parseCsv(buildDecisionsCsv(session));
    assert.equal(json.decisions[0].originalModelCategory, category);
    assert.equal(rows[0].automatic_category, category);
    assert.match(researcherViewSource, /Original automated result/);
    assert.match(researcherViewSource, /originalModelCategory/);
  });
}

test("multiple-unit message exports as three atomic rows", () => {
  const session = baseSession();
  const messageId = "M2";
  session.messages.push({ id: messageId, role: "participant", content: CONTROLLED_STABILITY_CASES[5].message, turn: 2, createdAt: now });
  session.decisions.push(decision("D1", messageId, 2, "accept"), decision("D2", messageId, 2, "reject"), decision("D3", messageId, 2, "human_initiated", { linkedAiMessageIds: [], linkedAiPropositionIds: [], sourceStatus: "absent_from_ai_context" }));
  session.traceClassifications.push({ requestId: `TRACE-${messageId}`, participantMessageId: messageId, startedAt: now, completedAt: now, status: "TRACE_CLASSIFIED", classifierPromptVersion: "elsewhere-decision-trace-v2", unitIds: ["D1", "D2", "D3"], propositionIds: ["PROP1"], attemptCount: 1, finalResolution: "primary_model_success" });
  const rows = parseCsv(buildDecisionsCsv(session));
  assert.equal(rows.length, 3);
  assert.deepEqual(new Set(rows.map((row) => row.participant_message_id)), new Set([messageId]));
  assert.deepEqual(new Set(rows.map((row) => row.participant_turn)), new Set(["2"]));
});

test("no_decision classification remains auditable without a Decision CSV row", () => {
  const session = baseSession();
  session.messages.push({ id: "M2", role: "participant", content: "Give me more options.", turn: 2, createdAt: now });
  session.traceClassifications.push({ requestId: "TRACE-M2", participantMessageId: "M2", startedAt: now, completedAt: now, status: "TRACE_NO_DECISION", analysisResult: "no_decision", classifierPromptVersion: "elsewhere-decision-trace-v2", unitIds: [], propositionIds: [], attemptCount: 1, finalResolution: "no_decision" });
  assert.equal(parseCsv(buildDecisionsCsv(session)).length, 0);
  assert.equal(JSON.parse(buildSessionJson(session)).traceClassifications[0].analysisResult, "no_decision");
});

test("uncertain result remains researcher-only", () => {
  const session = baseSession();
  addCase(session, "uncertain", { confidenceScore: 0.55 });
  assert.equal(session.decisions[0].visibilityStatus, "hidden_uncertain");
  assert.equal(parseCsv(buildDecisionsCsv(session))[0].visibility_status, "hidden_uncertain");
});

test("Condition A and B store equivalent classifier structures and A export includes them", () => {
  const a = baseSession("A"), b = baseSession("B");
  addCase(a, "accept"); addCase(b, "accept");
  const strip = (session) => JSON.parse(buildSessionJson(session)).decisions.map(({ id, ...unit }) => ({ ...unit, id: "stable" }));
  assert.deepEqual(strip(a), strip(b));
  assert.equal(parseCsv(buildDecisionsCsv(a))[0].condition, "A");
});

test("failed classification remains auditable", () => {
  const session = baseSession();
  session.traceClassifications.push({ requestId: "TRACE-M2", participantMessageId: "M2", startedAt: now, completedAt: now, status: "TRACE_PROVIDER_ERROR", classifierPromptVersion: "elsewhere-decision-trace-v2", unitIds: [], propositionIds: [], attemptCount: 2, errorStage: "provider_http", providerStatusCode: 503, finalResolution: "failed_classification" });
  const json = JSON.parse(buildSessionJson(session));
  assert.equal(json.traceClassifications[0].providerStatusCode, 503);
  assert.equal(buildControlledStabilitySummary([session]).finalFailures, 1);
});

test("retry success metadata is added to each Decision CSV row", () => {
  const session = baseSession();
  addCase(session, "modify", { attemptCount: 2, finalResolution: "provider_retry_success" });
  const row = parseCsv(buildDecisionsCsv(session))[0];
  assert.equal(row.attempt_count, "2");
  assert.equal(row.final_resolution, "provider_retry_success");
});

test("human review never overwrites the raw automatic category", () => {
  const session = baseSession();
  addCase(session, "accept", { reviewedCategory: "modify" });
  const row = parseCsv(buildDecisionsCsv(session))[0];
  assert.equal(row.automatic_category, "accept");
  assert.equal(row.reviewed_category, "modify");
});

test("legacy sessions without V2 fields remain readable", () => {
  const session = baseSession();
  const original = label("accept", "Legacy decision");
  session.decisions.push({ id: "D1", timestampSeconds: 1, relatedTurn: null, confidence: "High", modelGeneratedLabel: "legacy", reviewStatus: "Unreviewed", ...original, originalModelLabel: original, finalReviewedLabel: original });
  assert.doesNotThrow(() => buildSessionJson(session));
  assert.doesNotThrow(() => buildDecisionsCsv(session));
});

test("known secret-bearing fields are removed from JSON and CSV exports", () => {
  const session = baseSession();
  session.apiKey = "secret-value";
  session.authorization = "Bearer secret-value";
  session.headers = { Authorization: "Bearer secret-value" };
  session.systemInstruction = "hidden prompt";
  const exported = `${buildSessionJson(session)}\n${buildDecisionsCsv(session)}`;
  assert.doesNotMatch(exported, /secret-value|hidden prompt|Bearer/);
});

test("unresolved pending records are not treated as completed", () => {
  const session = baseSession();
  session.traceClassifications.push({ requestId: "TRACE-M2", participantMessageId: "M2", startedAt: now, status: "TRACE_CLASSIFICATION_PENDING", classifierPromptVersion: "elsewhere-decision-trace-v2", unitIds: [], propositionIds: [] });
  const audit = auditSessionIntegrity(session);
  assert.equal(audit.status, "issues");
  assert.ok(audit.issues.includes("unresolved pending classification"));
  assert.equal(buildControlledStabilitySummary([session]).successfulOnFirstAttempt, 0);
});

test("export counts match session record counts", () => {
  const session = baseSession();
  addCase(session, "accept"); addCase(session, "reject");
  const audit = auditSessionIntegrity(session);
  assert.equal(audit.decisionUnits, 2);
  assert.equal(audit.csvDecisionRows, 2);
  assert.equal(audit.status, "pass");
});

test("controlled evaluator keeps development diagnostics separate from classification logic", () => {
  const session = baseSession();
  CONTROLLED_STABILITY_CASES.forEach((item, index) => {
    const id = `CM${index + 1}`;
    session.messages.push({ id, role: "participant", content: item.message, turn: index + 1, createdAt: now });
    const multipleEvidence = ["Keep the muted palette", "remove the serif type", "introduce embossed location numbers"];
    const units = item.expected.map((category, unitIndex) => decision(`CD${index + 1}-${unitIndex + 1}`, id, index + 1, category, { evidence: item.key === "multiple" ? multipleEvidence[unitIndex] : undefined, confidenceScore: category === "uncertain" ? 0.55 : 0.9, linkedAiMessageIds: category === "human_initiated" ? [] : ["A1"], linkedAiPropositionIds: category === "human_initiated" ? [] : ["PROP1"], sourceStatus: category === "human_initiated" ? "absent_from_ai_context" : "matched_structured_proposition" }));
    session.decisions.push(...units);
    session.traceClassifications.push({ requestId: `TRACE-${id}`, participantMessageId: id, startedAt: now, completedAt: now, status: item.key === "setup" || item.key === "no_decision" ? "TRACE_NO_DECISION" : item.key === "uncertain" ? "TRACE_NEEDS_REVIEW" : "TRACE_CLASSIFIED", analysisResult: units.length ? "decision_units" : "no_decision", classifierPromptVersion: "elsewhere-decision-trace-v2", unitIds: units.map((unit) => unit.id), propositionIds: [], attemptCount: 1, finalResolution: units.length ? item.key === "uncertain" ? "needs_review" : "primary_model_success" : "no_decision", totalDurationMs: 500 });
  });
  const result = evaluateControlledDevelopmentSession(session);
  assert.equal(result.finalResult, "pass");
  assert.equal(buildControlledStabilitySummary([session]).controlledSessions, 1);
});
