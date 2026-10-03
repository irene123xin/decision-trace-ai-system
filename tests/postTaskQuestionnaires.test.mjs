import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildDecisionsCsv, buildSessionJson, buildSessionSummaryCsv } from "../services/exportService.ts";
import {
  ADDITIONAL_QUESTIONNAIRE_URL,
  canCompleteQuestionnaireWorkflow,
  completePostTaskStudy,
  createPostTaskQuestionnaires,
  MAIN_QUESTIONNAIRE_URL,
  markQuestionnaireOpened,
  normalisePostTaskQuestionnaires,
  setQuestionnaireConfirmation,
} from "../services/postTaskQuestionnaires.ts";

const componentSource = readFileSync(new URL("../components/PostTaskQuestionnaire.tsx", import.meta.url), "utf8");
const participantRouteSource = readFileSync(new URL("../app/session/[sessionId]/page.tsx", import.meta.url), "utf8");
const workspaceSource = readFileSync(new URL("../components/ParticipantWorkspace.tsx", import.meta.url), "utf8");
const researcherSource = readFileSync(new URL("../components/ResearcherView.tsx", import.meta.url), "utf8");
const demoSessionSource = readFileSync(new URL("../data/demoSession.ts", import.meta.url), "utf8");
const now = "2026-08-04T10:00:00.000Z";

const session = (condition = "A") => ({
  id: `SESSION-${condition}`, participantId: `P-${condition}`, researcherId: "R01", condition, sessionDate: "2026-08-04",
  taskDurationMinutes: 45, configuredDurationMinutes: 45, startedAt: now, status: "ready", attemptNumber: 1,
  messages: [], images: [], decisions: [], boardEvents: [], researchEvents: [], aiTextRequests: [], imageRequests: [],
  board: {}, imageRequestCount: 0, postTaskQuestionnaires: createPostTaskQuestionnaires(condition),
});

function csvRecord(csv) {
  const parse = (line) => {
    const values = []; let value = "", quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = !quoted;
      else if (character === "," && !quoted) { values.push(value); value = ""; }
      else value += character;
    }
    values.push(value); return values;
  };
  const [header, row] = csv.split("\n").map(parse);
  return Object.fromEntries(header.map((key, index) => [key, row[index]]));
}

test("questionnaire route remains inaccessible until the completed Final Review submits", () => {
  const fresh = session("A");
  assert.equal(fresh.status, "ready");
  assert.match(demoSessionSource, /postTaskQuestionnaires: createPostTaskQuestionnaires\(setup\.condition\)/);
  assert.match(participantRouteSource, /session\.status === "questionnaire"/);
  assert.match(workspaceSource, /getBoardErrors\(latestSession\.current\.board\)/);
  assert.match(workspaceSource, /status: "questionnaire"/);
});

test("Condition A requires only the main questionnaire", () => {
  const workflow = createPostTaskQuestionnaires("A");
  assert.equal(workflow.main.required, true);
  assert.equal(workflow.additional.required, false);
});

test("Condition B requires the main and additional questionnaires", () => {
  const workflow = createPostTaskQuestionnaires("B");
  assert.equal(workflow.main.required, true);
  assert.equal(workflow.additional.required, true);
});

test("participant condition is not requested and participant code is copied exactly", () => {
  assert.doesNotMatch(componentSource, /Condition A|Condition B|condition selector/i);
  assert.match(componentSource, /session\.participantId/);
  assert.match(componentSource, /navigator\.clipboard\.writeText\(session\.participantId\)/);
  assert.match(componentSource, /Participant code copied/);
});

test("external questionnaire links are exact, safe and open in new tabs", () => {
  assert.equal(MAIN_QUESTIONNAIRE_URL, "https://example.com/main-questionnaire");
  assert.equal(ADDITIONAL_QUESTIONNAIRE_URL, "https://example.com/additional-questionnaire");
  assert.match(componentSource, /href=\{MAIN_QUESTIONNAIRE_URL\}/);
  assert.match(componentSource, /href=\{ADDITIONAL_QUESTIONNAIRE_URL\}/);
  assert.match(componentSource, /target="_blank" rel="noopener noreferrer"/);
});

