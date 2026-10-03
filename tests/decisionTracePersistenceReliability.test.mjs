import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mergeTraceClassificationRecords } from "../services/traceClassificationMerge.ts";
import { DECISION_TRACE_PROMPT_VERSION } from "../services/decisionTraceClassifier.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const record = (requestId, status) => ({
  requestId,
  participantMessageId: `message-${requestId}`,
  startedAt: "2026-08-13T10:00:00.000Z",
  status,
  classifierPromptVersion: DECISION_TRACE_PROMPT_VERSION,
  unitIds: [],
  propositionIds: [],
});

test("a later participant draft cannot erase an earlier failed Trace record", () => {
  const failure = { ...record("trace-one", "TRACE_PROVIDER_ERROR"), completedAt: "2026-08-13T10:00:16.000Z", attemptCount: 2, errorStage: "provider_timeout", finalResolution: "failed_classification" };
  const nextPending = record("trace-two", "TRACE_CLASSIFICATION_PENDING");
  const merged = mergeTraceClassificationRecords([failure], [nextPending]);
  assert.deepEqual(merged.map((item) => [item.requestId, item.status]), [
    ["trace-one", "TRACE_PROVIDER_ERROR"],
    ["trace-two", "TRACE_CLASSIFICATION_PENDING"],
  ]);
  assert.equal(merged[0].attemptCount, 2);
});

test("a pending request may complete but a completed server record cannot be downgraded", () => {
  const pending = record("trace-one", "TRACE_CLASSIFICATION_PENDING");
  const completed = { ...pending, status: "TRACE_CLASSIFIED", completedAt: "2026-08-13T10:00:02.000Z", unitIds: ["D01"] };
  assert.equal(mergeTraceClassificationRecords([pending], [completed])[0].status, "TRACE_CLASSIFIED");
  assert.equal(mergeTraceClassificationRecords([completed], [pending])[0].status, "TRACE_CLASSIFIED");
});

test("persistence correction does not alter prompt, threshold, A/B visibility, or retry bounds", () => {
  const classifier = read("services/decisionTraceClassifier.ts");
  const traceState = read("services/decisionTraceSessionState.ts");
  const attempts = read("services/decisionTracePipeline.ts");
  const workspace = read("components/ParticipantWorkspace.tsx");
  assert.equal(DECISION_TRACE_PROMPT_VERSION, "elsewhere-decision-trace-v3");
  assert.match(traceState, /classified\.confidence >= 0\.8/);
  assert.match(attempts, /attempt <= 2/);
  assert.match(workspace, /session\.condition === "B" && <DecisionTrace/);
});
