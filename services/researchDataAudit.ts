import { buildDecisionsCsv, buildSessionJson } from "./exportService.ts";
import { getParticipantVisibleDecisions } from "./decisionTraceClassifier.ts";
import type { DecisionCategory, Session, TraceClassificationRecord } from "@/types";

export const CONTROLLED_STABILITY_SUITE_VERSION = "elsewhere-trace-controlled-v1";

export const CONTROLLED_STABILITY_CASES = [
  { key: "setup", message: "Suggest three distinct identity directions for Elsewhere. Include a muted mineral palette, an editorial serif wordmark, and a layered-memory collage direction.", expected: [] as DecisionCategory[] },
  { key: "accept", message: "Keep the muted mineral palette as the main colour direction.", expected: ["accept"] as DecisionCategory[] },
  { key: "modify", message: "Keep the layered-memory idea, but make it less nostalgic and more contemporary.", expected: ["modify"] as DecisionCategory[] },
  { key: "reject", message: "Remove the editorial serif direction; I don’t want to use it.", expected: ["reject"] as DecisionCategory[] },
  { key: "new_direction", message: "I want to introduce handwritten coordinates as a recurring graphic device.", expected: ["human_initiated"] as DecisionCategory[] },
  { key: "multiple", message: "Keep the muted palette, remove the serif type, and introduce embossed location numbers.", expected: ["accept", "reject", "human_initiated"] as DecisionCategory[] },
  { key: "no_decision", message: "Give me three more options.", expected: [] as DecisionCategory[] },
  { key: "uncertain", message: "Maybe the second one.", expected: ["uncertain"] as DecisionCategory[] },
] as const;

const terminalTraceStatuses = new Set([
  "TRACE_CLASSIFIED", "TRACE_NO_DECISION", "TRACE_NEEDS_REVIEW", "TRACE_PROVIDER_ERROR",
  "TRACE_SCHEMA_ERROR", "TRACE_CONTEXT_ERROR", "TRACE_DUPLICATE_SKIPPED",
]);

function categoriesForMessage(session: Session, messageId: string): DecisionCategory[] {
  return session.decisions
    .filter((decision) => decision.participantMessageId === messageId)
    .map((decision) => decision.originalModelCategory ?? decision.category)
    .filter((category): category is DecisionCategory => Boolean(category));
}

function controlledCategoryMatch(session: Session, messageId: string | undefined, key: string, expected: readonly DecisionCategory[], actual: DecisionCategory[], complete: boolean): boolean {
  if (!complete || !messageId) return false;
  const units = session.decisions.filter((decision) => decision.participantMessageId === messageId);
  if (key === "new_direction" && units.length === 1) {
    const unit = units[0];
    if (unit.sourceStatus === "absent_from_ai_context") return (unit.originalModelCategory ?? unit.category) === "human_initiated";
    if (unit.sourceStatus === "matched_structured_proposition" || unit.sourceStatus === "matched_raw_ai_context") return ["accept", "modify"].includes(unit.originalModelCategory ?? unit.category ?? "");
    return (unit.originalModelCategory ?? unit.category) === "uncertain";
  }
  if (key === "multiple" && units.length === 3) {
    const palette = units.find((unit) => /muted palette/i.test(unit.evidenceText ?? ""));
    const serif = units.find((unit) => /serif type/i.test(unit.evidenceText ?? ""));
    const embossed = units.find((unit) => /embossed location numbers/i.test(unit.evidenceText ?? ""));
    if (!palette || !serif || !embossed) return false;
    const embossedCategory = embossed.originalModelCategory ?? embossed.category;
    const embossedMatches = embossed.sourceStatus === "absent_from_ai_context"
      ? embossedCategory === "human_initiated"
      : embossed.sourceStatus === "source_unclear"
        ? embossedCategory === "uncertain"
        : ["accept", "modify"].includes(embossedCategory ?? "");
    return (palette.originalModelCategory ?? palette.category) === "accept" && (serif.originalModelCategory ?? serif.category) === "reject" && embossedMatches;
  }
  if (key === "uncertain" && units.length === 1) {
    const unit = units[0];
    return (unit.originalModelCategory ?? unit.category) === "uncertain" || (typeof unit.confidenceScore === "number" && unit.confidenceScore < 0.8 && unit.visibilityStatus !== "participant_visible");
  }
  return sortedCategories(actual) === sortedCategories(expected);
}

function sortedCategories(categories: readonly DecisionCategory[]): string {
  return [...categories].sort().join("|");
}

