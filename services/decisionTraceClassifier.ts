import type {
  AIProposition,
  DecisionAnalysisResult,
  DecisionCategory,
  DecisionReasonCode,
  DecisionSourceMatchDiagnostics,
  DecisionSourceStatus,
  DecisionUnit,
  Message,
} from "@/types";

export const DECISION_TRACE_PROMPT_VERSION = "elsewhere-decision-trace-v3";

export const DECISION_CATEGORIES: DecisionCategory[] = ["accept", "modify", "reject", "human_initiated", "uncertain"];
export const DECISION_REASON_CODES: DecisionReasonCode[] = [
  "explicit_adoption", "implicit_commitment", "conditional_adoption", "partial_retention_with_change",
  "combination_of_ai_options", "explicit_rejection", "implicit_exclusion", "participant_new_proposition",
  "unresolved_reference", "weak_commitment", "conflicting_language", "no_actionable_design_choice",
];

export interface ClassifierDecisionUnit {
  category: DecisionCategory;
  summary: string;
  evidenceText: string;
  participantMessageId: string;
  linkedAiMessageIds: string[];
  linkedAiPropositionIds: string[];
  sourceStatus: DecisionSourceStatus;
  sourceMatchDiagnostics?: DecisionSourceMatchDiagnostics;
  confidence: number;
  reasonCode: DecisionReasonCode;
  reversesDecisionUnitId: string | null;
  supersedesDecisionUnitId: string | null;
}

export interface DecisionTraceAnalysis {
  analysisResult: DecisionAnalysisResult;
  units: ClassifierDecisionUnit[];
}

export interface DecisionTraceContext {
  sessionId: string;
  participantMessage: Pick<Message, "id" | "content" | "createdAt" | "turn">;
  recentMessages: Pick<Message, "id" | "role" | "content" | "createdAt" | "turn">[];
  aiPropositions: AIProposition[];
  recentDecisionUnits: Pick<DecisionUnit, "id" | "summary" | "category" | "participantMessageId" | "linkedAiPropositionIds">[];
}

const compact = (value: string) => value.trim().replace(/\s+/g, " ");
const normalise = (value: string) => compact(value).toLocaleLowerCase();

export function normalizePropositionText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
    .replace(/[.!?。！？;；:,，：\s]+$/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

function actionableSignature(value: string): string {
  const normalized = normalizePropositionText(value)
    .replace(/^(?:please\s+)?(?:use|using|consider|try|explore|create|develop|make|frame|treat)\s+/i, "")
    .replace(/^(?:可以|建议|尝试|使用|采用|探索)/, "");
  const stopWords = new Set(["a", "an", "the", "with", "using", "use", "as", "of", "to", "for", "and", "could", "would", "should", "direction", "option", "idea"]);
  const latinTokens = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  return latinTokens
    .map((token) => token.toLocaleLowerCase())
    .filter((token) => !stopWords.has(token))
    .map((token) => /^[a-z]+s$/.test(token) && token.length > 4 ? token.slice(0, -1) : token)
    .sort()
    .join("|");
}

const normalizedOptionLabel = (value?: string) => value ? normalizePropositionText(value).replace(/\s+/g, "-") : "";

export function createPropositionDeduplicationKey(proposition: Pick<AIProposition, "aiMessageId" | "summary" | "optionLabel">): string {
  return [proposition.aiMessageId, actionableSignature(proposition.summary), normalizedOptionLabel(proposition.optionLabel)].join("::");
}

function propositionsEquivalent(left: AIProposition, right: AIProposition): boolean {
  if (left.aiMessageId !== right.aiMessageId) return false;
  const leftOption = normalizedOptionLabel(left.optionLabel);
  const rightOption = normalizedOptionLabel(right.optionLabel);
  if (leftOption && rightOption && leftOption !== rightOption) return false;
  return actionableSignature(left.summary) === actionableSignature(right.summary);
}

export function deduplicateAiPropositions(propositions: AIProposition[]): AIProposition[] {
  const canonical: AIProposition[] = [];
  const ids = new Set<string>();
  for (const proposition of propositions) {
    if (ids.has(proposition.id)) continue;
    const equivalent = canonical.find((item) => propositionsEquivalent(item, proposition));
    if (equivalent) continue;
    canonical.push(proposition);
    ids.add(proposition.id);
  }
  return canonical;
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase();
}

export function createDecisionIdempotencyKey(
  sessionId: string,
  participantMessageId: string,
  summary: string,
  category: DecisionCategory,
  propositionIds: string[],
): string {
  return `TRACE-${shortHash([sessionId, participantMessageId, normalise(summary), category, [...propositionIds].sort().join("|")].join("::"))}`;
}

function propositionText(message: string): string[] {
  return message
    .split(/\n+|(?<=[.!?。！？])\s+|;\s*/)
    .map((part) => compact(part.replace(/^[-*\d.)\s]+/, "")))
    .filter((part) => part.length >= 12)
    .filter((part) => /\b(use|uses|could|consider|try|frame|treat|keep|combine|option|palette|colour|color|symbol|logo|mark|type|font|serif|sans|imagery|image|tone|concept|direction|material|typograph|wordmark)\b|使用|可以|尝试|方向|方案|配色|标志|字体|图形|意象|氛围/i.test(part));
}

