import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractAiPropositions, getParticipantVisibleDecisions, ruleBasedDecisionTrace } from "../services/decisionTraceClassifier.ts";
import { getCurrentDecisionGroup, buildDecisionTraceTurnGroups } from "../services/decisionTracePresentation.ts";
import {
  applyTraceClassificationFailure,
  applyTraceClassificationResponse,
  expirePendingTraceClassifications,
  hasActiveTraceClassification,
} from "../services/decisionTraceSessionState.ts";

const root = new URL("../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");
const at = (seconds) => new Date(Date.parse("2026-08-02T10:00:00.000Z") + seconds * 1000).toISOString();

function message(id, turn, content) {
  return { id, role: "participant", content, turn, createdAt: at(turn) };
}

function session() {
  const messages = [
    { id: "A0", role: "assistant", content: "Use a muted mineral palette, an editorial serif, and layered-memory collage.", turn: 0, createdAt: at(0) },
    message("M1", 1, "Keep the muted mineral palette."),
    { id: "A1", role: "assistant", content: "Understood.", turn: 1, createdAt: at(2) },
    message("M2", 2, "Keep the layered-memory idea, but make it more contemporary."),
  ];
  return {
    id: "SESSION-ASYNC", participantId: "P01", researcherId: "R01", condition: "B", sessionDate: "2026-08-02",
    taskDurationMinutes: 45, startedAt: at(0), participantStartedAt: at(0), status: "active", messages, images: [], decisions: [],
    aiPropositions: [], traceClassifications: [
      { requestId: "trace-r1", participantMessageId: "M1", startedAt: at(1), status: "TRACE_CLASSIFICATION_PENDING", classifierPromptVersion: "elsewhere-decision-trace-v1", unitIds: [], propositionIds: [] },
      { requestId: "trace-r2", participantMessageId: "M2", startedAt: at(2), status: "TRACE_CLASSIFICATION_PENDING", classifierPromptVersion: "elsewhere-decision-trace-v1", unitIds: [], propositionIds: [] },
    ],
    boardEvents: [], researchEvents: [], aiTextRequests: [], imageRequests: [], imageRequestCount: 0, attemptNumber: 1, board: {},
  };
}

function response(requestId, category, summary, evidence, confidence = .91) {
  const actionCode = category === "accept" ? "explicit_adoption" : category === "modify" ? "partial_retention_with_change" : category === "reject" ? "explicit_rejection" : "participant_new_proposition";
  return {
    requestId,
    analysis: { analysisResult: "decision_units", units: [{ category, summary, evidenceText: evidence, participantMessageId: requestId === "trace-r1" ? "M1" : "M2", linkedAiMessageIds: ["A0"], linkedAiPropositionIds: category === "human_initiated" ? [] : ["P-A0"], confidence, reasonCode: actionCode, reversesDecisionUnitId: null, supersedesDecisionUnitId: null }] },
    propositions: [{ id: "P-A0", aiMessageId: "A0", turn: 0, summary: "Use a muted mineral palette.", createdAt: at(0) }],
    status: confidence >= .8 ? "TRACE_CLASSIFIED" : "TRACE_NEEDS_REVIEW",
    provider: "Mock", modelId: "mock-decision-trace-v1", promptVersion: "elsewhere-decision-trace-v1", integrationMode: "mock",
    startedAt: at(3), completedAt: at(4), latencyMs: 1000,
  };
}

test("late Accept completion cannot overwrite a newer Modify result or later transcript", () => {
  let state = session();
  state = applyTraceClassificationResponse(state, state.messages.find((item) => item.id === "M2"), "trace-r2", response("trace-r2", "modify", "Retain layered memory with a contemporary treatment.", state.messages[3].content), at(0));
  state = { ...state, messages: [...state.messages, { id: "A2", role: "assistant", content: "A later response remains present.", turn: 2, createdAt: at(5) }] };
  state = applyTraceClassificationResponse(state, state.messages.find((item) => item.id === "M1"), "trace-r1", response("trace-r1", "accept", "Keep the muted mineral palette.", state.messages[1].content), at(0));
  assert.deepEqual(state.decisions.map((item) => item.category).sort(), ["accept", "modify"]);
  assert.equal(state.messages.at(-1).id, "A2");
  assert.deepEqual(state.traceClassifications.map((item) => item.status), ["TRACE_CLASSIFIED", "TRACE_CLASSIFIED"]);
});

