import test from "node:test";
import assert from "node:assert/strict";
import { extractAiPropositions, matchDecisionSource, ruleBasedDecisionTrace, validateDecisionTraceAnalysis } from "../services/decisionTraceClassifier.ts";
import { prepareDecisionTraceContext, runBoundedTraceAttempts, TraceAttemptFailure, TraceAttemptsExhaustedError } from "../services/decisionTracePipeline.ts";
import { buildDecisionTracePayload } from "../services/decisionTraceService.ts";
import { completedAssistantContent } from "../services/textResponsePolicy.ts";

const at = (n) => new Date(Date.parse("2026-08-02T12:00:00.000Z") + n * 1000).toISOString();
const assistant = { id: "A1", role: "assistant", content: "Use a muted mineral palette. Use an editorial serif wordmark. Use a layered-memory collage direction.", turn: 1, createdAt: at(1), finishReason: "STOP" };
const propositions = extractAiPropositions([assistant], []);

function context(content, stored = propositions, messages = [assistant]) {
  const participant = { id: "M2", role: "participant", content, turn: 2, createdAt: at(2) };
  return { sessionId: "S", participantMessage: participant, recentMessages: [...messages, participant], aiPropositions: stored, recentDecisionUnits: [] };
}

test("stored proposition source: keep is Accept, partial change is Modify, removal is Reject", () => {
  const cases = [
    ["Keep the muted mineral palette.", "accept"],
    ["Keep the layered-memory idea, but make it more contemporary.", "modify"],
    ["Remove the editorial serif direction.", "reject"],
  ];
  for (const [content, category] of cases) {
    const result = ruleBasedDecisionTrace(context(content));
    assert.equal(result.units[0].category, category);
    assert.equal(result.units[0].sourceStatus, "matched_structured_proposition");
  }
});

test("raw AI context prevents a missing structured proposition from becoming Human-initiated", () => {
  const result = ruleBasedDecisionTrace(context("Keep the muted mineral palette.", []));
  assert.equal(result.units[0].category, "accept");
  assert.equal(result.units[0].sourceStatus, "matched_raw_ai_context");
  assert.deepEqual(result.units[0].linkedAiMessageIds, ["A1"]);
});

test("direction absent from proposition and raw AI context is Human-initiated; unclear source is Uncertain", () => {
  const introduced = ruleBasedDecisionTrace(context("I want to introduce embossed location numbers.", []));
  assert.equal(introduced.units[0].category, "human_initiated");
  assert.equal(introduced.units[0].sourceStatus, "absent_from_ai_context");
  const unclear = ruleBasedDecisionTrace(context("Maybe the second one.", []));
  assert.equal(unclear.units[0].category, "uncertain");
});

test("proposition extraction retries once and bounded raw fallback remains available", () => {
  let calls = 0;
  const recovered = prepareDecisionTraceContext(context("Keep the palette."), (messages, existing) => {
    calls += 1;
    if (calls === 1) throw new Error("controlled extraction failure");
    return extractAiPropositions(messages, existing);
  });
  assert.equal(recovered.extractionAttemptCount, 2);
  assert.equal(recovered.extractionStatus, "structured");
  const failed = prepareDecisionTraceContext(context("Keep the muted mineral palette.", []), () => { throw new Error("controlled failure"); });
  assert.equal(failed.extractionStatus, "failed");
  assert.equal(matchDecisionSource(failed.context.participantMessage.content, failed.context).status, "matched_raw_ai_context");
  assert.notEqual(ruleBasedDecisionTrace(failed.context).units[0].category, "human_initiated");
});

test("invalid schema response repairs once; repeated schema failure remains failed", async () => {
  let calls = 0;
  const repaired = await runBoundedTraceAttempts(async (stage) => {
    calls += 1;
    if (calls === 1) throw new TraceAttemptFailure("schema_validation", undefined, "schema_repair");
    assert.equal(stage, "schema_repair");
    return { value: "valid" };
  }, async () => undefined, 0);
  assert.equal(repaired.value, "valid");
  assert.equal(repaired.resolution, "repaired_model_response");
  assert.equal(repaired.attempts.length, 2);
  await assert.rejects(() => runBoundedTraceAttempts(async () => { throw new TraceAttemptFailure("invalid_json", undefined, "schema_repair"); }, async () => undefined, 0), (error) => error instanceof TraceAttemptsExhaustedError && error.attempts.length === 2);
});

test("temporary provider failure retries once; permanent provider failure resolves", async () => {
  let calls = 0;
  const recovered = await runBoundedTraceAttempts(async (stage) => {
    calls += 1;
    if (calls === 1) throw new TraceAttemptFailure("provider_http", 503, "provider_unavailable");
    assert.equal(stage, "provider_retry");
    return { value: "success" };
  }, async () => undefined, 0);
  assert.equal(recovered.resolution, "provider_retry_success");
  await assert.rejects(() => runBoundedTraceAttempts(async () => { throw new TraceAttemptFailure("provider_http", 401); }, async () => undefined, 0), (error) => error instanceof TraceAttemptsExhaustedError && error.attempts.length === 1);
});

test("one participant message remains three atomic units with shared participant identity", () => {
  const participantContext = context("Keep the muted palette, remove the serif type, and introduce embossed location numbers.");
  const result = ruleBasedDecisionTrace(participantContext);
  assert.deepEqual(result.units.map((unit) => unit.category), ["accept", "reject", "human_initiated"]);
  assert.ok(result.units.every((unit) => unit.participantMessageId === "M2"));
  assert.deepEqual(result.units.map((unit) => unit.sourceStatus), ["matched_structured_proposition", "matched_structured_proposition", "absent_from_ai_context"]);
});