export function extractAiPropositions(messages: DecisionTraceContext["recentMessages"], existing: AIProposition[] = []): AIProposition[] {
  const propositions = deduplicateAiPropositions(existing);
  const known = new Set(propositions.map((item) => item.id));
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const summary of propositionText(message.content).slice(0, 8)) {
      const id = `AI-PROP-${shortHash(`${message.id}:${normalise(summary)}`)}`;
      if (known.has(id)) continue;
      const option = summary.match(/(?:option|direction)\s*(?:one|two|three|1|2|3)|(?:第[一二三]|[一二三]号)(?:个)?(?:方向|方案)?/i)?.[0];
      const candidate: AIProposition = { id, aiMessageId: message.id, turn: message.turn, summary, optionLabel: option, createdAt: message.createdAt };
      if (propositions.some((item) => propositionsEquivalent(item, candidate))) continue;
      known.add(id);
      propositions.push(candidate);
    }
  }
  return deduplicateAiPropositions(propositions);
}

function tokens(value: string): string[] {
  const stop = new Set(["the", "and", "but", "with", "from", "this", "that", "idea", "direction", "option", "use", "keep", "make", "more", "less", "let", "want", "main", "into", "your", "one", "two", "three", "introduce", "remove", "retain", "change", "recurring", "graphic", "device"]);
  return normalise(value).split(/[^\p{L}\p{N}]+/u)
    .filter((part) => part.length > 2 && !stop.has(part))
    .flatMap((part) => {
      if (/^[\p{Script=Han}]+$/u.test(part)) return Array.from({ length: Math.max(1, part.length - 1) }, (_, index) => part.slice(index, index + 2));
      return /^[a-z]+(?:ed|ing|es|s)$/.test(part) && part.length > 5 ? [part.replace(/(?:ed|ing|es|s)$/, "")] : [part];
    });
}

export interface DecisionSourceMatch {
  status: DecisionSourceStatus;
  propositionIds: string[];
  aiMessageIds: string[];
  diagnostics: DecisionSourceMatchDiagnostics;
}

const GENERIC_PROVENANCE_TOKENS = new Set([
  "location", "place", "memory", "visual", "design", "identity", "direction", "style", "brand",
  "material", "image", "detail", "element", "note", "notes",
]);

const meaningfulTokens = (value: string) => tokens(value).filter((token) => !GENERIC_PROVENANCE_TOKENS.has(token));
const sourceExcerpts = (value: string) => value
  .split(/\n+|(?<=[.!?。！？])\s+|;\s*/)
  .map(compact)
  .filter(Boolean);

