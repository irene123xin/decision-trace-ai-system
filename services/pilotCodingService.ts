import type {
  CalibrationWorkspaceRecord,
  ClassifierFreezeRecord,
  DecisionCategory,
  DecisionUnit,
  HumanCodedUnit,
  HumanCoderRecord,
  Message,
  MessageHumanCoding,
  Session,
  StudyStatus,
} from "@/types";

export type CodingComparisonResult =
  | "exact_agreement"
  | "partial_agreement"
  | "disagreement"
  | "missed_automated_decision"
  | "extra_automated_decision"
  | "category_mismatch"
  | "unit_count_mismatch"
  | "unresolved_proposition_link";

export interface CodingComparison {
  result: CodingComparisonResult;
  decisionPresenceAgreement: boolean;
  exactCategoryAgreement: boolean;
  matchedUnits: number;
  unmatchedHumanUnits: number;
  unmatchedAutomatedUnits: number;
}

export interface PilotCalibrationSummary {
  totalPilotSessions: number;
  totalParticipantMessages: number;
  totalHumanCodedMessages: number;
  decisionNoDecisionAgreementRate: number;
  exactCategoryAgreementRate: number;
  uncertainRate: number;
  automatedFalsePositiveCount: number;
  automatedFalseNegativeCount: number;
  categoryConfusion: Record<string, number>;
  averageAutomatedConfidenceForAgreements: number | null;
  averageAutomatedConfidenceForDisagreements: number | null;
  countsByCategory: Record<string, number>;
  messagesRequiringAdjudication: number;
  coderAgreement?: {
    messageLevelAgreementRate: number;
    categoryAgreementRate: number;
    disagreementCount: number;
    disagreementProportion: number;
  };
}

const decisionCategories: DecisionCategory[] = ["accept", "modify", "reject", "human_initiated", "uncertain"];
const emptyCoder = (): HumanCoderRecord => ({
  coderId: null, status: "not_coded", codedAt: null, units: [], note: null,
  automatedCodingRevealedBeforeSubmission: false, otherCoderRevealedBeforeSubmission: false,
});

export function createMessageHumanCoding(sessionId: string, participantMessageId: string): MessageHumanCoding {
  return {
    sessionId, participantMessageId, coder1: emptyCoder(), coder2: emptyCoder(),
    adjudication: { status: "not_required", resolvedUnits: [], resolvedAt: null, resolvedBy: null, note: null },
  };
}

export function getConversationParticipantMessages(session: Session): Message[] {
  const imageMessageIds = new Set((session.imageRequests ?? []).map((request) => request.participantMessageId).filter(Boolean));
  return session.messages.filter((message) => message.role === "participant" && !imageMessageIds.has(message.id));
}

export function ensureHumanCodingRecords(session: Session): MessageHumanCoding[] {
  const existing = new Map((session.humanCoding ?? []).map((record) => [record.participantMessageId, record]));
  return getConversationParticipantMessages(session).map((message) => existing.get(message.id) ?? createMessageHumanCoding(session.id, message.id));
}

export function automatedUnitsForMessage(session: Session, messageId: string): DecisionUnit[] {
  return session.decisions.filter((decision) => decision.participantMessageId === messageId);
}

const actionableHumanUnits = (units: HumanCodedUnit[]) => units.filter((unit) => unit.category !== "no_decision");
const normal = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ").replace(/[.!?。！？,，;；:：]/g, "");
const words = (value: string) => new Set(normal(value).split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 2));
function evidenceOverlaps(left: string, right: string): boolean {
  const a = normal(left); const b = normal(right);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const leftWords = words(a); const rightWords = words(b);
  const overlap = [...leftWords].filter((word) => rightWords.has(word)).length;
  return overlap >= 2 && overlap / Math.max(1, Math.min(leftWords.size, rightWords.size)) >= 0.5;
}

