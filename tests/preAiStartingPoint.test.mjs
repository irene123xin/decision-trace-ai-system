import test from "node:test";
import assert from "node:assert/strict";
import {
  canAccessAiWorkspace,
  completePreAiStage,
  createPreAiStartingPoint,
  getPreAiRecordStatus,
  getPreAiValidation,
  normalisePreAiStartingPoint,
  startPreAiStage,
} from "../services/preAiStartingPoint.ts";
import { buildSessionJson, buildSessionSummaryCsv } from "../services/exportService.ts";

const baseSession = (condition = "A") => ({
  id: "SESSION-PREAI-TEST01", participantId: "P01", researcherId: "R01", condition, sessionDate: "2026-07-25",
  taskDurationMinutes: 45, configuredDurationMinutes: 45, startedAt: "2026-07-25T10:00:00.000Z", status: "briefing",
  messages: [], images: [], decisions: [], boardEvents: [], researchEvents: [], aiTextRequests: [], imageRequests: [],
  board: {}, imageRequestCount: 0, attemptNumber: 1,
});

const validDraft = (startedAt = "2026-07-25T10:04:00.000Z") => ({
  ...createPreAiStartingPoint(startedAt),
  initialInterpretation: "Elsewhere frames fragrance through everyday personal experience.",
  keywords: ["memory", "sensory detail", "everyday"] ,
  visualQuestion: "How might place be suggested without literal illustration?",
});

test("Case A and H: entering Starting Point starts timing and blocks workspace", () => {
  const started = startPreAiStage(baseSession(), "2026-07-25T10:04:00.000Z");
  assert.equal(started.status, "starting_point");
  assert.equal(started.participantStartedAt, "2026-07-25T10:04:00.000Z");
  assert.equal(started.preAiStartingPoint.status, "draft");
  assert.equal(canAccessAiWorkspace(started), false);
});

test("Case B: incomplete fields remain invalid", () => {
  const draft = { ...createPreAiStartingPoint("2026-07-25T10:04:00.000Z"), initialInterpretation: "Too short", keywords: ["one", "", "three"], visualQuestion: "Short" };
  assert.equal(getPreAiValidation(draft).isValid, false);
});

test("Cases C, D and E: valid submission stores timing, locks record and unlocks workspace", () => {
  const session = { ...startPreAiStage(baseSession(), "2026-07-25T10:04:00.000Z"), preAiStartingPoint: validDraft() };
  const completed = completePreAiStage(session, "2026-07-25T10:07:30.000Z");
  assert.equal(completed.status, "active");
  assert.equal(completed.preAiStartingPoint.status, "submitted");
  assert.equal(completed.preAiStartingPoint.durationMs, 210000);
  assert.equal(canAccessAiWorkspace(completed), true);
});

test("Cases F and G: draft and submitted records survive serialization", () => {
  const draft = normalisePreAiStartingPoint(JSON.parse(JSON.stringify(validDraft())));
  assert.deepEqual(draft.keywords, ["memory", "sensory detail", "everyday"]);
  const completed = completePreAiStage({ ...baseSession(), status: "starting_point", preAiStartingPoint: draft }, "2026-07-25T10:08:00.000Z");
  const restored = normalisePreAiStartingPoint(JSON.parse(JSON.stringify(completed.preAiStartingPoint)));
  assert.equal(restored.status, "submitted");
  assert.equal(restored.durationMs, 240000);
  assert.equal(canAccessAiWorkspace({ ...completed, preAiStartingPoint: restored }), true);
});

test("Case I: conditions use identical validation", () => {
  const record = validDraft();
  assert.equal(getPreAiValidation(record).isValid, true);
  assert.equal(canAccessAiWorkspace({ ...baseSession("A"), preAiStartingPoint: record }), false);
  assert.equal(canAccessAiWorkspace({ ...baseSession("B"), preAiStartingPoint: record }), false);
});

test("Case J: Pre-AI transitions do not create Decision Units", () => {
  const started = { ...startPreAiStage(baseSession(), "2026-07-25T10:04:00.000Z"), preAiStartingPoint: validDraft() };
  const completed = completePreAiStage(started, "2026-07-25T10:08:00.000Z");
  assert.deepEqual(completed.decisions, []);
  assert.deepEqual(completed.boardEvents, []);
});

test("Case K: researcher record status distinguishes draft and submitted", () => {
  assert.equal(getPreAiRecordStatus({ ...baseSession(), preAiStartingPoint: validDraft() }), "Draft");
  const completed = completePreAiStage({ ...baseSession(), preAiStartingPoint: validDraft() }, "2026-07-25T10:08:00.000Z");
  assert.equal(getPreAiRecordStatus(completed), "Submitted");
});

test("Case L: JSON and CSV exports preserve structured fields and keyword order", () => {
  const record = { ...validDraft(), initialInterpretation: "A precise, sensory interpretation with a comma, and detail.", keywords: ["first", "second phrase", "third"] };
  const completed = completePreAiStage({ ...baseSession(), preAiStartingPoint: record }, "2026-07-25T10:08:00.000Z");
  const json = JSON.parse(buildSessionJson(completed));
  assert.deepEqual(json.preAiStartingPoint.keywords, ["first", "second phrase", "third"]);
  const csv = buildSessionSummaryCsv(completed);
  assert.match(csv, /"pre_ai_keyword_1"/);
  assert.match(csv, /"pre_ai_duration_ms"/);
  assert.match(csv, /"first","second phrase","third"/);
  assert.match(csv, /"A precise, sensory interpretation with a comma, and detail\."/);
});

test("Case M: a legacy session remains unavailable rather than silently completed", () => {
  const legacy = baseSession();
  assert.equal(getPreAiRecordStatus(legacy), "Not available for legacy session");
  assert.equal(canAccessAiWorkspace(legacy), false);
  assert.equal("preAiStartingPoint" in JSON.parse(buildSessionJson(legacy)), false);
});
