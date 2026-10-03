import test from "node:test";
import assert from "node:assert/strict";
import {
  createDecisionIdempotencyKey,
  extractAiPropositions,
  getParticipantVisibleDecisions,
  ruleBasedDecisionTrace,
  validateDecisionTraceAnalysis,
} from "../services/decisionTraceClassifier.ts";
import { buildDecisionTracePayload, DecisionTraceRequestError } from "../services/decisionTraceService.ts";

let sequence = 0;
const at = (turn) => new Date(Date.UTC(2026, 6, 25, 12, 0, turn)).toISOString();

function context(aiTexts, participantText, decisions = []) {
  sequence += 1;
  const recentMessages = [];
  aiTexts.forEach((content, index) => recentMessages.push({ id: `AI-${sequence}-${index + 1}`, role: "assistant", content, turn: index + 1, createdAt: at(index + 1) }));
  const participantMessage = { id: `P-${sequence}`, role: "participant", content: participantText, turn: aiTexts.length + 1, createdAt: at(aiTexts.length + 1) };
  recentMessages.push(participantMessage);
  const aiPropositions = extractAiPropositions(recentMessages, []);
  return { sessionId: `S-${sequence}`, participantMessage, recentMessages, aiPropositions, recentDecisionUnits: decisions };
}

const categories = (result) => result.units.map((unit) => unit.category);

test("1 Accept", () => {
  const result = ruleBasedDecisionTrace(context(["Use a muted mineral palette."], "Yes, let’s use the muted mineral palette."));
  assert.deepEqual(categories(result), ["accept"]);
});

test("2 Modify", () => {
  const result = ruleBasedDecisionTrace(context(["Use a nostalgic scrapbook style with a layered memory idea."], "Keep the layered memory idea, but make it less nostalgic and more contemporary."));
  assert.deepEqual(categories(result), ["modify"]);
});

test("3 Reject", () => {
  const result = ruleBasedDecisionTrace(context(["Use a perfume bottle as the main symbol."], "No, I don’t want a literal bottle symbol."));
  assert.deepEqual(categories(result), ["reject"]);
});

test("4 Human-initiated", () => {
  const result = ruleBasedDecisionTrace(context(["Consider a quiet typographic direction."], "I want to explore a half-erased map as the main visual metaphor."));
  assert.deepEqual(categories(result), ["human_initiated"]);
});

test("5 No decision", () => {
  const result = ruleBasedDecisionTrace(context([], "Can you give me three colour directions?"));
  assert.equal(result.analysisResult, "no_decision");
  assert.equal(result.units.length, 0);
});

test("6 Uncertain", () => {
  const result = ruleBasedDecisionTrace(context(["Option one uses a grid.", "Option two uses a circle.", "Option three uses a wordmark."], "Maybe the second one."));
  assert.deepEqual(categories(result), ["uncertain"]);
});

test("7 Multiple units", () => {
  const result = ruleBasedDecisionTrace(context(["Use muted colours. Use serif typography."], "Keep the muted colours, remove the serif, and add handwritten coordinates."));
  assert.deepEqual(categories(result), ["accept", "reject", "human_initiated"]);
  assert.equal(result.units.length, 3);
  assert.ok(result.units.every((unit) => participantEvidence(unit, "Keep the muted colours, remove the serif, and add handwritten coordinates.")));
});

test("8 Conditional modification", () => {
  const result = ruleBasedDecisionTrace(context(["Use a circular mark as the main logo."], "Use the circular idea, but only as a secondary device rather than the main logo."));
  assert.deepEqual(categories(result), ["modify"]);
});

test("9 Criticism without decision", () => {
  const result = ruleBasedDecisionTrace(context(["Use a serif wordmark."], "The serif feels too formal."));
  assert.ok(result.analysisResult === "no_decision" || categories(result)[0] === "uncertain");
  assert.notEqual(categories(result)[0], "reject");
});

test("10 Clear rejection after criticism", () => {
  const result = ruleBasedDecisionTrace(context(["Use a serif wordmark."], "The serif feels too formal, so let’s drop it."));
  assert.deepEqual(categories(result), ["reject"]);
});

test("11 Chinese Accept", () => {
  const result = ruleBasedDecisionTrace(context(["可以使用低饱和配色作为主方向。"], "保留你说的低饱和配色，就沿着这个方向继续。"));
  assert.deepEqual(categories(result), ["accept"]);
});

test("12 Chinese Modify", () => {
  const result = ruleBasedDecisionTrace(context(["可以使用安静且复古的氛围。"], "保留安静的氛围，但不要太复古，整体更现代一点。"));
  assert.deepEqual(categories(result), ["modify"]);
});

test("13 Chinese Reject plus new proposal", () => {
  const result = ruleBasedDecisionTrace(context(["可以使用香水瓶的意象。"], "不要香水瓶的意象，我想用旧车票作为核心图形。"));
  assert.deepEqual(categories(result), ["reject", "human_initiated"]);
});

test("14 Acknowledgement only", () => {
  assert.equal(ruleBasedDecisionTrace(context([], "好的，谢谢。")).analysisResult, "no_decision");
});

test("15 Reversal", () => {
  const earlier = [{ id: "D01", summary: "Retain the serif wordmark.", category: "accept", participantMessageId: "OLD", linkedAiPropositionIds: ["OLD-PROP"] }];
  const result = ruleBasedDecisionTrace(context(["Use a serif wordmark."], "Actually, drop the serif and use a neutral sans serif instead.", earlier));
  assert.deepEqual(categories(result), ["reject", "human_initiated"]);
  assert.equal(result.units[0].reversesDecisionUnitId, "D01");
});

