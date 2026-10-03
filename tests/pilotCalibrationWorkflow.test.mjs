import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  adjudicateCodingRecord,
  buildAtomicCodingCsv,
  buildCalibrationJson,
  buildMessageCodingCsv,
  buildPilotCalibrationSummary,
  compareAutomatedWithHuman,
  compareHumanCoders,
  createFreezeRecord,
  createMessageHumanCoding,
  ensureHumanCodingRecords,
  freezeClassifierRecord,
} from "../services/pilotCodingService.ts";
import { buildDecisionTraceTurnGroups, getCurrentDecisionGroup, participantDecisionLabel } from "../services/decisionTracePresentation.ts";
import { getParticipantVisibleDecisions } from "../services/decisionTraceClassifier.ts";

const root = new URL("../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");
const now = "2026-07-25T12:00:00.000Z";

function label(action, summary = "Neutral summary") {
  return { action, source: action === "Human-initiated" ? "Human-initiated" : "AI-initiated", object: "Other", summary };
}

function decision(id, category, evidence = "Use the muted palette.", turn = 1) {
  const action = category === "human_initiated" ? "Human-initiated" : category === "uncertain" ? "Uncertain" : category[0].toUpperCase() + category.slice(1);
  const original = label(action, `${category} direction`);
  return { id, timestampSeconds: Number(id.replace(/\D/g, "")) || 1, relatedTurn: turn, confidence: category === "uncertain" ? "Low" : "High", modelGeneratedLabel: category, reviewStatus: "Unreviewed", ...original, originalModelLabel: original, finalReviewedLabel: original, category, originalModelCategory: category, currentReviewedCategory: category, evidenceText: evidence, participantMessageId: `M${turn}`, confidenceScore: category === "uncertain" ? .55 : .88, classifierPromptVersion: "elsewhere-decision-trace-v1", classifiedAt: now, linkedAiPropositionIds: [] };
}

function unit(id, category, evidence = "Use the muted palette.") {
  return { id, category, evidenceText: category === "no_decision" ? "" : evidence, neutralSummary: category === "no_decision" ? "No actionable design decision identified." : `${category} direction`, linkedAiMessageId: null, linkedAiPropositionId: null, coderNote: null };
}

function session(studyStatus = undefined) {
  return { id: `SESSION-${studyStatus ?? "LEGACY"}`, participantId: "P01", researcherId: "R01", condition: "B", sessionDate: "2026-07-25", taskDurationMinutes: 45, startedAt: now, status: "active", studyStatus, messages: [{ id: "A0", role: "assistant", content: "Use the muted palette.", turn: 0, createdAt: now }, { id: "M1", role: "participant", content: "Use the muted palette.", turn: 1, createdAt: now }], images: [], decisions: [], aiPropositions: [], traceClassifications: [], humanCoding: [], boardEvents: [], researchEvents: [], aiTextRequests: [], imageRequests: [], imageRequestCount: 0, attemptNumber: 1, board: {} };
}

function codedRecord(categories, coder = "coder1") {
  const record = createMessageHumanCoding("S", "M1");
  record[coder] = { ...record[coder], coderId: coder.toUpperCase(), status: "coded", codedAt: now, units: categories.map((category, index) => unit(`H${index + 1}`, category)) };
  return record;
}

test("A — historical sessions default to development-test separation", () => {
  const legacy = session();
  assert.equal(buildPilotCalibrationSummary([legacy]).totalPilotSessions, 0);
  assert.match(buildMessageCodingCsv([legacy], ["development_test"]), /CAL-/);
});

test("B — pilot status includes a session in pilot calibration", () => {
  assert.equal(buildPilotCalibrationSummary([session("pilot")]).totalPilotSessions, 1);
});

test("C — coder can record no decision", () => {
  assert.equal(compareAutomatedWithHuman([], [unit("H1", "no_decision")]).result, "exact_agreement");
});

test("D — multiple human units remain atomic", () => {
  const result = compareHumanCoders([unit("H1", "accept"), unit("H2", "modify")], [unit("J1", "accept"), unit("J2", "modify")]);
  assert.equal(result.matchedUnits, 2);
  assert.equal(result.result, "exact_agreement");
});

