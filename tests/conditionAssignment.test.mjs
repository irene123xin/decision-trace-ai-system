import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const setup = read("components/SessionSetup.tsx");
const setupApp = read("components/ResearcherSetupApp.tsx");
const rootPage = read("app/page.tsx");
const creation = read("app/api/sessions/route.ts");
const repository = read("services/server/sessionRepository.ts");
const migration = read("supabase/migrations/20260804213000_balanced_condition_assignment.sql");
const participantPayload = read("services/server/sessionPayload.ts");
const workspace = read("components/ParticipantWorkspace.tsx");
const records = `${read("components/ResearcherRecords.tsx")}\n${read("components/ResearcherView.tsx")}`;
const exporter = read("services/exportService.ts");
const environment = read("services/server/environment.ts");

test("public setup replaces visible condition cards with automatic interface assignment", () => {
  assert.doesNotMatch(setup, /Condition A|Condition B|Assigned condition/);
  assert.match(setup, /INTERFACE VERSION/);
  assert.match(setup, /Assigned automatically/);
  assert.match(setup, /The interface version will be assigned when the session begins\./);
});

test("public Start session remains same-tab and PIN-free", () => {
  assert.match(setupApp, /window\.location\.assign\(result\.destination\)/);
  const start = setupApp.slice(setupApp.indexOf("const start"), setupApp.indexOf("return <>"));
  assert.doesNotMatch(start, /ResearcherAccessModal|researcher-access|setAccessTarget/);
});

test("normal creation ignores client condition and assigns centrally", () => {
  assert.doesNotMatch(creation, /input\.condition|condition: input/);
  assert.match(creation, /createAssignedStudySession/);
  assert.match(repository, /rpc\("create_study_session_with_assignment"/);
  assert.match(migration, /insert into public\.study_sessions/);
  assert.match(migration, /'condition', l_condition/);
  assert.match(migration, /trace_enabled/);
});

test("every permitted block order contains exactly two A and two B allocations", () => {
  const orderMatch = migration.match(/array\[([^\]]+)\]/);
  assert.ok(orderMatch);
  const orders = [...orderMatch[1].matchAll(/'([AB]{4})'/g)].map((match) => match[1]);
  assert.deepEqual(orders.sort(), ["AABB", "ABAB", "ABBA", "BAAB", "BABA", "BBAA"].sort());
  for (const order of orders) {
    assert.equal([...order].filter((value) => value === "A").length, 2);
    assert.equal([...order].filter((value) => value === "B").length, 2);
  }
});

test("allocation is concurrency-safe and separately stratified by study status", () => {
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('condition-assignment:' \|\| p_study_status\)\)/);
  assert.match(migration, /primary key \(study_status, block_number\)/);
  assert.match(migration, /where study_status = p_study_status/);
  assert.match(migration, /allocation and study-session creation happen in one database transaction/i);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on function[^;]+from public, anon, authenticated/);
  assert.doesNotMatch(migration, /create policy|using \(true\)|with check \(true\)/i);
});

test("automatic and manual assignment metadata are authoritative", () => {
  for (const key of ["assignmentMethod", "assignmentTimestamp", "assignmentStudyStatus", "assignmentBlockId", "assignmentPosition", "assignmentSequence"]) assert.match(migration, new RegExp(`'${key}'`));
  assert.match(migration, /l_method := 'balanced_random'/);
  assert.match(migration, /l_method := 'researcher_manual'/);
});

test("manual assignment is rendered only for an already authenticated researcher", () => {
  assert.match(rootPage, /verifyResearcherSessionToken/);
  assert.match(setup, /researcherAuthenticated && <fieldset[^>]*manualAssignmentControl/);
  assert.match(setup, /Manual assignment/);
  assert.match(setup, /\["automatic", "A", "B"\]/);
  assert.match(creation, /const researcherAuthorised = isResearcherRequestAuthorised\(request\)/);
  assert.match(creation, /manualCondition/);
  assert.doesNotMatch(setup, /Study status|studyStatus/);
  assert.match(creation, /getStudyPhase\(\)/);
  assert.match(environment, /process\.env\.STUDY_PHASE/);
});

test("participant-facing creation response contains no condition or assignment label", () => {
  const responseBlock = creation.slice(creation.indexOf("const response = NextResponse.json"), creation.indexOf("response.cookies.set"));
  assert.doesNotMatch(responseBlock, /condition|trace|assignment/i);
  for (const key of ["assignmentMethod", "assignmentTimestamp", "assignmentBlockId", "assignmentPosition", "assignmentSequence", "assignmentStudyStatus"]) {
    assert.match(participantPayload, new RegExp(`delete copy\\.${key}`));
  }
});

test("A/B participant behaviour is unchanged after assignment", () => {
  assert.match(workspace, /session\.condition === "B" && <DecisionTrace/);
  assert.doesNotMatch(workspace, /session\.condition === "A"[^\n]*DecisionTrace/);
});

test("researcher records and safe exports contain assignment metadata", () => {
  assert.match(records, /Assignment method|Assignment time|Allocation/);
  assert.match(records, /Condition \{item\.condition\}|Condition \{session\.condition\}/);
  for (const column of ["assignment_method", "assignment_timestamp", "assignment_block_id", "assignment_position", "assignment_sequence", "assignment_study_status"]) assert.match(exporter, new RegExp(`"${column}"`));
});

test("no participant route or additional navigation was introduced", () => {
  assert.doesNotMatch(`${setup}\n${setupApp}`, /participant portal|join page|code validation|participant link|window\.open/i);
  assert.match(setupApp, /fetch\("\/api\/sessions"/);
});

test("excluded or abandoned records retain allocations and replacements take the next position", () => {
  assert.match(migration, /Excluded or abandoned sessions retain their allocation/);
  assert.match(migration, /replacements receive the next allocation/);
  assert.doesNotMatch(migration, /delete from public\.study_sessions|reassign/i);
});