export function compareAutomatedWithHuman(automated: DecisionUnit[], codedUnits: HumanCodedUnit[]): CodingComparison {
  const human = actionableHumanUnits(codedUnits);
  const auto = automated.filter((unit) => unit.currentReviewedCategory !== null);
  const humanHasDecision = human.length > 0;
  const autoHasDecision = auto.length > 0;
  if (!humanHasDecision && !autoHasDecision) return { result: "exact_agreement", decisionPresenceAgreement: true, exactCategoryAgreement: true, matchedUnits: 0, unmatchedHumanUnits: 0, unmatchedAutomatedUnits: 0 };
  if (humanHasDecision && !autoHasDecision) return { result: "missed_automated_decision", decisionPresenceAgreement: false, exactCategoryAgreement: false, matchedUnits: 0, unmatchedHumanUnits: human.length, unmatchedAutomatedUnits: 0 };
  if (!humanHasDecision && autoHasDecision) return { result: "extra_automated_decision", decisionPresenceAgreement: false, exactCategoryAgreement: false, matchedUnits: 0, unmatchedHumanUnits: 0, unmatchedAutomatedUnits: auto.length };

  const used = new Set<number>();
  let exact = 0; let categoryOnly = 0; let unresolvedLink = false;
  for (const humanUnit of human) {
    const exactIndex = auto.findIndex((item, index) => !used.has(index) && (item.currentReviewedCategory ?? item.category) === humanUnit.category && evidenceOverlaps(item.evidenceText ?? item.summary, humanUnit.evidenceText));
    if (exactIndex >= 0) { used.add(exactIndex); exact += 1; if (humanUnit.linkedAiPropositionId && !(auto[exactIndex].linkedAiPropositionIds ?? []).includes(humanUnit.linkedAiPropositionId)) unresolvedLink = true; continue; }
    const categoryIndex = auto.findIndex((item, index) => !used.has(index) && (item.currentReviewedCategory ?? item.category) === humanUnit.category);
    if (categoryIndex >= 0) { used.add(categoryIndex); categoryOnly += 1; }
  }
  const unmatchedHumanUnits = human.length - exact - categoryOnly;
  const unmatchedAutomatedUnits = auto.length - used.size;
  const matchedUnits = exact + categoryOnly;
  if (unresolvedLink) return { result: "unresolved_proposition_link", decisionPresenceAgreement: true, exactCategoryAgreement: false, matchedUnits, unmatchedHumanUnits, unmatchedAutomatedUnits };
  if (human.length !== auto.length) return { result: "unit_count_mismatch", decisionPresenceAgreement: true, exactCategoryAgreement: false, matchedUnits, unmatchedHumanUnits, unmatchedAutomatedUnits };
  if (unmatchedHumanUnits || unmatchedAutomatedUnits) return { result: "category_mismatch", decisionPresenceAgreement: true, exactCategoryAgreement: false, matchedUnits, unmatchedHumanUnits, unmatchedAutomatedUnits };
  if (categoryOnly) return { result: "partial_agreement", decisionPresenceAgreement: true, exactCategoryAgreement: true, matchedUnits, unmatchedHumanUnits: 0, unmatchedAutomatedUnits: 0 };
  return { result: "exact_agreement", decisionPresenceAgreement: true, exactCategoryAgreement: true, matchedUnits, unmatchedHumanUnits: 0, unmatchedAutomatedUnits: 0 };
}

export function compareHumanCoders(coder1: HumanCodedUnit[], coder2: HumanCodedUnit[]): CodingComparison {
  const synthetic = actionableHumanUnits(coder1).map((unit, index): DecisionUnit => {
    const action = unit.category === "human_initiated" ? "Human-initiated" : unit.category === "uncertain" ? "Uncertain" : `${unit.category[0].toUpperCase()}${unit.category.slice(1)}` as DecisionUnit["action"];
    const label = { action, source: "Unclear" as const, object: "Other" as const, summary: unit.neutralSummary };
    return { id: `H${index}`, timestampSeconds: 0, relatedTurn: null, confidence: "High", modelGeneratedLabel: "Human coding", reviewStatus: "Confirmed", ...label, originalModelLabel: label, finalReviewedLabel: label, category: unit.category as DecisionCategory, currentReviewedCategory: unit.category as DecisionCategory, evidenceText: unit.evidenceText, linkedAiPropositionIds: unit.linkedAiPropositionId ? [unit.linkedAiPropositionId] : [] };
  });
  return compareAutomatedWithHuman(synthetic, coder2);
}