test("E — automated coding is hidden by default and explicit reveal is tracked", () => {
  const panel = source("components/PilotCodingPanel.tsx");
  assert.match(panel, /useState<Set<string>>\(new Set\(\)\)/);
  assert.match(panel, /automatedCodingRevealedBeforeSubmission: true/);
});

test("F — other-coder reveal is unavailable until active coder submission", () => {
  const panel = source("components/PilotCodingPanel.tsx");
  assert.match(panel, /coderKey === "coder2" && activeCoder\.status !== "coded"/);
  assert.match(panel, /activeCoder\.status === "coded" && otherCoder\?\.status === "coded"/);
});

test("G — blinded workspace withholds condition and identity", () => {
  const view = source("components/ResearcherView.tsx");
  assert.match(view, /if \(codingMode\) return/);
  assert.match(view, /Condition, automated labels and participant identity are withheld/);
});

test("H — exact category and evidence agreement", () => {
  assert.equal(compareAutomatedWithHuman([decision("D1", "accept")], [unit("H1", "accept")]).result, "exact_agreement");
});

test("I — category mismatch is distinguished", () => {
  assert.equal(compareAutomatedWithHuman([decision("D1", "accept")], [unit("H1", "modify")]).result, "category_mismatch");
});

test("J — unit count mismatch is distinguished", () => {
  assert.equal(compareAutomatedWithHuman([decision("D1", "accept")], [unit("H1", "accept"), unit("H2", "modify")]).result, "unit_count_mismatch");
});

test("K — adjudication preserves both raw coder records", () => {
  const record = codedRecord(["accept"]); record.coder2 = codedRecord(["modify"], "coder2").coder2;
  const resolved = adjudicateCodingRecord(record, [unit("R1", "modify")], "R01", now);
  assert.equal(resolved.coder1.units[0].category, "accept");
  assert.equal(resolved.coder2.units[0].category, "modify");
  assert.equal(resolved.adjudication.resolvedUnits[0].category, "modify");
});

test("L — summary excludes development, formal and excluded sessions", () => {
  const items = [session("development_test"), session("pilot"), session("formal"), session("excluded")];
  assert.equal(buildPilotCalibrationSummary(items).totalPilotSessions, 1);
});

test("M — formal export excludes pilot records", () => {
  const csv = buildMessageCodingCsv([session("pilot"), session("formal")], ["formal"]);
  assert.doesNotMatch(csv, /SESSION-pilot/);
  assert.equal(csv.split("\n").length, 2);
});

test("N — exports preserve original and reviewed automated labels", () => {
  const item = session("pilot"); const changed = decision("D1", "accept"); changed.currentReviewedCategory = "modify"; item.decisions = [changed];
  const atomic = buildAtomicCodingCsv([item]);
  assert.match(atomic, /"original_category","reviewed_category"/);
  assert.match(atomic, /"accept","modify"/);
  const json = JSON.parse(buildCalibrationJson([item], { calibrationLog: [], freezeRecords: [] }));
  assert.equal(json.sessions[0].automatedDecisionUnits[0].originalModelCategory, "accept");
  assert.equal(json.sessions[0].automatedDecisionUnits[0].currentReviewedCategory, "modify");
});

test("O — classifier freeze records version, timestamp and researcher", () => {
  const draft = createFreezeRecord({ classifierPromptVersion: "elsewhere-decision-trace-v1", applicationVersion: "abc123", geminiModelId: "model-fixed", confidenceThresholds: "fixed", pilotSessionIds: ["S1"], rationale: "Pilot reviewed" });
  const frozen = freezeClassifierRecord(draft, "R01", now);
  assert.equal(frozen.status, "frozen"); assert.equal(frozen.freezeTimestamp, now); assert.equal(frozen.frozenBy, "R01");
});

test("P — coding helpers do not mutate automated Decision Units", () => {
  const item = session("pilot"); item.decisions = [decision("D1", "accept")]; const before = structuredClone(item.decisions);
  ensureHumanCodingRecords(item); compareAutomatedWithHuman(item.decisions, [unit("H1", "accept")]);
  assert.deepEqual(item.decisions, before);
});

test("Q — empty and pending participant states are present", () => {
  const trace = source("components/DecisionTrace.tsx");
  assert.match(trace, /No clear design decision has been recorded yet\./);
  assert.match(trace, /Updating…/);
  assert.doesNotMatch(trace, /Decisions appear here when you express/);
});

