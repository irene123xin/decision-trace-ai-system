import test from "node:test";
import assert from "node:assert/strict";
import {
  createPropositionDeduplicationKey,
  deduplicateAiPropositions,
  extractAiPropositions,
  normalizePropositionText,
  ruleBasedDecisionTrace,
} from "../services/decisionTraceClassifier.ts";

const createdAt = "2026-07-25T12:00:00.000Z";
const proposition = (id, summary, aiMessageId = "M-AI-001", optionLabel) => ({ id, aiMessageId, turn: 1, summary, optionLabel, createdAt });

test("exact duplicate retains the first stable proposition ID", () => {
  const result = deduplicateAiPropositions([
    proposition("AI-PROP-STABLE", "Use a nostalgic scrapbook style with layered paper textures."),
    proposition("AI-PROP-EXTRACTED", "Use a nostalgic scrapbook style with layered paper textures."),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "AI-PROP-STABLE");
});

test("case, punctuation and repeated spacing differences deduplicate", () => {
  const result = deduplicateAiPropositions([
    proposition("AI-PROP-STABLE", "  USE   a nostalgic scrapbook style with layered paper textures!!!  "),
    proposition("AI-PROP-OTHER", "Use a nostalgic scrapbook style with layered paper textures."),
  ]);
  assert.equal(result.length, 1);
  assert.equal(normalizePropositionText("  USE   this.  "), "use this");
});

test("safe paraphrase from the same AI message deduplicates", () => {
  const result = deduplicateAiPropositions([
    proposition("AI-PROP-STABLE", "Use a nostalgic scrapbook style with layered paper textures."),
    proposition("AI-PROP-PARAPHRASE", "Nostalgic scrapbook style using layered paper textures"),
  ]);
  assert.deepEqual(result.map((item) => item.id), ["AI-PROP-STABLE"]);
});

test("different actionable propositions in one AI message remain separate", () => {
  const result = deduplicateAiPropositions([
    proposition("AI-PROP-01", "Use layered paper textures."),
    proposition("AI-PROP-02", "Use a serif wordmark."),
    proposition("AI-PROP-03", "Use a muted mineral palette."),
  ]);
  assert.deepEqual(result.map((item) => item.id), ["AI-PROP-01", "AI-PROP-02", "AI-PROP-03"]);
  assert.equal(new Set(result.map(createPropositionDeduplicationKey)).size, 3);
});

test("equivalent text from different AI messages preserves separate provenance", () => {
  const result = deduplicateAiPropositions([
    proposition("AI-PROP-01", "Use layered paper textures.", "M-AI-001"),
    proposition("AI-PROP-02", "Use layered paper textures.", "M-AI-002"),
  ]);
  assert.equal(result.length, 2);
});

test("supplied proposition wins over an equivalent automatically extracted proposition", () => {
  const supplied = proposition("AI-PROP-CONTROLLED-001", "Nostalgic scrapbook style using layered paper textures");
  const messages = [{
    id: "M-AI-001", role: "assistant", turn: 1, createdAt,
    content: "Use a nostalgic scrapbook style with layered paper textures.",
  }];
  const result = extractAiPropositions(messages, [supplied]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "AI-PROP-CONTROLLED-001");
});

test("one Decision Unit links only to the canonical proposition ID", () => {
  const supplied = proposition("AI-PROP-CONTROLLED-001", "Nostalgic scrapbook style using layered paper textures");
  const recentMessages = [
    { id: "M-AI-001", role: "assistant", turn: 1, createdAt, content: "Use a nostalgic scrapbook style with layered paper textures." },
    { id: "M-P-001", role: "participant", turn: 2, createdAt, content: "Keep the layered memory idea, but make it less nostalgic and more contemporary." },
  ];
  const canonical = extractAiPropositions(recentMessages, [supplied]);
  const result = ruleBasedDecisionTrace({
    sessionId: "SESSION-DEDUPE-001",
    participantMessage: recentMessages[1],
    recentMessages,
    aiPropositions: canonical,
    recentDecisionUnits: [],
  });
  assert.equal(result.units.length, 1);
  assert.equal(result.units[0].category, "modify");
  assert.deepEqual(result.units[0].linkedAiPropositionIds, ["AI-PROP-CONTROLLED-001"]);
});