const rate = (numerator: number, denominator: number) => denominator ? numerator / denominator : 0;
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export function buildPilotCalibrationSummary(sessions: Session[]): PilotCalibrationSummary {
  const pilotSessions = sessions.filter((session) => (session.studyStatus ?? "development_test") === "pilot");
  let totalMessages = 0; let codedMessages = 0; let presenceAgreements = 0; let categoryAgreements = 0;
  let uncertain = 0; let falsePositive = 0; let falseNegative = 0; let adjudication = 0;
  let coderBoth = 0; let coderPresence = 0; let coderCategory = 0; let coderDisagreements = 0;
  const agreedConfidence: number[] = []; const disagreedConfidence: number[] = [];
  const confusion: Record<string, number> = {}; const counts: Record<string, number> = Object.fromEntries([...decisionCategories, "no_decision"].map((category) => [category, 0]));
  for (const session of pilotSessions) {
    const coding = ensureHumanCodingRecords(session);
    totalMessages += coding.length;
    for (const record of coding) {
      if (record.coder1.status !== "coded") continue;
      codedMessages += 1;
      const automated = automatedUnitsForMessage(session, record.participantMessageId);
      const comparison = compareAutomatedWithHuman(automated, record.coder1.units);
      if (comparison.decisionPresenceAgreement) presenceAgreements += 1;
      if (comparison.exactCategoryAgreement) categoryAgreements += 1;
      if (comparison.result === "extra_automated_decision") falsePositive += automated.length;
      if (comparison.result === "missed_automated_decision") falseNegative += actionableHumanUnits(record.coder1.units).length;
      if (comparison.result !== "exact_agreement" && comparison.result !== "partial_agreement") adjudication += 1;
      const confidenceTarget = comparison.exactCategoryAgreement ? agreedConfidence : disagreedConfidence;
      confidenceTarget.push(...automated.map((unit) => unit.confidenceScore).filter((value): value is number => typeof value === "number"));
      for (const unit of record.coder1.units) { counts[unit.category] = (counts[unit.category] ?? 0) + 1; if (unit.category === "uncertain") uncertain += 1; }
      const autoCategories = automated.map((unit) => unit.currentReviewedCategory ?? unit.category ?? "uncertain");
      const humanCategories = actionableHumanUnits(record.coder1.units).map((unit) => unit.category);
      const maximum = Math.max(autoCategories.length, humanCategories.length, 1);
      for (let index = 0; index < maximum; index += 1) { const key = `${autoCategories[index] ?? "no_decision"}→${humanCategories[index] ?? "no_decision"}`; confusion[key] = (confusion[key] ?? 0) + 1; }
      if (record.coder2.status === "coded") {
        coderBoth += 1;
        const coderComparison = compareHumanCoders(record.coder1.units, record.coder2.units);
        if (coderComparison.decisionPresenceAgreement) coderPresence += 1;
        if (coderComparison.exactCategoryAgreement) coderCategory += 1;
        if (coderComparison.result !== "exact_agreement" && coderComparison.result !== "partial_agreement") coderDisagreements += 1;
      }
    }
  }
  return {
    totalPilotSessions: pilotSessions.length, totalParticipantMessages: totalMessages, totalHumanCodedMessages: codedMessages,
    decisionNoDecisionAgreementRate: rate(presenceAgreements, codedMessages), exactCategoryAgreementRate: rate(categoryAgreements, codedMessages),
    uncertainRate: rate(uncertain, Object.values(counts).reduce((sum, value) => sum + value, 0)), automatedFalsePositiveCount: falsePositive,
    automatedFalseNegativeCount: falseNegative, categoryConfusion: confusion,
    averageAutomatedConfidenceForAgreements: average(agreedConfidence), averageAutomatedConfidenceForDisagreements: average(disagreedConfidence),
    countsByCategory: counts, messagesRequiringAdjudication: adjudication,
    ...(coderBoth ? { coderAgreement: { messageLevelAgreementRate: rate(coderPresence, coderBoth), categoryAgreementRate: rate(coderCategory, coderBoth), disagreementCount: coderDisagreements, disagreementProportion: rate(coderDisagreements, coderBoth) } } : {}),
  };
}

function hash(value: string) { let result = 2166136261; for (const char of value) { result ^= char.charCodeAt(0); result = Math.imul(result, 16777619); } return (result >>> 0).toString(36).toUpperCase(); }
export const anonymisedSessionId = (sessionId: string) => `CAL-${hash(sessionId)}`;
const csv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const categoriesOf = (units: HumanCodedUnit[]) => units.map((unit) => unit.category).join("|");

export function buildMessageCodingCsv(sessions: Session[], statuses: StudyStatus[] = ["pilot"]): string {
  const header = ["anonymised_session_id", "study_status", "participant_message_id", "turn", "participant_text", "preceding_ai_message_id", "automated_status", "automated_original_categories", "automated_reviewed_categories", "automated_confidences", "coder1_categories", "coder2_categories", "adjudicated_categories", "comparison_result", "uncertain_flag", "notes"];
  const rows: unknown[][] = [];
  for (const session of sessions.filter((item) => statuses.includes(item.studyStatus ?? "development_test"))) {
    for (const message of getConversationParticipantMessages(session)) {
      const record = ensureHumanCodingRecords(session).find((item) => item.participantMessageId === message.id)!;
      const automated = automatedUnitsForMessage(session, message.id);
      const preceding = [...session.messages].reverse().find((item) => item.role === "assistant" && item.turn <= message.turn);
      const comparison = record.coder1.status === "coded" ? compareAutomatedWithHuman(automated, record.coder1.units).result : "not_coded";
      rows.push([anonymisedSessionId(session.id), session.studyStatus ?? "development_test", message.id, message.turn, message.content, preceding?.id, (session.traceClassifications ?? []).find((item) => item.participantMessageId === message.id)?.status, automated.map((unit) => unit.originalModelCategory ?? unit.category).join("|"), automated.map((unit) => unit.currentReviewedCategory ?? "").join("|"), automated.map((unit) => unit.confidenceScore).join("|"), categoriesOf(record.coder1.units), categoriesOf(record.coder2.units), categoriesOf(record.adjudication.resolvedUnits), comparison, [...record.coder1.units, ...record.coder2.units].some((unit) => unit.category === "uncertain"), [record.coder1.note, record.coder2.note, record.adjudication.note].filter(Boolean).join(" | ")]);
    }
  }
  return [header, ...rows].map((row) => row.map(csv).join(",")).join("\n");
}

