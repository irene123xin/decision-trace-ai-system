import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const setupApp = read("components/ResearcherSetupApp.tsx");
const setupPage = read("components/SessionSetup.tsx");
const participantPage = read("app/session/[sessionId]/page.tsx");
const participantHook = read("components/useParticipantSession.ts");
const creation = read("app/api/sessions/route.ts");
const recovery = read("services/remoteSessionClient.ts");
const exporter = read("services/exportService.ts");

test("Start session navigates directly to the clean session route in the same tab without PIN", () => {
  assert.match(setupApp, /window\.location\.assign\(result\.destination\)/);
  assert.doesNotMatch(setupApp, /window\.open\(/);
  assert.doesNotMatch(setupApp, /clipboard|participantUrl|fallbackLink|#token/i);
  const start = setupApp.slice(setupApp.indexOf("const start"), setupApp.indexOf("return <>"));
  assert.doesNotMatch(start, /setAccessTarget|ResearcherAccessModal|researcher-access/);
});

test("the setup page has no participant link or token controls", () => {
  for (const text of ["CURRENT REMOTE SESSION", "REMOTE PARTICIPANT LINK", "Open participant link"]) assert.doesNotMatch(setupPage, new RegExp(text, "i"));
  assert.doesNotMatch(setupPage, /participantLink|onOpenParticipant/);
});

test("the setup page and app expose no participant-link controls", () => {
  for (const text of ["Participant link", "Copy link", "Open participant link", "Participant link copied"]) {
    assert.doesNotMatch(`${setupApp}\n${setupPage}`, new RegExp(text, "i"));
  }
});

test("first access loads inside the existing participant route only", () => {
  assert.match(participantPage, /Opening participant session…/);
  assert.match(participantPage, /delayedParticipantLoading/);
  assert.match(participantPage, /useParticipantSession/);
  assert.doesNotMatch(participantPage, /\/access|\/join|\/bootstrap/);
});

test("the participant route uses only its clean ID and waits before invalid rendering", () => {
  assert.doesNotMatch(participantHook, /window\.location\.(?:hash|search)|URLSearchParams|exchangeParticipantToken|history\.replaceState/);
  assert.match(participantPage, /if \(!hydrated \|\| loading\)/);
  assert.match(participantPage, /This participant session link is invalid or no longer available\./);
});

test("creation sets a restricted participant cookie and refresh loads through that cookie", () => {
  assert.match(creation, /response\.cookies\.set\(PARTICIPANT_SESSION_COOKIE/);
  assert.match(creation, /httpOnly: true/);
  assert.match(creation, /sameSite: "lax"/);
  assert.match(creation, /secure: process\.env\.NODE_ENV === "production"/);
  assert.match(participantHook, /loadRemoteParticipantSession\(\)/);
});

test("creation returns only a clean destination and never exposes raw access material", () => {
  assert.match(creation, /destination: `\/session\/\$\{encodeURIComponent\(row\.public_session_id\)\}`/);
  assert.doesNotMatch(creation, /participantUrl|#token|\?token/);
  assert.doesNotMatch(recovery, /exchangeParticipantToken|#token|\?token/);
  assert.doesNotMatch(setupApp, /localStorage|sessionStorage/);
  assert.match(exporter, /"participant_access_token"/);
  assert.doesNotMatch(creation, /console\.(?:log|error)/);
});

test("a cookie for one remote session cannot load a different remote session", () => {
  const remoteBranch = participantHook.slice(participantHook.indexOf("if (remote)"), participantHook.indexOf("const legacy"));
  assert.match(remoteBranch, /remote\.session\.id === expectedId/);
  assert.match(remoteBranch, /setInvalid\(true\)/);
  assert.match(remoteBranch, /return/);
});
