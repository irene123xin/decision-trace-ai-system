import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const setup = read("components/ResearcherSetupApp.tsx");
const participantPage = read("app/session/[sessionId]/page.tsx");
const publicCreation = read("app/api/sessions/route.ts");
const researcherSessions = read("app/api/researcher/sessions/route.ts");
const researcherRecord = read("app/api/researcher/sessions/[sessionId]/route.ts");
const researcherAuth = read("services/server/researcherAuth.ts");
const accessRoute = read("app/api/researcher-access/route.ts");
const proxy = read("proxy.ts");

test("root setup and Start session do not require researcher authentication", () => {
  assert.match(setup, /const start = \(setup: PublicSessionSetupData\) => \{ void createCentralSession\(setup\); \}/);
  assert.match(setup, /fetch\("\/api\/sessions"/);
  assert.doesNotMatch(publicCreation, /RESEARCHER_ACCESS_REQUIRED/);
  assert.doesNotMatch(setup, /window\.addEventListener\("pageshow", lock\)|const lock =/);
  assert.match(proxy, /pathname === "\/"\) return NextResponse\.next\(\)/);
});

test("participant routes use the server-issued cookie and never render a researcher PIN modal", () => {
  assert.match(participantPage, /useParticipantSession/);
  assert.doesNotMatch(participantPage, /ResearcherAccessModal|Researcher access|pin/i);
  assert.doesNotMatch(read("components/useParticipantSession.ts"), /ResearcherAccessModal|researcher-access|exchangeParticipantToken|window\.location\.hash/);
  assert.match(publicCreation, /response\.cookies\.set\(PARTICIPANT_SESSION_COOKIE/);
});

test("Researcher records remains the sole PIN-gated entry", () => {
  assert.match(setup, /openResearcherRecords = \(\) => setAccessTarget\("\/researcher\/records"\)/);
  assert.match(setup, /ResearcherAccessModal/);
  assert.match(proxy, /pathname\.startsWith\("\/api\/researcher\/"\)/);
  assert.match(proxy, /RESEARCHER_ACCESS_REQUIRED/);
});

test("researcher session list, record updates, and record-backed exports require authentication", () => {
  assert.match(researcherSessions, /isResearcherRequestAuthorised\(request\)/);
  assert.match(researcherRecord, /isResearcherRequestAuthorised\(request\)/);
  assert.match(researcherSessions, /status: 401/);
  assert.match(researcherRecord, /status: 401/);
  assert.match(read("components/ResearcherRecords.tsx"), /buildSessionJson|buildSessionSummaryCsv/);
});

test("both configured PIN names are accepted while the cookie secret is signing-only", () => {
  assert.match(researcherAuth, /process\.env\.RESEARCHER_PIN\?\.trim\(\)/);
  assert.match(researcherAuth, /process\.env\.RESEARCHER_ACCESS_PIN\?\.trim\(\)/);
  assert.match(researcherAuth, /for \(const expected of configuredPins\(\)\)/);
  assert.match(researcherAuth, /candidate\.trim\(\)/);
  const verifier = researcherAuth.slice(researcherAuth.indexOf("export function verifyResearcherPin"), researcherAuth.indexOf("export function createResearcherSessionToken"));
  assert.doesNotMatch(verifier, /RESEARCHER_COOKIE_SECRET|configuredCookieSecret/);
  assert.match(researcherAuth, /timingSafeEqual/);
});

test("a valid PIN bypasses and clears previous failed-attempt state", () => {
  const validIndex = accessRoute.indexOf("if (validPin) failedAttempts.delete(key)");
  const blockedIndex = accessRoute.indexOf("existing.count >= MAX_FAILED_ATTEMPTS");
  assert.ok(validIndex >= 0 && blockedIndex > validIndex);
  assert.match(accessRoute, /if \(!validPin && existing/);
});

test("public session creation validates and rate-limits server-side construction", () => {
  assert.match(publicCreation, /MAX_CREATIONS_PER_WINDOW/);
  assert.match(publicCreation, /SESSION_CREATION_RATE_LIMITED/);
  assert.match(publicCreation, /\^\[A-Za-z0-9_-\]\{1,64\}\$/);
  assert.doesNotMatch(publicCreation, /input\.condition/);
  assert.match(publicCreation, /createAssignedStudySession/);
  assert.match(publicCreation, /content-length/);
  assert.match(publicCreation, /condition: "A"/);
  assert.doesNotMatch(publicCreation, /sessionData[^\n]*input|body\.session/);
});

test("duplicate participant codes receive a distinct safe conflict", () => {
  assert.match(publicCreation, /findStudySessionByParticipantCode/);
  assert.match(publicCreation, /PARTICIPANT_CODE_ALREADY_EXISTS/);
  assert.match(publicCreation, /status: 409/);
});