export function matchDecisionSource(evidence: string, context: Pick<DecisionTraceContext, "aiPropositions" | "recentMessages">): DecisionSourceMatch {
  const evidenceTokens = new Set(tokens(evidence));
  const evidenceMeaningful = new Set(meaningfulTokens(evidence));
  const emptyDiagnostics: DecisionSourceMatchDiagnostics = { meaningfulMatchedTokens: [], similarityScore: 0, matcherRule: "no_match", rejectedWeakMatchReason: "no_meaningful_overlap" };
  if (!evidenceTokens.size) return { status: "source_unclear", propositionIds: [], aiMessageIds: [], diagnostics: emptyDiagnostics };
  const score = (text: string) => {
    if (/sans\s+serif/i.test(evidence) && !/sans\s+serif/i.test(text)) return {
      overlap: [] as string[], meaningfulOverlap: [] as string[], ratio: 0,
      matcherRule: "no_match" as const, rejectedWeakMatchReason: "no_meaningful_overlap" as const,
    };
    const sourceTokens = new Set(tokens(text));
    const overlap = [...evidenceTokens].filter((token) => sourceTokens.has(token));
    const sourceMeaningful = new Set(meaningfulTokens(text));
    const meaningfulOverlap = [...evidenceMeaningful].filter((token) => sourceMeaningful.has(token));
    const ratio = meaningfulOverlap.length / Math.max(1, Math.min(evidenceMeaningful.size, sourceMeaningful.size));
    const matcherRule: DecisionSourceMatchDiagnostics["matcherRule"] = meaningfulOverlap.length >= 2
      ? "multiple_meaningful_tokens"
      : meaningfulOverlap.length === 1 && meaningfulOverlap[0].length >= 5 && ratio >= .34
        ? "distinctive_design_token"
        : "no_match";
    const rejectedWeakMatchReason: DecisionSourceMatchDiagnostics["rejectedWeakMatchReason"] | undefined = matcherRule !== "no_match"
      ? undefined
      : overlap.length > 0 && meaningfulOverlap.length === 0
        ? "generic_token_only"
        : meaningfulOverlap.length > 0
          ? "insufficient_meaningful_overlap"
          : "no_meaningful_overlap";
    return { overlap, meaningfulOverlap, ratio, matcherRule, rejectedWeakMatchReason };
  };
  const propositionMatches = context.aiPropositions
    .map((item) => ({ item, ...score(item.summary) }))
    .filter((item) => item.matcherRule !== "no_match")
    .sort((left, right) => right.meaningfulOverlap.length - left.meaningfulOverlap.length || right.ratio - left.ratio);
  if (propositionMatches.length) return {
    status: "matched_structured_proposition",
    propositionIds: propositionMatches.slice(0, 2).map(({ item }) => item.id),
    aiMessageIds: [...new Set(propositionMatches.slice(0, 2).map(({ item }) => item.aiMessageId))],
    diagnostics: {
      matchedExcerpt: propositionMatches[0].item.summary,
      meaningfulMatchedTokens: propositionMatches[0].meaningfulOverlap,
      similarityScore: propositionMatches[0].ratio,
      matcherRule: propositionMatches[0].matcherRule,
    },
  };
  const rawMatches = context.recentMessages
    .filter((item) => item.role === "assistant")
    .flatMap((item) => sourceExcerpts(item.content).map((excerpt) => ({ item, excerpt, ...score(excerpt) })))
    .sort((left, right) => right.meaningfulOverlap.length - left.meaningfulOverlap.length || right.ratio - left.ratio);
  const acceptedRaw = rawMatches.filter((item) => item.matcherRule !== "no_match");
  if (acceptedRaw.length) return {
    status: "matched_raw_ai_context",
    propositionIds: [],
    aiMessageIds: [...new Set(acceptedRaw.slice(0, 2).map(({ item }) => item.id))],
    diagnostics: {
      matchedExcerpt: acceptedRaw[0].excerpt,
      meaningfulMatchedTokens: acceptedRaw[0].meaningfulOverlap,
      similarityScore: acceptedRaw[0].ratio,
      matcherRule: acceptedRaw[0].matcherRule,
    },
  };
  const bestWeak = rawMatches.find((item) => item.overlap.length > 0 || item.meaningfulOverlap.length > 0);
  return evidenceTokens.size >= 2
    ? { status: "absent_from_ai_context", propositionIds: [], aiMessageIds: [], diagnostics: bestWeak ? { matchedExcerpt: bestWeak.excerpt, meaningfulMatchedTokens: bestWeak.meaningfulOverlap, similarityScore: bestWeak.ratio, matcherRule: "no_match", rejectedWeakMatchReason: bestWeak.rejectedWeakMatchReason } : emptyDiagnostics }
    : { status: "source_unclear", propositionIds: [], aiMessageIds: [], diagnostics: bestWeak ? { matchedExcerpt: bestWeak.excerpt, meaningfulMatchedTokens: bestWeak.meaningfulOverlap, similarityScore: bestWeak.ratio, matcherRule: "no_match", rejectedWeakMatchReason: bestWeak.rejectedWeakMatchReason } : emptyDiagnostics };
}

