import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isResumableParticipantStatus, RESUMABLE_PARTICIPANT_STATUSES } from "../services/participantSessionRecovery.ts";
import { canClaimParticipantTabLock } from "../services/participantTabLock.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const home = read("app/page.tsx");
const setupApp = read("components/ResearcherSetupApp.tsx");
const setup = read("components/SessionSetup.tsx");
const participantPage = read("app/session/[sessionId]/page.tsx");
const participantHook = read("components/useParticipantSession.ts");

test("unfinished participant statuses are resumable while terminal statuses remain locked", () => {
  assert.deepEqual(RESUMABLE_PARTICIPANT_STATUSES, ["ready", "briefing", "starting_point", "active", "questionnaire"]);
  for (const status of RESUMABLE_PARTICIPANT_STATUSES) assert.equal(isResumableParticipantStatus(status), true);
  for (const status of ["submitted", "ended", "restarted", "unknown"]) assert.equal(isResumableParticipantStatus(status), false);
});

test("the root page discovers only the cookie-owned central session", () => {
  assert.match(home, /verifyParticipantSessionCookie/);
  assert.match(home, /findStudySessionByPublicId\(ownedParticipantSessionId\)/);
  assert.match(home, /isResumableParticipantStatus\(row\.session_status\)/);
  assert.doesNotMatch(home, /findStudySessionByParticipantCode/);
});

test("the landing page prioritises continuation instead of new-session creation", () => {
  assert.match(setup, /Continue current session/);
  assert.match(setup, /hasResumableParticipantSession \? <section/);
  assert.match(setupApp, /window\.location\.assign\(`\/session\/\$\{encodeURIComponent\(resumableParticipantSessionId\)\}`\)/);
  assert.doesNotMatch(setupApp, /onContinueParticipantSession[\s\S]*createCentralSession/);
});

test("continuation retains route-based server restoration without creating an assignment", () => {
  assert.match(participantHook, /loadRemoteParticipantSession\(\)/);
  assert.match(participantHook, /remote\.session\.id === expectedId/);
  assert.match(participantPage, /session\.status === "questionnaire"/);
  assert.match(participantPage, /session\.status === "submitted"/);
  assert.doesNotMatch(`${home}\n${setupApp}`, /createAssignedStudySession/);
});

test("an active lock blocks a second tab and an expired lease permits recovery", () => {
  const active = JSON.stringify({ ownerId: "first-tab", expiresAt: 20_000 });
  assert.equal(canClaimParticipantTabLock(active, "second-tab", 10_000), false);
  assert.equal(canClaimParticipantTabLock(active, "second-tab", 20_001), true);
});

test("participant recovery UI and server lookup expose no research metadata", () => {
  const participantFacing = `${setup}\n${setupApp}`;
  for (const hidden of ["trace_enabled", "study phase", "assignment block", "classifier confidence", "researcher metadata"]) {
    assert.doesNotMatch(participantFacing, new RegExp(hidden, "i"));
  }
});