export interface ControlledCaseResult {
  key: string;
  participantMessageId?: string;
  participantTurn?: number;
  expected: readonly DecisionCategory[];
  actual: DecisionCategory[];
  classification?: TraceClassificationRecord;
  missingUnits: number;
  extraUnits: number;
  categoryMatch: boolean;
  complete: boolean;
}

export interface ControlledSessionResult {
  suiteVersion: string;
  isControlledSequence: boolean;
  finalResult: "pass" | "issues" | "incomplete";
  cases: ControlledCaseResult[];
  incorrectCategories: number;
  missingUnits: number;
  extraUnits: number;
}

export function evaluateControlledDevelopmentSession(session: Session): ControlledSessionResult {
  const participantMessages = session.messages.filter((message) => message.role === "participant");
  const cases = CONTROLLED_STABILITY_CASES.map((testCase) => {
    const message = participantMessages.find((item) => item.content.trim() === testCase.message);
    const actual = message ? categoriesForMessage(session, message.id) : [];
    const classification = message ? (session.traceClassifications ?? []).find((item) => item.participantMessageId === message.id) : undefined;
    const complete = Boolean(message && classification && terminalTraceStatuses.has(classification.status));
    const expectedCount = testCase.expected.length;
    const actualCount = actual.length;
    return {
      key: testCase.key,
      participantMessageId: message?.id,
      participantTurn: message?.turn,
      expected: testCase.expected,
      actual,
      classification,
      missingUnits: Math.max(0, expectedCount - actualCount),
      extraUnits: Math.max(0, actualCount - expectedCount),
      categoryMatch: controlledCategoryMatch(session, message?.id, testCase.key, testCase.expected, actual, complete),
      complete,
    } satisfies ControlledCaseResult;
  });
  const isControlledSequence = cases.every((item) => Boolean(item.participantMessageId));
  const incorrectCategories = cases.filter((item) => item.complete && item.actual.length === item.expected.length && !item.categoryMatch).length;
  const missingUnits = cases.reduce((total, item) => total + item.missingUnits, 0);
  const extraUnits = cases.reduce((total, item) => total + item.extraUnits, 0);
  const finalResult = !isControlledSequence || cases.some((item) => !item.complete)
    ? "incomplete"
    : incorrectCategories || missingUnits || extraUnits ? "issues" : "pass";
  return { suiteVersion: CONTROLLED_STABILITY_SUITE_VERSION, isControlledSequence, finalResult, cases, incorrectCategories, missingUnits, extraUnits };
}

export interface ControlledStabilitySummary {
  label: "Controlled development stability test";
  sessions: number;
  controlledSessions: number;
  totalClassificationRequests: number;
  successfulOnFirstAttempt: number;
  successfulAfterRetry: number;
  finalFailures: number;
  schemaFailures: number;
  providerFailures: number;
  timeouts: number;
  uncertainResults: number;
  incorrectCategories: number;
  missingUnits: number;
  extraUnits: number;
  averageDurationMs: number | null;
  maximumDurationMs: number | null;
  participantVisibleAccuracy: number | null;
}