function linkedPropositions(evidence: string, propositions: AIProposition[]): AIProposition[] {
  const lower = normalise(evidence);
  const ordinal = /\b(?:option\s*)?(?:2|second|2nd)\b|第二个|第二种|第二方案/i.test(lower) ? 2
    : /\b(?:option\s*)?(?:1|first|1st)\b|第一个|第一种|第一方案/i.test(lower) ? 1
      : /\b(?:option\s*)?(?:3|third|3rd)\b|第三个|第三种|第三方案/i.test(lower) ? 3 : 0;
  if (ordinal) {
    const numbered = propositions.filter((item) => new RegExp(`(?:option|direction)\\s*(?:${ordinal}|${["", "one", "two", "three"][ordinal]})|第${["", "一", "二", "三"][ordinal]}`).test(normalise(`${item.optionLabel ?? ""} ${item.summary}`)));
    if (numbered.length === 1) return numbered;
  }
  const evidenceTokens = new Set(tokens(evidence));
  return propositions
    .map((item) => ({ item, overlap: tokens(item.summary).filter((token) => evidenceTokens.has(token)).length }))
    .filter(({ item }) => !(lower.includes("sans serif") && !normalise(item.summary).includes("sans")))
    .filter(({ overlap }) => overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 2)
    .map(({ item }) => item);
}

export function getParticipantVisibleDecisions(decisions: DecisionUnit[]): DecisionUnit[] {
  return decisions.filter((decision) => {
    if (decision.currentReviewedCategory === null || decision.category === "uncertain" || decision.currentReviewedCategory === "uncertain") return false;
    if (decision.participantMessageId && typeof decision.confidenceScore === "number" && decision.confidenceScore < 0.8) return false;
    return decision.participantMessageId ? true : !decision.relatedBoardEventId;
  });
}

function reversalFor(evidence: string, decisions: DecisionTraceContext["recentDecisionUnits"]): string | null {
  const evidenceTokens = new Set(tokens(evidence));
  const reversed = [...decisions].reverse().find((decision) => tokens(decision.summary).some((token) => evidenceTokens.has(token)));
  return reversed?.id ?? null;
}

function unit(
  context: DecisionTraceContext,
  category: DecisionCategory,
  summary: string,
  evidenceText: string,
  confidence: number,
  reasonCode: DecisionReasonCode,
  linked: AIProposition[] = [],
  reversal: string | null = null,
): ClassifierDecisionUnit {
  const normalizedCategory = confidence < 0.65 ? "uncertain" : category;
  const sourceMatch = matchDecisionSource(evidenceText, context);
  const sourceStatus: DecisionSourceStatus = linked.length
    ? "matched_structured_proposition"
    : normalizedCategory === "human_initiated" && sourceMatch.status === "absent_from_ai_context"
      ? "absent_from_ai_context"
      : sourceMatch.status;
  return {
    category: normalizedCategory,
    summary: compact(summary).slice(0, 180),
    evidenceText,
    participantMessageId: context.participantMessage.id,
    linkedAiMessageIds: [...new Set(linked.length ? linked.map((item) => item.aiMessageId) : sourceMatch.aiMessageIds)],
    linkedAiPropositionIds: [...new Set(linked.length ? linked.map((item) => item.id) : sourceMatch.propositionIds)],
    sourceStatus,
    sourceMatchDiagnostics: sourceMatch.diagnostics,
    confidence,
    reasonCode: confidence < 0.65 && category !== "uncertain" ? "unresolved_reference" : reasonCode,
    reversesDecisionUnitId: reversal,
    supersedesDecisionUnitId: reversal,
  };
}

