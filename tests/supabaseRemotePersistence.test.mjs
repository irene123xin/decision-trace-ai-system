import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const createRoute = read("app/api/sessions/route.ts");
const researcherRecordRoute = read("app/api/researcher/sessions/[sessionId]/route.ts");
const exchangeRoute = read("app/api/participant/session/exchange/route.ts");
const participantRoute = read("app/api/participant/session/route.ts");
const participantAuth = read("services/server/participantAuth.ts");
const participantHook = read("components/useParticipantSession.ts");
const remoteClient = read("services/remoteSessionClient.ts");
const records = read("components/ResearcherRecords.tsx");
const exporter = read("services/exportService.ts");
const researcherAuth = read("services/server/researcherAuth.ts");
const accessRoute = read("app/api/researcher-access/route.ts");
const migration = read("supabase/migrations/20260804120000_phase1_remote_storage_foundations.sql");
const assignmentMigration = read("supabase/migrations/20260804213000_balanced_condition_assignment.sql");

test("researcher creates an authoritative central Session with trace parity and revision one", () => {
  assert.match(createRoute, /createAssignedStudySession/);
  assert.match(assignmentMigration, /l_condition = 'B'/);
  assert.match(createRoute, /sessionData: session/);
  assert.match(migration, /revision integer not null default 1/);
});

test("creation retains the required one-way access hash without returning raw access material", () => {
  assert.match(participantAuth, /randomBytes\(32\)/);
  assert.match(participantAuth, /createHash\("sha256"\)/);
  assert.match(createRoute, /participantAccessTokenHash/);
  assert.doesNotMatch(createRoute, /participantAccessToken:\s*|participantUrl|#token|\?token/);
});

test("session creation directly creates a restricted HttpOnly participant cookie", () => {
  assert.match(createRoute, /createParticipantSessionCookie\(session\.id\)/);
  assert.match(createRoute, /response\.cookies\.set\(PARTICIPANT_SESSION_COOKIE/);
  assert.match(createRoute, /httpOnly: true/);
  assert.match(createRoute, /sameSite: "lax"/);
  assert.match(createRoute, /secure: process\.env\.NODE_ENV === "production"/);
  assert.doesNotMatch(participantHook, /history\.replaceState|window\.location\.hash|exchangeParticipantToken/);
});

test("legacy server token exchange remains restricted and is not used by the participant client", () => {
  assert.match(exchangeRoute, /verifyParticipantAccessToken/);
  assert.match(exchangeRoute, /httpOnly: true/);
  assert.doesNotMatch(remoteClient, /exchangeParticipantToken/);
});

test("a URL session ID alone cannot load a remote record or another participant session", () => {
  assert.match(participantRoute, /verifyParticipantSessionCookie/);
  assert.match(participantRoute, /findStudySessionByPublicId\(publicId\)/);
  assert.doesNotMatch(participantRoute, /searchParams|request\.url.*sessionId/);
  assert.match(participantHook, /remote\.session\.id === expectedId/);
});

test("invalid participant access receives one neutral unavailable response", () => {
  assert.match(exchangeRoute, /status: 401/);
  assert.match(participantRoute, /PARTICIPANT_SESSION_UNAVAILABLE/);
  assert.match(read("app/session/[sessionId]/page.tsx"), /This participant session link is invalid or no longer available\./);
});

test("central autosave uses expected revisions and stops safely on a conflict", () => {
  assert.match(remoteClient, /expectedRevision/);
  assert.match(remoteClient, /response\.status === 409/);
  assert.match(participantHook, /result === "conflict"/);
  assert.match(participantHook, /conflictRef\.current = true/);
  assert.match(participantHook, /setSaveStatus\("conflict"\)/);
  assert.doesNotMatch(participantHook, /saveRemoteParticipantSession\(draft, latest\.revision\)/);
});

test("network failure preserves a local recovery draft and retries without making it authoritative", () => {
  assert.match(remoteClient, /decision-trace-remote-recovery-v1/);
  assert.match(participantHook, /saveRemoteRecovery/);
  assert.match(participantHook, /setSaveStatus\("retrying"\)/);
  assert.ok(participantHook.indexOf("loadRemoteParticipantSession()") < participantHook.indexOf("loadRemoteRecovery(expectedId)"));
});

test("Pre-AI, Final Review, and study completion use critical confirmed persistence", () => {
  const participantPage = read("app/session/[sessionId]/page.tsx");
  const workspace = read("components/ParticipantWorkspace.tsx");
  const questionnaire = read("components/PostTaskQuestionnaire.tsx");
  assert.match(participantPage, /persistCritical\(next\)/);
  assert.match(workspace, /await onCriticalChange\(next\)/);
  assert.match(questionnaire, /await onCriticalUpdate\(next\)/);
});

test("researcher records aggregate remote and local legacy sessions without duplicates", () => {
  assert.match(records, /api\/researcher\/sessions/);
  assert.match(records, /localSessions\.filter\(\(session\) => !remoteById\.has\(session\.id\)\)/);
  assert.match(records, /Remote · revision/);
  assert.match(records, /Local legacy/);
});

test("remote researcher edits and exports operate on the central Session object", () => {
  assert.match(records, /method: "PUT"/);
  assert.match(records, /expectedRevision: remote\.revision/);
  assert.match(records, /buildSessionJson\(item\)/);
  assert.match(researcherRecordRoute, /updateStudySessionWithRevision/);
});

test("participant updates preserve researcher-only coding and immutable assignment fields", () => {
  const payload = read("services/server/sessionPayload.ts");
  for (const field of ["id", "participantId", "researcherId", "condition", "studyStatus", "humanCoding"]) assert.match(payload, new RegExp(`${field}: current\\.${field}`));
});

test("exports defensively exclude participant credentials, Supabase secrets, and cookies", () => {
  for (const key of ["participant_access_token", "participant_access_token_hash", "supabase_secret_key", "researcher_cookie_secret", "cookie"]) assert.match(exporter, new RegExp(`"${key}"`));
  assert.doesNotMatch(createRoute, /participant_access_token_hash[^\n]*NextResponse/);
});

test("researcher cookies use an independent secret and failed PIN attempts are rate limited", () => {
  assert.match(researcherAuth, /RESEARCHER_PIN/);
  assert.match(researcherAuth, /RESEARCHER_ACCESS_PIN/);
  assert.match(researcherAuth, /RESEARCHER_COOKIE_SECRET/);
  assert.match(researcherAuth, /researcher:\$\{payload\}/);
  assert.match(accessRoute, /MAX_FAILED_ATTEMPTS/);
  assert.match(accessRoute, /status: 429/);
});

test("remote image binaries use server-side private Storage while legacy IndexedDB remains available", () => {
  const workspace = read("components/ParticipantWorkspace.tsx");
  const imagePlaceholder = read("components/ImagePlaceholder.tsx");
  const storageAdapter = read("services/imageStorageAdapter.ts");
  assert.doesNotMatch(workspace, /saveGeneratedImageBlobs|base64ToBlob/);
  assert.doesNotMatch(workspace, /supabaseAdmin|generated-images/);
  assert.match(imagePlaceholder, /storageBackend === "supabase"/);
  assert.match(imagePlaceholder, /readGeneratedImageBlob/);
  assert.match(storageAdapter, /indexedDB\.open/);
  assert.match(createRoute, /sessionData: session/);
});