test("Modify, Reject and Human-initiated outcomes each persist", () => {
  for (const category of ["modify", "reject", "human_initiated"]) {
    const initial = session();
    const state = applyTraceClassificationResponse(initial, initial.messages[3], "trace-r2", response("trace-r2", category, `${category} summary`, initial.messages[3].content), at(0));
    assert.equal(state.decisions.length, 1);
    assert.equal(state.decisions[0].category, category);
  }
});

test("multiple in-flight requests may complete out of order and merge by stable idempotency key", () => {
  const initial = session();
  let state = applyTraceClassificationResponse(initial, initial.messages[3], "trace-r2", response("trace-r2", "modify", "Change the layered-memory treatment.", initial.messages[3].content), at(0));
  state = applyTraceClassificationResponse(state, initial.messages[1], "trace-r1", response("trace-r1", "accept", "Keep the muted mineral palette.", initial.messages[1].content), at(0));
  const once = state.decisions.map((item) => item.idempotencyKey);
  state = applyTraceClassificationResponse(state, initial.messages[1], "trace-r1", response("trace-r1", "accept", "Keep the muted mineral palette.", initial.messages[1].content), at(0));
  assert.equal(new Set(state.decisions.map((item) => item.id)).size, 2);
  assert.deepEqual(state.decisions.map((item) => item.idempotencyKey), once);
});

test("one failed request clears only its pending state and does not block a later success", () => {
  const initial = session();
  let state = applyTraceClassificationFailure(initial, "trace-r1", "TRACE_PROVIDER_ERROR", at(6));
  assert.equal(state.traceClassifications[0].status, "TRACE_PROVIDER_ERROR");
  assert.equal(state.traceClassifications[1].status, "TRACE_CLASSIFICATION_PENDING");
  state = applyTraceClassificationResponse(state, initial.messages[3], "trace-r2", response("trace-r2", "reject", "Remove the editorial serif.", initial.messages[3].content), at(0));
  assert.equal(state.decisions[0].category, "reject");
  assert.equal(hasActiveTraceClassification(state, Date.parse(at(7))), false);
});

test("expired pending requests resolve to a researcher-visible failure terminal state", () => {
  const initial = session();
  assert.equal(hasActiveTraceClassification(initial, Date.parse(at(10)), 20_000), true);
  const state = expirePendingTraceClassifications(initial, Date.parse(at(50)), 20_000);
  assert.equal(hasActiveTraceClassification(state, Date.parse(at(50)), 20_000), false);
  assert.ok(state.traceClassifications.every((item) => item.status === "TRACE_PROVIDER_ERROR" && item.completedAt));
});

test("low confidence units remain researcher-only and confirmed pattern counts remain exact", () => {
  const initial = session();
  let state = applyTraceClassificationResponse(initial, initial.messages[1], "trace-r1", response("trace-r1", "accept", "Keep the palette.", initial.messages[1].content, .72), at(0));
  state = applyTraceClassificationResponse(state, initial.messages[3], "trace-r2", response("trace-r2", "modify", "Change the memory treatment.", initial.messages[3].content, .9), at(0));
  const visible = getParticipantVisibleDecisions(state.decisions);
  assert.deepEqual(visible.map((item) => item.category), ["modify"]);
  assert.equal(getCurrentDecisionGroup(visible)[0].relatedTurn, 2);
});