test("R — latest visible turn becomes Current Decision and retains multiple units", () => {
  const visible = getParticipantVisibleDecisions([decision("D1", "accept"), decision("D2", "modify", "Modify it.", 2)]);
  assert.equal(visible.at(-1).id, "D2");
  const second = decision("D3", "reject", "Remove it.", 2); second.participantMessageId = "M2";
  assert.deepEqual(getCurrentDecisionGroup([...visible, second]).map((item) => item.id), ["D2", "D3"]);
});

test("S — categories have non-colour structural treatments", () => {
  const css = source("app/globals.css");
  assert.match(css, /categoryMark\.modify[\s\S]*linear-gradient/);
  assert.match(css, /categoryMark\.reject::after/);
  assert.match(css, /categoryMark\.humaninitiated[\s\S]*rotate\(45deg\)/);
});

test("T — timeline groups multiple decisions by chronological turn", () => {
  const groups = buildDecisionTraceTurnGroups([decision("D3", "reject", "Drop it.", 2), decision("D1", "accept", "Use it.", 1), decision("D2", "modify", "Change it.", 1)]);
  assert.deepEqual(groups.map((group) => [group.turn, group.decisions.map((item) => item.id)]), [[1, ["D1", "D2"]], [2, ["D3"]]]);
});

test("U — participant visibility excludes uncertain, board and low-confidence units", () => {
  const uncertain = decision("D2", "uncertain"); const board = { ...decision("D3", "accept"), participantMessageId: undefined, relatedBoardEventId: "BE1" }; const low = { ...decision("D4", "modify"), confidenceScore: .7 }; const reviewedLow = { ...decision("D5", "accept"), confidenceScore: .75, reviewStatus: "Confirmed" };
  assert.deepEqual(getParticipantVisibleDecisions([decision("D1", "accept"), uncertain, board, low, reviewedLow]).map((item) => item.id), ["D1"]);
});

test("V — Condition B alone renders participant trace", () => {
  assert.match(source("components/ParticipantWorkspace.tsx"), /session\.condition === "B" && <DecisionTrace/);
});

test("W — Condition A receives no trace placeholder or status", () => {
  const workspace = source("components/ParticipantWorkspace.tsx");
  assert.doesNotMatch(workspace, /condition === "A"[^\n]*DecisionTrace/);
  assert.doesNotMatch(workspace, /Trace hidden|Decision Trace unavailable/);
});

test("X — A/B workspace geometry remains a shared fixed rail", () => {
  const css = source("app/globals.css");
  assert.match(css, /\.workspaceFrame \{[^}]*grid-template-columns: minmax\(0, 7fr\) minmax\(315px, 3fr\)/);
  assert.doesNotMatch(css, /\.studioGrid\.conditionA|\.studioGrid\.conditionB/);
});

test("Y — participant trace uses no decorative entry or processing animation", () => {
  const css = source("app/globals.css");
  assert.doesNotMatch(css, /traceEntry|traceSpin/);
});

test("Z — participant trace does not render confidence or review fields", () => {
  const trace = source("components/DecisionTrace.tsx");
  assert.doesNotMatch(trace, /confidenceScore|reviewStatus|currentReviewedCategory|reasonCode/);
});

test("participant label maps human_initiated to New Direction without changing stored category", () => {
  assert.equal(participantDecisionLabel("Human-initiated"), "New Direction");
  assert.equal(decision("D1", "human_initiated").category, "human_initiated");
});

test("automatic Decision Unit persistence includes reproducibility and visibility metadata", () => {
  const persistence = source("services/decisionTraceSessionState.ts");
  assert.match(persistence, /classifierProvider: response\.provider/);
  assert.match(persistence, /classifierModelId: response\.modelId/);
  assert.match(persistence, /classifierIntegrationMode: response\.integrationMode/);
  assert.match(persistence, /visibilityStatus:/);
});

test("Decision CSV appends participant visibility and classifier metadata", () => {
  const exports = source("services/exportService.ts");
  assert.match(exports, /participant_facing_label/);
  assert.match(exports, /classifier_model_id/);
  assert.match(exports, /visibility_status/);
});