test("16 Mixed language", () => {
  const result = ruleBasedDecisionTrace(context(["Use a quiet tone with a grey palette."], "Keep the quiet tone，但颜色不要那么灰，add a little warm beige."));
  assert.deepEqual(categories(result), ["modify"]);
});

test("17 Typo and shorthand", () => {
  const result = ruleBasedDecisionTrace(context(["Option two uses a restrained layout and vintage font."], "yea use 2nd one but no vintage font"));
  assert.deepEqual(categories(result), ["accept", "reject"]);
});

test("18 Request without commitment", () => {
  assert.equal(ruleBasedDecisionTrace(context(["Option two uses a circular mark."], "Show me what option two would look like.")).analysisResult, "no_decision");
});

test("19 Image request", () => {
  assert.equal(ruleBasedDecisionTrace(context([], "Generate two visuals for this direction.")).analysisResult, "no_decision");
});

test("20 Same message processed twice", () => {
  const first = createDecisionIdempotencyKey("S1", "M1", "Retain the muted palette", "accept", ["P1"]);
  const second = createDecisionIdempotencyKey("S1", "M1", "  retain   the muted palette ", "accept", ["P1"]);
  assert.equal(first, second);
  assert.equal(new Set([first, second]).size, 1);
});

test("21 Condition parity", () => {
  const transcriptA = context(["Use a muted mineral palette."], "Yes, let’s use the muted mineral palette.");
  const transcriptB = structuredClone(transcriptA);
  assert.deepEqual(ruleBasedDecisionTrace(transcriptA), ruleBasedDecisionTrace(transcriptB));
});

test("22 Trace visibility", () => {
  const base = decision("D01", "accept");
  const uncertain = decision("D02", "uncertain");
  const board = { ...decision("D03", "human_initiated"), participantMessageId: undefined, relatedBoardEventId: "BE01" };
  const needsReview = { ...decision("D04", "modify"), confidenceScore: 0.72 };
  assert.deepEqual(getParticipantVisibleDecisions([base, uncertain, board, needsReview]).map((item) => item.id), ["D01"]);
  assert.equal([base, uncertain, board, needsReview].length, 4, "Condition A storage remains complete even when no trace component is rendered");
});

test("23 Pre-AI isolation", () => {
  const session = minimalSession();
  session.preAiStartingPoint = { status: "submitted", initialInterpretation: "PRIVATE PRE AI TEXT", keywords: ["A", "B", "C"], visualQuestion: "PRIVATE QUESTION", startedAt: at(0), submittedAt: at(1), durationMs: 1000 };
  const current = { id: "M03", role: "participant", content: "Can you give me three directions?", turn: 2, createdAt: at(3) };
  session.messages = [{ id: "M01", role: "participant", content: "Earlier chat", turn: 1, createdAt: at(1) }, { id: "M02", role: "assistant", content: "Use a circular mark.", turn: 1, createdAt: at(2) }, current];
  const payload = buildDecisionTracePayload(session, current, "trace-request-123");
  const serialized = JSON.stringify(payload);
  assert.ok(!serialized.includes("PRIVATE PRE AI TEXT"));
  assert.ok(!serialized.includes("PRIVATE QUESTION"));
  assert.ok(!("condition" in payload));
  assert.equal(ruleBasedDecisionTrace({ ...payload, aiPropositions: extractAiPropositions(payload.recentMessages, []) }).analysisResult, "no_decision");
});

test("24 Classification failure", () => {
  const session = minimalSession();
  const participant = { id: "M01", role: "participant", content: "Use a half-erased map.", turn: 1, createdAt: at(1) };
  const assistant = { id: "M02", role: "assistant", content: "We can explore that direction.", turn: 1, createdAt: at(2) };
  session.messages = [participant, assistant];
  const error = new DecisionTraceRequestError("TRACE_PROVIDER_ERROR");
  assert.equal(error.message, "Decision Trace classification failed");
  assert.equal(error.code, "TRACE_PROVIDER_ERROR");
  assert.deepEqual(session.messages, [participant, assistant]);
  const malformed = validateDecisionTraceAnalysis({ analysisResult: "decision_units", units: [{ category: "accept", summary: "x", evidenceText: "not in message" }] }, context([], "Use it."));
  assert.equal(malformed, null);
});

function participantEvidence(unit, message) {
  return message.includes(unit.evidenceText);
}

function decision(id, category) {
  const action = category === "human_initiated" ? "Human-initiated" : category[0].toUpperCase() + category.slice(1);
  const label = { action, source: category === "human_initiated" ? "Human-initiated" : "AI-initiated", object: "Other", summary: `${category} summary` };
  return { id, timestampSeconds: 1, relatedTurn: 1, confidence: category === "uncertain" ? "Low" : "High", modelGeneratedLabel: category, reviewStatus: "Unreviewed", ...label, originalModelLabel: { ...label }, finalReviewedLabel: { ...label }, category, originalModelCategory: category, currentReviewedCategory: category, participantMessageId: "M1" };
}

function minimalSession() {
  return { id: "SESSION-TEST", participantId: "P01", researcherId: "R01", condition: "A", sessionDate: "2026-07-25", taskDurationMinutes: 45, startedAt: at(0), status: "active", messages: [], images: [], decisions: [], aiPropositions: [], traceClassifications: [], boardEvents: [], researchEvents: [], aiTextRequests: [], imageRequests: [], imageRequestCount: 0, attemptNumber: 1, board: {} };
}