test("multiple units from one turn remain grouped and Current Decision selects latest turn, not completion order", () => {
  const initial = session();
  const multi = response("trace-r2", "modify", "Change the memory treatment.", initial.messages[3].content);
  multi.analysis.units.push({ ...multi.analysis.units[0], category: "reject", summary: "Remove the serif.", reasonCode: "explicit_rejection", evidenceText: initial.messages[3].content, linkedAiPropositionIds: ["P-SERIF"] });
  multi.propositions.push({ id: "P-SERIF", aiMessageId: "A0", turn: 0, summary: "Use an editorial serif.", createdAt: at(0) });
  let state = applyTraceClassificationResponse(initial, initial.messages[3], "trace-r2", multi, at(0));
  state = applyTraceClassificationResponse(state, initial.messages[1], "trace-r1", response("trace-r1", "accept", "Keep the palette.", initial.messages[1].content), at(0));
  const visible = getParticipantVisibleDecisions(state.decisions);
  assert.equal(getCurrentDecisionGroup(visible).length, 2);
  assert.deepEqual(buildDecisionTraceTurnGroups(visible).map((group) => [group.turn, group.decisions.length]), [[1, 1], [2, 2]]);
});

test("Condition A runs the same classification path but renders no Trace UI", () => {
  const workspace = source("components/ParticipantWorkspace.tsx");
  assert.ok(workspace.indexOf("runTraceClassification(traceRequestId") < workspace.indexOf('session.condition === "B" && <DecisionTrace'));
  assert.doesNotMatch(workspace, /condition === "A"[^\n]*DecisionTrace/);
});

test("Condition B UI contains only neutral participant fields and an unprompting empty state", () => {
  const trace = source("components/DecisionTrace.tsx");
  assert.match(trace, /No clear design decision has been recorded yet\./);
  assert.doesNotMatch(trace, /Decisions appear here when you express/);
  assert.doesNotMatch(trace, /confidence|reasonCode|modelId|provider|proposition|reviewStatus/i);
  assert.doesNotMatch(trace, /<strong>\{(?:current|decision)\.id\}/);
});

test("legacy sessions without trace arrays remain readable", () => {
  const legacy = { ...session(), traceClassifications: undefined, aiPropositions: undefined };
  assert.equal(hasActiveTraceClassification(legacy, Date.parse(at(10))), false);
  const state = applyTraceClassificationFailure(legacy, "missing", "TRACE_PROVIDER_ERROR", at(10));
  assert.deepEqual(state.traceClassifications, []);
});

test("the controlled Accept, Modify, Reject and New Direction messages have the required proposition relationships", () => {
  const assistant = { id: "A-SETUP", role: "assistant", content: "1. Use a muted mineral palette.\n2. Use an editorial serif wordmark.\n3. Use a layered-memory collage direction.", turn: 0, createdAt: at(0) };
  const propositions = extractAiPropositions([assistant], []);
  assert.ok(propositions.some((item) => /muted mineral palette/i.test(item.summary)));
  assert.ok(propositions.some((item) => /editorial serif/i.test(item.summary)));
  assert.ok(propositions.some((item) => /layered-memory collage/i.test(item.summary)));
  assert.ok(propositions.every((item) => !/handwritten coordinates/i.test(item.summary)));
  const examples = [
    ["accept", "Keep the muted mineral palette as the main colour direction."],
    ["modify", "Keep the layered-memory idea, but make it less nostalgic and more contemporary."],
    ["reject", "Remove the editorial serif direction; I don’t want to use it."],
    ["human_initiated", "I want to introduce handwritten coordinates as a recurring graphic device."],
  ];
  for (const [expected, content] of examples) {
    const current = { id: `M-${expected}`, role: "participant", content, turn: 1, createdAt: at(1) };
    const result = ruleBasedDecisionTrace({ sessionId: "SESSION-CONTROLLED", participantMessage: current, recentMessages: [assistant, current], aiPropositions: propositions, recentDecisionUnits: [] });
    assert.ok(result.units.some((unit) => unit.category === expected), `${expected} relationship should remain eligible`);
  }
});