export function buildAtomicCodingCsv(sessions: Session[], statuses: StudyStatus[] = ["pilot"]): string {
  const header = ["anonymised_session_id", "study_status", "participant_message_id", "source_type", "unit_id", "original_category", "reviewed_category", "evidence", "summary", "linked_ai_proposition", "confidence", "prompt_version", "timestamp"];
  const rows: unknown[][] = [];
  for (const session of sessions.filter((item) => statuses.includes(item.studyStatus ?? "development_test"))) {
    for (const message of getConversationParticipantMessages(session)) {
      const record = ensureHumanCodingRecords(session).find((item) => item.participantMessageId === message.id)!;
      for (const unit of automatedUnitsForMessage(session, message.id)) rows.push([anonymisedSessionId(session.id), session.studyStatus ?? "development_test", message.id, "automated", unit.id, unit.originalModelCategory ?? unit.category, unit.currentReviewedCategory ?? "", unit.evidenceText, unit.originalModelLabel.summary, unit.linkedAiPropositionIds?.join("|"), unit.confidenceScore, unit.classifierPromptVersion, unit.classifiedAt]);
      for (const [source, units] of [["coder1", record.coder1.units], ["coder2", record.coder2.units], ["adjudicated", record.adjudication.resolvedUnits]] as const) for (const unit of units) rows.push([anonymisedSessionId(session.id), session.studyStatus ?? "development_test", message.id, source, unit.id, unit.category, unit.category, unit.evidenceText, unit.neutralSummary, unit.linkedAiPropositionId, "", "", source === "coder1" ? record.coder1.codedAt : source === "coder2" ? record.coder2.codedAt : record.adjudication.resolvedAt]);
    }
  }
  return [header, ...rows].map((row) => row.map(csv).join(",")).join("\n");
}

export function buildCalibrationJson(sessions: Session[], workspace: CalibrationWorkspaceRecord, statuses: StudyStatus[] = ["pilot"]): string {
  const selected = sessions.filter((session) => statuses.includes(session.studyStatus ?? "development_test"));
  return JSON.stringify({ exportedAt: new Date().toISOString(), includedStudyStatuses: statuses, sessions: selected.map((session) => ({ anonymisedSessionId: anonymisedSessionId(session.id), studyStatus: session.studyStatus ?? "development_test", messages: getConversationParticipantMessages(session), automatedDecisionUnits: session.decisions, traceClassifications: session.traceClassifications ?? [], aiPropositions: session.aiPropositions ?? [], humanCoding: ensureHumanCodingRecords(session) })), agreementSummary: buildPilotCalibrationSummary(selected), calibrationLog: workspace.calibrationLog, classifierFreezeRecords: workspace.freezeRecords }, null, 2);
}

export function createFreezeRecord(input: Omit<ClassifierFreezeRecord, "id" | "freezeTimestamp" | "frozenBy" | "status">): ClassifierFreezeRecord {
  return { ...input, id: `FREEZE-${Date.now()}`, freezeTimestamp: null, frozenBy: null, status: "draft" };
}

export function freezeClassifierRecord(record: ClassifierFreezeRecord, frozenBy: string, timestamp = new Date().toISOString()): ClassifierFreezeRecord {
  return { ...record, status: "frozen", freezeTimestamp: timestamp, frozenBy };
}

export function adjudicateCodingRecord(record: MessageHumanCoding, resolvedUnits: HumanCodedUnit[], resolvedBy: string, timestamp = new Date().toISOString()): MessageHumanCoding {
  return {
    ...record,
    adjudication: {
      ...record.adjudication,
      status: "resolved",
      resolvedUnits: resolvedUnits.map((unit) => ({ ...unit })),
      resolvedAt: timestamp,
      resolvedBy,
    },
  };
}
