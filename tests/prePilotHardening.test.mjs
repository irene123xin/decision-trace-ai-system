import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canClaimParticipantTabLock } from "../services/participantTabLock.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const lock = read("services/participantTabLock.ts");
const participantHook = read("components/useParticipantSession.ts");
const participantPage = read("app/session/[sessionId]/page.tsx");
const setup = read("components/SessionSetup.tsx");
const setupApp = read("components/ResearcherSetupApp.tsx");
const creation = read("app/api/sessions/route.ts");
const environment = read("services/server/environment.ts");
const participantPayload = read("services/server/sessionPayload.ts");
const chatRoute = read("app/api/chat/route.ts");
const traceRoute = read("app/api/decision-trace/route.ts");
const modelAuth = read("services/server/participantModelAuth.ts");
const board = read("components/WorkingBoard.tsx");

test("one participant tab owns editing and a second tab is neutrally blocked", () => {
  assert.match(lock, /BroadcastChannel/);
  assert.match(lock, /localStorage/);
  assert.match(lock, /PARTICIPANT_TAB_HEARTBEAT_MS/);
  assert.match(lock, /expiresAt <= now/);
  assert.match(participantPage, /This session is already open in another tab\./);
  assert.match(participantHook, /tabBlocked/);
});

test("active ownership blocks another tab while an expired lock is recoverable", () => {
  const current = JSON.stringify({ ownerId: "tab-one", expiresAt: 20_000 });
  assert.equal(canClaimParticipantTabLock(current, "tab-two", 10_000), false);
  assert.equal(canClaimParticipantTabLock(current, "tab-one", 10_000), true);
  assert.equal(canClaimParticipantTabLock(current, "tab-two", 20_001), true);
});

test("tab ownership releases on close and refresh may reacquire safely", () => {
  assert.match(lock, /pagehide/);
  assert.match(lock, /removeItem\(key\)/);
  assert.match(lock, /window\.setInterval\(claim/);
  assert.match(lock, /parseLock\(window\.localStorage\.getItem\(key\)\)\?\.ownerId === ownerId/);
});

test("revision conflicts never retry a stale full Session", () => {
  assert.match(participantHook, /conflictRef\.current = true/);
  assert.match(participantHook, /SESSION SAVE PAUSED|setSaveStatus\("conflict"\)/);
  assert.doesNotMatch(participantHook, /saveRemoteParticipantSession\(draft, latest\.revision\)/);
  assert.match(participantPage, /Refresh this page to reload the latest saved version/);
});

test("study phase is server controlled and defaults safely", () => {
  assert.match(environment, /value === "pilot" \|\| value === "formal" \|\| value === "development_test"/);
  assert.match(environment, /: "development_test"/);
  assert.match(creation, /const studyStatus: StudyStatus = getStudyPhase\(\)/);
  assert.doesNotMatch(setup, /studyStatus|Study status/);
});

test("date and duration are authoritative fixed server values", () => {
  assert.doesNotMatch(setup, /type="date"|Task duration|taskDurationMinutes|sessionDate/);
  assert.match(creation, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
  assert.match(creation, /taskDurationMinutes: DEFAULT_TASK_DURATION_MINUTES/);
});

test("participant session responses omit internal research metadata", () => {
  for (const field of ["condition", "humanCoding", "studyStatus", "assignmentMethod", "traceClassifications", "aiPropositions", "storagePath", "checksum"]) assert.match(participantPayload, new RegExp(field));
  assert.match(participantPayload, /delete \(copy as Partial<Session>\)\.condition/);
  assert.match(participantPayload, /traceEnabled/);
  assert.match(participantPayload, /getParticipantVisibleDecisions/);
  assert.match(participantPayload, /traceEnabled \? getParticipantVisibleDecisions/);
  const safeDecisionBlock = participantPayload.slice(participantPayload.indexOf("const safeDecisions"), participantPayload.indexOf("delete (copy"));
  assert.doesNotMatch(safeDecisionBlock, /confidenceScore|reasonCode|classifierModelId|reviewNote|linkedAiPropositionIds/);
  assert.match(traceRoute, /participantTraceResponse\(saved\)/);
  assert.match(traceRoute, /participantSafeSession/);
  assert.doesNotMatch(traceRoute, /NextResponse\.json\(result/);
});

test("chat and Decision Trace routes require a valid active participant session", () => {
  assert.match(chatRoute, /authoriseParticipantModelRequest/);
  assert.match(traceRoute, /authoriseParticipantModelRequest/);
  assert.match(modelAuth, /verifyParticipantSessionCookie/);
  assert.match(modelAuth, /cookieSessionId !== claimedSessionId/);
  assert.match(modelAuth, /row\.session_status !== "active"/);
  assert.match(chatRoute, /status: 401/);
  assert.match(traceRoute, /status: 401/);
});

test("model routes derive central context and enforce the session message limit", () => {
  assert.match(chatRoute, /authorised\.session\.messages/);
  assert.match(chatRoute, /getConversationAllowanceCount\(authorised\.session\) >= PARTICIPANT_MESSAGE_LIMIT/);
  assert.match(chatRoute, /storedRequest/);
  assert.match(traceRoute, /authorised\.session\.messages\.find/);
  assert.match(traceRoute, /buildDecisionTracePayload\(authorised\.session/);
  assert.match(traceRoute, /applyTraceClassificationResponse\(authorised\.session/);
  assert.match(traceRoute, /updateStudySessionWithRevision/);
  assert.doesNotMatch(traceRoute, /condition: payload/);
});

test("landing wording, viewport guidance, creation lock and save wording are neutral", () => {
  assert.match(setup, /CREATIVE DESIGN STUDY/);
  assert.match(setup, /Minimum recommended width: 1024px/);
  assert.doesNotMatch(setup, /RESEARCHER CONSOLE · PRIVATE/);
  assert.match(setup, /disabled=\{creating\}/);
  assert.match(setupApp, /setCreating\(true\)/);
  assert.match(setupApp, /finally \{ setCreating\(false\); \}/);
  assert.match(board, /> Saved</);
  assert.doesNotMatch(board, /Saved locally/);
});