export function buildControlledStabilitySummary(sessions: Session[]): ControlledStabilitySummary {
  const development = sessions.filter((session) => (session.studyStatus ?? "development_test") === "development_test");
  const requests = development.flatMap((session) => session.traceClassifications ?? []);
  const succeeded = requests.filter((request) => ["TRACE_CLASSIFIED", "TRACE_NO_DECISION", "TRACE_NEEDS_REVIEW", "TRACE_DUPLICATE_SKIPPED"].includes(request.status));
  const failures = requests.filter((request) => ["TRACE_PROVIDER_ERROR", "TRACE_SCHEMA_ERROR", "TRACE_CONTEXT_ERROR"].includes(request.status));
  const controlled = development.map((session) => ({ session, result: evaluateControlledDevelopmentSession(session) })).filter((item) => item.result.isControlledSequence);
  const durations = requests.map((request) => request.totalDurationMs ?? request.latencyMs).filter((value): value is number => typeof value === "number");
  let visibleExpected = 0;
  let visibleCorrect = 0;
  for (const { session, result } of controlled) {
    const visibleIds = new Set(getParticipantVisibleDecisions(session.decisions).map((decision) => decision.id));
    for (const item of result.cases.filter((entry) => ["accept", "modify", "reject", "new_direction", "multiple"].includes(entry.key))) {
      visibleExpected += item.expected.length;
      if (!item.participantMessageId) continue;
      const visibleActual = session.decisions.filter((decision) => decision.participantMessageId === item.participantMessageId && visibleIds.has(decision.id)).map((decision) => decision.originalModelCategory ?? decision.category).filter((category): category is DecisionCategory => Boolean(category));
      if (item.categoryMatch && visibleActual.length === item.expected.length) visibleCorrect += item.expected.length;
    }
  }
  return {
    label: "Controlled development stability test",
    sessions: development.length,
    controlledSessions: controlled.length,
    totalClassificationRequests: requests.length,
    successfulOnFirstAttempt: succeeded.filter((request) => (request.attemptCount ?? request.attempts?.length ?? 1) <= 1).length,
    successfulAfterRetry: succeeded.filter((request) => (request.attemptCount ?? request.attempts?.length ?? 1) > 1).length,
    finalFailures: failures.length,
    schemaFailures: failures.filter((request) => request.status === "TRACE_SCHEMA_ERROR" || request.errorStage === "invalid_json" || request.errorStage === "schema_validation").length,
    providerFailures: failures.filter((request) => request.status === "TRACE_PROVIDER_ERROR").length,
    timeouts: requests.filter((request) => request.errorStage === "provider_timeout" || request.attempts?.some((attempt) => attempt.errorStage === "provider_timeout")).length,
    uncertainResults: requests.filter((request) => request.status === "TRACE_NEEDS_REVIEW").length,
    incorrectCategories: controlled.reduce((total, item) => total + item.result.incorrectCategories, 0),
    missingUnits: controlled.reduce((total, item) => total + item.result.missingUnits, 0),
    extraUnits: controlled.reduce((total, item) => total + item.result.extraUnits, 0),
    averageDurationMs: durations.length ? Math.round(durations.reduce((total, value) => total + value, 0) / durations.length) : null,
    maximumDurationMs: durations.length ? Math.max(...durations) : null,
    participantVisibleAccuracy: visibleExpected ? visibleCorrect / visibleExpected : null,
  };
}

export interface SessionIntegrityAudit {
  status: "pass" | "issues";
  issues: string[];
  participantMessages: number;
  assistantMessages: number;
  propositions: number;
  decisionUnits: number;
  csvDecisionRows: number;
  categoryCounts: Record<string, number>;
}

export function auditSessionIntegrity(session: Session): SessionIntegrityAudit {
  const issues: string[] = [];
  const messageIds = new Set(session.messages.map((message) => message.id));
  const propositionIds = new Set((session.aiPropositions ?? []).map((proposition) => proposition.id));
  const decisionIds = session.decisions.map((decision) => decision.id);
  if (new Set(decisionIds).size !== decisionIds.length) issues.push("duplicate Decision Unit ID");
  for (const decision of session.decisions) {
    if (decision.participantMessageId && !messageIds.has(decision.participantMessageId)) issues.push(`orphaned participant message link: ${decision.id}`);
    if (decision.linkedAiMessageIds?.some((id) => !messageIds.has(id))) issues.push(`orphaned AI message link: ${decision.id}`);
    if (decision.linkedAiPropositionIds?.some((id) => !propositionIds.has(id))) issues.push(`orphaned proposition link: ${decision.id}`);
    if (decision.classifierPromptVersion && (!decision.originalModelCategory || typeof decision.confidenceScore !== "number" || !decision.sourceStatus || !decision.classifiedAt)) issues.push(`missing V2 Decision Unit field: ${decision.id}`);
  }
  if ((session.traceClassifications ?? []).some((record) => record.status === "TRACE_CLASSIFICATION_PENDING")) issues.push("unresolved pending classification");
  const json = buildSessionJson(session);
  const csv = buildDecisionsCsv(session);
  if (/GEMINI_API_KEY|RESEARCHER_ACCESS_PIN|authorization\s*header|systemInstruction|rawProviderResponse/i.test(`${json}\n${csv}`)) issues.push("security-sensitive export field");
  const csvDecisionRows = Math.max(0, csv.split("\n").length - 1);
  if (csvDecisionRows !== session.decisions.length) issues.push("Decision CSV row count mismatch");
  const categoryCounts: Record<string, number> = {};
  for (const decision of session.decisions) {
    const category = decision.originalModelCategory ?? decision.category ?? "legacy_unlabelled";
    categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
  }
  return {
    status: issues.length ? "issues" : "pass",
    issues,
    participantMessages: session.messages.filter((message) => message.role === "participant").length,
    assistantMessages: session.messages.filter((message) => message.role === "assistant").length,
    propositions: (session.aiPropositions ?? []).length,
    decisionUnits: session.decisions.length,
    csvDecisionRows,
    categoryCounts,
  };
}