const cleanEvidence = (value: string) => compact(value.replace(/^[,;\s]+|[,;\s]+$/g, ""));
const neutralSubject = (value: string) => cleanEvidence(value)
  .replace(/^(yes[,\s]*|yea[h]?[,\s]*|okay[,\s]*|ok[,\s]*|actually[,\s]*)/i, "")
  .replace(/^(let'?s\s+|i\s+(?:want|will|would like)\s+to\s+)/i, "");

export function ruleBasedDecisionTrace(context: DecisionTraceContext): DecisionTraceAnalysis {
  const text = compact(context.participantMessage.content);
  const lower = normalise(text);
  const propositions = context.aiPropositions;

  if (!text || /^(hello|hi|thanks|thank you|okay|ok|好的[，,]?谢谢|谢谢)[.!。！\s]*$/i.test(text)) return { analysisResult: "no_decision", units: [] };
  if (/^(can|could|would)\s+you\s+(give|show|explain|make|generate|rewrite)|^(give|show|generate)\s+me|^what\s+(colou?rs?|should|does)|^why\b|给我|为什么|帮我生成|再短一点/i.test(lower)
    && !/\b(my idea|my direction)\b|我的想法|我的方向/i.test(lower)) return { analysisResult: "no_decision", units: [] };
  if (/^(generate|create)\s+(two|an?|some)?\s*(visual|image|moodboard)|生成.{0,8}(图片|视觉)/i.test(lower)) return { analysisResult: "no_decision", units: [] };
  if (/\b(maybe|might|could work|not sure|i guess|something like)\b|可能|好像可以|有一点感觉/i.test(lower)) {
    return { analysisResult: "decision_units", units: [unit(context, "uncertain", "Possible direction indicated without a clear commitment.", text, 0.5, /second|2nd|第二/.test(lower) ? "weak_commitment" : "unresolved_reference", linkedPropositions(text, propositions))] };
  }

  const units: ClassifierDecisionUnit[] = [];
  const mixedModify = /(?:keep|retain|保留).*(?:\bbut\b|但|但是).*(?:colou?r|颜色).*(?:add|加入|一点|更)/i.test(text);
  const clearMulti = !mixedModify && /(?:keep|retain|保留).*(?:remove|drop|不要|去掉).*(?:add|introduce|我想用|加入)/i.test(text);
  const rejectThenNew = !mixedModify && /(?:don[’']?t want|do not want|remove|drop|reject|abandon|不要|放弃|去掉).*(?:\bi want\b|\badd\b|\bintroduce\b|\buse\b.*instead|我想用|改用|加入)/i.test(text);
  const typoSplit = /\b(?:yea|yeah|yes)\b.*\b(?:use|take)\b.*\b(?:but|and)\b.*\b(?:no|without|remove|drop)\b/i.test(lower);

  if (clearMulti || rejectThenNew || typoSplit) {
    const clauses = text.split(/\s*(?:,|;|，|；|\band\b|\bbut\b|但是|但|，?我想|，?改用)\s*/i).map(cleanEvidence).filter(Boolean);
    for (const clause of clauses) {
      const linked = linkedPropositions(clause, propositions);
      const sourceMatch = matchDecisionSource(clause, context);
      const hasAiSource = linked.length > 0 || sourceMatch.status === "matched_structured_proposition" || sourceMatch.status === "matched_raw_ai_context";
      if (/\b(remove|drop|reject|abandon|no\s+|without|don'?t|do not)\b|不要|放弃|去掉/i.test(clause)) {
        const reversal = /actually|instead|改用/i.test(text) ? reversalFor(clause, context.recentDecisionUnits) : null;
        units.push(unit(context, "reject", `Exclude ${neutralSubject(clause).replace(/^(remove|drop|reject|no|without)\s+/i, "")}.`, clause, linked.length ? 0.9 : 0.72, "explicit_rejection", linked, reversal));
      } else if (/\b(keep|retain|use|take)\b|保留|沿着/i.test(clause) && hasAiSource) {
        units.push(unit(context, "accept", `Retain ${neutralSubject(clause).replace(/^(keep|retain|use|take)\s+/i, "")}.`, clause, 0.88, "explicit_adoption", linked));
      } else if (/\b(add|introduce|explore|use)\b|我想用|加入|探索/i.test(clause)) {
        units.push(unit(context, hasAiSource ? "modify" : sourceMatch.status === "absent_from_ai_context" ? "human_initiated" : "uncertain", `Introduce ${neutralSubject(clause).replace(/^(add|introduce|explore|use)\s+/i, "")}.`, clause, hasAiSource ? 0.76 : sourceMatch.status === "absent_from_ai_context" ? 0.88 : 0.55, hasAiSource ? "partial_retention_with_change" : sourceMatch.status === "absent_from_ai_context" ? "participant_new_proposition" : "unresolved_reference", linked));
      }
    }
    if (/我想用/i.test(text) && !units.some((item) => item.category === "human_initiated")) {
      const evidence = text.match(/我想用[^。！？.!?]+/)?.[0];
      if (evidence) units.push(unit(context, "human_initiated", `Introduce ${evidence.replace(/^我想用/, "")}.`, evidence, 0.9, "participant_new_proposition"));
    }
  }

  if (!units.length && /\b(combine|mix)\b|结合|融合/i.test(lower)) {
    const linked = linkedPropositions(text, propositions);
    units.push(unit(context, linked.length ? "modify" : "uncertain", `Combine elements from the referenced directions.`, text, linked.length ? 0.88 : 0.55, linked.length ? "combination_of_ai_options" : "unresolved_reference", linked));
  }

  if (!units.length && /\b(keep|retain|use|take)\b|保留|沿着/i.test(lower) && /\bbut\b|\bonly\b|although|不过|但是|但/i.test(lower)) {
    const linked = linkedPropositions(text, propositions);
    const sourceMatch = matchDecisionSource(text, context);
    const hasAiSource = linked.length > 0 || sourceMatch.status === "matched_structured_proposition" || sourceMatch.status === "matched_raw_ai_context";
    units.push(unit(context, hasAiSource ? "modify" : "uncertain", `Adapt the referenced direction with participant-defined changes.`, text, hasAiSource ? 0.9 : 0.58, hasAiSource && /only|只/.test(lower) ? "conditional_adoption" : hasAiSource ? "partial_retention_with_change" : "unresolved_reference", linked));
  }

  if (!units.length && /\b(remove|drop|reject|abandon|don[’']?t want|do not want|not using|avoid)\b|不要|放弃|去掉|不想用/i.test(lower)) {
    const linked = linkedPropositions(text, propositions);
    const reversal = /actually|instead|改用/i.test(lower) ? reversalFor(text, context.recentDecisionUnits) : null;
    units.push(unit(context, "reject", `Exclude ${neutralSubject(text).replace(/^(remove|drop|reject|avoid)\s+/i, "")}.`, text, linked.length ? 0.92 : 0.72, "explicit_rejection", linked, reversal));
  }

  if (!units.length && /\b(yes|use|choose|select|keep|go with|take forward|main direction|core idea|feels right|works)\b|接受|就用|保留|作为主方向|沿着这个方向/i.test(lower)) {
    const linked = linkedPropositions(text, propositions);
    const sourceMatch = matchDecisionSource(text, context);
    const hasAiSource = linked.length > 0 || sourceMatch.status === "matched_structured_proposition" || sourceMatch.status === "matched_raw_ai_context";
    if (hasAiSource) units.push(unit(context, "accept", `Retain the referenced AI direction.`, text, 0.9, /yes|接受|就用/.test(lower) ? "explicit_adoption" : "implicit_commitment", linked));
    else if (/\b(that|this|it|one)\b|这个|那个|方向/i.test(lower)) units.push(unit(context, "uncertain", "Possible adoption with an unresolved reference.", text, 0.52, "unresolved_reference"));
    else units.push(unit(context, sourceMatch.status === "absent_from_ai_context" ? "human_initiated" : "uncertain", sourceMatch.status === "absent_from_ai_context" ? `Introduce ${neutralSubject(text)}.` : "A possible direction was expressed with an unclear source.", text, sourceMatch.status === "absent_from_ai_context" ? 0.82 : 0.55, sourceMatch.status === "absent_from_ai_context" ? "participant_new_proposition" : "unresolved_reference"));
  }

  if (!units.length && /\b(i want|i think|what about|let'?s|explore|introduce|my idea)\b|我想|我觉得|可以把|从.+出发/i.test(lower)) {
    const linked = linkedPropositions(text, propositions);
    const sourceMatch = matchDecisionSource(text, context);
    const hasAiSource = linked.length > 0 || sourceMatch.status === "matched_structured_proposition" || sourceMatch.status === "matched_raw_ai_context";
    units.push(unit(context, hasAiSource ? "modify" : sourceMatch.status === "absent_from_ai_context" ? "human_initiated" : "uncertain", hasAiSource ? "Develop the referenced AI direction with a participant-defined proposition." : sourceMatch.status === "absent_from_ai_context" ? `Introduce ${neutralSubject(text)}.` : "A possible direction was expressed with an unclear source.", text, hasAiSource ? 0.74 : sourceMatch.status === "absent_from_ai_context" ? 0.9 : 0.55, hasAiSource ? "partial_retention_with_change" : sourceMatch.status === "absent_from_ai_context" ? "participant_new_proposition" : "unresolved_reference", linked));
  }

  if (!units.length && /\b(feels|seems|looks|is)\b.*\b(too|generic|formal|commercial)\b|太正式|太普通|不符合/i.test(lower)) {
    units.push(unit(context, "uncertain", "A concern was expressed without a clear design action.", text, 0.52, "weak_commitment", linkedPropositions(text, propositions)));
  }

  return units.length ? { analysisResult: "decision_units", units } : { analysisResult: "no_decision", units: [] };
}

export function validateDecisionTraceAnalysis(value: unknown, context: DecisionTraceContext): DecisionTraceAnalysis | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { analysisResult?: unknown; units?: unknown };
  if ((candidate.analysisResult !== "decision_units" && candidate.analysisResult !== "no_decision") || !Array.isArray(candidate.units)) return null;
  if (candidate.analysisResult === "no_decision") return candidate.units.length === 0 ? { analysisResult: "no_decision", units: [] } : null;
  if (!candidate.units.length || candidate.units.length > 8) return null;
  const messageIds = new Set(context.recentMessages.map((item) => item.id));
  const propositionIds = new Set(context.aiPropositions.map((item) => item.id));
  const decisionIds = new Set(context.recentDecisionUnits.map((item) => item.id));
  const units: ClassifierDecisionUnit[] = [];
  for (const raw of candidate.units) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    if (!DECISION_CATEGORIES.includes(item.category as DecisionCategory) || !DECISION_REASON_CODES.includes(item.reasonCode as DecisionReasonCode)) return null;
    if (typeof item.summary !== "string" || !compact(item.summary) || item.summary.length > 220) return null;
    if (typeof item.evidenceText !== "string" || !item.evidenceText || !context.participantMessage.content.includes(item.evidenceText)) return null;
    if (item.participantMessageId !== context.participantMessage.id || typeof item.confidence !== "number" || item.confidence < 0 || item.confidence > 1) return null;
    const aiMessageIds = Array.isArray(item.linkedAiMessageIds) ? item.linkedAiMessageIds.filter((id): id is string => typeof id === "string") : [];
    const aiPropIds = Array.isArray(item.linkedAiPropositionIds) ? item.linkedAiPropositionIds.filter((id): id is string => typeof id === "string") : [];
    if (aiMessageIds.some((id) => !messageIds.has(id)) || aiPropIds.some((id) => !propositionIds.has(id))) return null;
    const reverse = typeof item.reversesDecisionUnitId === "string" ? item.reversesDecisionUnitId : null;
    const supersede = typeof item.supersedesDecisionUnitId === "string" ? item.supersedesDecisionUnitId : null;
    if ((reverse && !decisionIds.has(reverse)) || (supersede && !decisionIds.has(supersede))) return null;
    const confidence = item.confidence;
    if (!["matched_structured_proposition", "matched_raw_ai_context", "absent_from_ai_context", "source_unclear"].includes(item.sourceStatus as string)) return null;
    const deterministicSource = matchDecisionSource(item.evidenceText, context);
    let category = confidence < 0.65 ? "uncertain" : item.category as DecisionCategory;
    let reasonCode = confidence < 0.65 ? "unresolved_reference" : item.reasonCode as DecisionReasonCode;
    let sourceStatus = item.sourceStatus as DecisionSourceStatus;
    let resolvedMessageIds = aiMessageIds;
    let resolvedPropositionIds = aiPropIds;
    if (category === "human_initiated" && deterministicSource.status !== "absent_from_ai_context") {
      category = "uncertain";
      reasonCode = "unresolved_reference";
      sourceStatus = deterministicSource.status === "source_unclear" ? "source_unclear" : deterministicSource.status;
      resolvedMessageIds = [...new Set([...aiMessageIds, ...deterministicSource.aiMessageIds])];
      resolvedPropositionIds = [...new Set([...aiPropIds, ...deterministicSource.propositionIds])];
    }
    units.push({
      category,
      summary: compact(item.summary), evidenceText: item.evidenceText,
      participantMessageId: context.participantMessage.id,
      linkedAiMessageIds: resolvedMessageIds, linkedAiPropositionIds: resolvedPropositionIds,
      sourceStatus,
      sourceMatchDiagnostics: deterministicSource.diagnostics,
      confidence, reasonCode,
      reversesDecisionUnitId: reverse, supersedesDecisionUnitId: supersede,
    });
  }
  return { analysisResult: "decision_units", units };
}