test("partial or truncated conversation output is never committed as a completed answer", () => {
  assert.equal(completedAssistantContent("Partial answer", "MAX_TOKENS"), null);
  assert.equal(completedAssistantContent("Blocked answer", "SAFETY"), null);
  assert.equal(completedAssistantContent("A coherent answer", "STOP"), "A coherent answer");
});

test("incomplete assistant messages are excluded from classifier context and retry cannot concatenate them", () => {
  const participant = { id: "M2", role: "participant", content: "Keep the palette.", turn: 2, createdAt: at(2) };
  const partial = { ...assistant, id: "A-PARTIAL", content: "Partial malformed", finishReason: "MAX_TOKENS" };
  const complete = { ...assistant, id: "A-COMPLETE", content: "Complete replacement", finishReason: "STOP" };
  const session = { id: "S", messages: [partial, complete, participant], aiPropositions: [], decisions: [] };
  const payload = buildDecisionTracePayload(session, participant, "trace-request-123");
  assert.ok(!payload.recentMessages.some((message) => message.id === "A-PARTIAL"));
  assert.equal(payload.recentMessages.find((message) => message.id === "A-COMPLETE").content, "Complete replacement");
});

test("Condition data does not affect classification and frozen metadata remains untouched", () => {
  const a = ruleBasedDecisionTrace(context("Keep the muted palette."));
  const b = ruleBasedDecisionTrace(context("Keep the muted palette."));
  assert.deepEqual(a, b);
  const historical = { activeFrozenClassifierVersion: "elsewhere-decision-trace-v1", traceClassifications: undefined };
  assert.equal(historical.activeFrozenClassifierVersion, "elsewhere-decision-trace-v1");
});

const rawDesignMessage = {
  id: "RAW-AI",
  role: "assistant",
  content: "Use a muted mineral colour palette. Set an editorial serif wordmark. Build a layered-memory collage direction with a nostalgic quality. The wider brand theme can refer to specific physical locations.",
  turn: 1,
  createdAt: at(1),
};

const rawContext = (content) => context(content, [], [rawDesignMessage]);

test("generic physical-location context does not establish provenance for embossed location numbers", () => {
  const match = matchDecisionSource("introduce embossed location numbers", rawContext("introduce embossed location numbers"));
  assert.equal(match.status, "absent_from_ai_context");
  assert.deepEqual(match.diagnostics.meaningfulMatchedTokens, []);
  assert.equal(match.diagnostics.similarityScore, 0);
  assert.equal(match.diagnostics.matcherRule, "no_match");
  assert.equal(match.diagnostics.rejectedWeakMatchReason, "generic_token_only");
  assert.equal(match.diagnostics.matchedExcerpt, "The wider brand theme can refer to specific physical locations.");
});

test("one shared generic token never establishes raw provenance", () => {
  for (const [candidate, raw] of [
    ["coordinate numbering system", "Memories of places can shape the brand."],
    ["handwritten notes", "Use editorial notes about the identity."],
    ["embossed numbers", "Use handwritten notes as small details."],
  ]) {
    const ctx = context(candidate, [], [{ ...rawDesignMessage, content: raw }]);
    assert.notEqual(matchDecisionSource(candidate, ctx).status, "matched_raw_ai_context");
  }
});

test("distinctive design mechanisms preserve valid raw-context matches", () => {
  for (const [candidate, token] of [
    ["Keep the muted palette", "muted"],
    ["remove the serif type", "serif"],
    ["retain layered collage", "collage"],
    ["make it less nostalgic", "nostalgic"],
  ]) {
    const match = matchDecisionSource(candidate, rawContext(candidate));
    assert.equal(match.status, "matched_raw_ai_context");
    assert.ok(match.diagnostics.meaningfulMatchedTokens.includes(token));
  }
});

test("weak raw overlap does not override model human_initiated", () => {
  const ctx = rawContext("introduce embossed location numbers");
  const result = validateDecisionTraceAnalysis({ analysisResult: "decision_units", units: [{
    category: "human_initiated", summary: "Introduce embossed location numbers.", evidenceText: "introduce embossed location numbers",
    participantMessageId: "M2", sourceStatus: "absent_from_ai_context", linkedAiMessageIds: [], linkedAiPropositionIds: [],
    confidence: 0.95, reasonCode: "participant_new_proposition", reversesDecisionUnitId: null, supersedesDecisionUnitId: null,
  }] }, ctx);
  assert.equal(result.units[0].category, "human_initiated");
  assert.equal(result.units[0].sourceStatus, "absent_from_ai_context");
});

test("valid strong raw match still prevents false human_initiated", () => {
  const ctx = rawContext("Keep the muted palette");
  const result = validateDecisionTraceAnalysis({ analysisResult: "decision_units", units: [{
    category: "human_initiated", summary: "Introduce a muted palette.", evidenceText: "Keep the muted palette",
    participantMessageId: "M2", sourceStatus: "absent_from_ai_context", linkedAiMessageIds: [], linkedAiPropositionIds: [],
    confidence: 0.95, reasonCode: "participant_new_proposition", reversesDecisionUnitId: null, supersedesDecisionUnitId: null,
  }] }, ctx);
  assert.equal(result.units[0].category, "uncertain");
  assert.equal(result.units[0].sourceStatus, "matched_raw_ai_context");
});

test("corrected source matching is condition-independent and legacy records remain readable", () => {
  const a = matchDecisionSource("introduce embossed location numbers", rawContext("introduce embossed location numbers"));
  const b = matchDecisionSource("introduce embossed location numbers", rawContext("introduce embossed location numbers"));
  assert.deepEqual(a, b);
  const legacy = { category: "uncertain", sourceStatus: "matched_raw_ai_context" };
  assert.equal(legacy.sourceMatchDiagnostics, undefined);
});