test("Condition A completes only after main confirmation", () => {
  let workflow = createPostTaskQuestionnaires("A");
  assert.equal(canCompleteQuestionnaireWorkflow(workflow), false);
  workflow = setQuestionnaireConfirmation(workflow, "main", true, now);
  assert.equal(canCompleteQuestionnaireWorkflow(workflow), true);
});

test("Condition B completes only after both confirmations", () => {
  let workflow = createPostTaskQuestionnaires("B");
  workflow = setQuestionnaireConfirmation(workflow, "main", true, now);
  assert.equal(canCompleteQuestionnaireWorkflow(workflow), false);
  workflow = setQuestionnaireConfirmation(workflow, "additional", true, now);
  assert.equal(canCompleteQuestionnaireWorkflow(workflow), true);
});

test("completion locks the participant session and retains link and confirmation timestamps", () => {
  let current = session("B");
  current.status = "questionnaire";
  current.participantStartedAt = "2026-08-04T09:00:00.000Z";
  let workflow = markQuestionnaireOpened(current.postTaskQuestionnaires, "main", "2026-08-04T10:01:00.000Z");
  workflow = setQuestionnaireConfirmation(workflow, "main", true, "2026-08-04T10:05:00.000Z");
  workflow = markQuestionnaireOpened(workflow, "additional", "2026-08-04T10:06:00.000Z");
  workflow = setQuestionnaireConfirmation(workflow, "additional", true, "2026-08-04T10:10:00.000Z");
  const completed = completePostTaskStudy({ ...current, postTaskQuestionnaires: workflow }, "2026-08-04T10:11:00.000Z");
  assert.equal(completed.status, "submitted");
  assert.equal(completed.endedAt, "2026-08-04T10:11:00.000Z");
  assert.equal(completed.postTaskQuestionnaires.studyCompletedAt, "2026-08-04T10:11:00.000Z");
  assert.equal(completed.postTaskQuestionnaires.main.openedAt, "2026-08-04T10:01:00.000Z");
  assert.equal(completed.completionTimeSeconds, 4260);
});

test("incomplete confirmations cannot complete the study", () => {
  const current = { ...session("B"), status: "questionnaire" };
  assert.equal(completePostTaskStudy(current, now), current);
});

test("historical sessions without questionnaire metadata remain readable", () => {
  const legacy = session("A");
  delete legacy.postTaskQuestionnaires;
  assert.doesNotThrow(() => buildSessionJson(legacy));
  assert.doesNotThrow(() => buildSessionSummaryCsv(legacy));
  assert.equal("postTaskQuestionnaires" in JSON.parse(buildSessionJson(legacy)), false);
  assert.equal(normalisePostTaskQuestionnaires(createPostTaskQuestionnaires("B"), "A").additional.required, false);
});

test("researcher record exposes all questionnaire workflow statuses", () => {
  assert.match(researcherSource, /Post-task questionnaire status/);
  assert.match(researcherSource, /Main questionnaire opened/);
  assert.match(researcherSource, /Additional participant confirmation/);
  assert.match(researcherSource, /Not required/);
});

test("JSON and session CSV include workflow metadata but Decision CSV does not", () => {
  const current = session("B");
  current.postTaskQuestionnaires = {
    main: { required: true, openedAt: now, participantConfirmedSubmitted: true, confirmedAt: now },
    additional: { required: true, openedAt: now, participantConfirmedSubmitted: true, confirmedAt: now },
    studyCompletedAt: now,
  };
  const json = JSON.parse(buildSessionJson(current));
  assert.equal(json.postTaskQuestionnaires.main.openedAt, now);
  const record = csvRecord(buildSessionSummaryCsv(current));
  assert.equal(record.main_questionnaire_required, "true");
  assert.equal(record.additional_questionnaire_confirmed, "true");
  assert.equal(record.study_completed_at, now);
  assert.doesNotMatch(buildDecisionsCsv(current).split("\n")[0], /questionnaire/);
});

test("questionnaire exports do not expose known secret fields", () => {
  const current = session("A");
  current.apiKey = "DO-NOT-EXPORT";
  current.researcherAccessPin = "1234";
  const exported = `${buildSessionJson(current)}\n${buildSessionSummaryCsv(current)}`;
  assert.doesNotMatch(exported, /DO-NOT-EXPORT|1234/);
});
