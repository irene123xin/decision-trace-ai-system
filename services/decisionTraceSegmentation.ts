import type { DecisionReasonCode } from "@/types";

export type SegmentationStatus = "no_decision" | "candidate_spans" | "uncertain";

export interface SegmentationResult {
  classificationStatus: SegmentationStatus;
  spans: string[];
  overflow: boolean;
}

export interface MinimalUncertainResult {
  status: "uncertain";
  evidence: string;
  confidence: number;
  reasonCode: Extract<DecisionReasonCode, "unresolved_reference" | "weak_commitment" | "conflicting_language">;
  possibleReference: string | null;
}

export function buildReducedSchemaRepairInput(schemaName: string, malformedResponse: string, validationPath: string, schemaSummary: string) {
  return {
    task: `Repair ${schemaName} JSON only.`,
    malformed_response: malformedResponse.slice(0, 4_000),
    validation_error_path: validationPath,
    required_schema: schemaSummary,
  };
}

const compact = (value: string) => value.trim().replace(/\s+/g, " ");
const trimClause = (value: string) => compact(value)
  .replace(/^[,;:\s]+|[,;:\s]+$/g, "")
  .replace(/[,;\s]+(?:and|then)$/i, "")
  .replace(/^(?:and|then)\s+/i, "");

/**
 * Syntax-only fallback used when model segmentation cannot be validated.
 * It finds explicit action-clause boundaries but never assigns categories.
 */
export function splitDecisionCandidateSpans(message: string, maximum = 3): SegmentationResult {
  const normalized = compact(message);
  if (!normalized) return { classificationStatus: "no_decision", spans: [], overflow: false };

  const action = /\b(?:keep|retain|use|remove|drop|reject|exclude|abandon|introduce|add|adopt|select|choose)\b|(?:保留|使用|采用|移除|去掉|拒绝|放弃|引入|加入|选择)/gi;
  const starts = [...normalized.matchAll(action)].map((match) => match.index ?? 0);
  if (starts.length < 2) return { classificationStatus: "candidate_spans", spans: [normalized], overflow: false };

  const spans = starts.map((start, index) => trimClause(normalized.slice(start, starts[index + 1] ?? normalized.length)))
    .filter(Boolean);
  const overflow = spans.length > maximum;
  return { classificationStatus: "candidate_spans", spans: spans.slice(0, maximum), overflow };
}

export function validateSegmentationResult(value: unknown, participantMessage: string, maximum = 3): SegmentationResult | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!["no_decision", "candidate_spans", "uncertain"].includes(candidate.classification_status as string) || !Array.isArray(candidate.spans)) return null;
  const status = candidate.classification_status as SegmentationStatus;
  const spans = candidate.spans.filter((item): item is string => typeof item === "string").map(compact);
  if (spans.length !== candidate.spans.length || spans.some((span) => !span || !participantMessage.includes(span))) return null;
  if (status === "no_decision" && spans.length) return null;
  if (status === "uncertain" && spans.length > 1) return null;
  if (status === "candidate_spans" && !spans.length) return null;
  return { classificationStatus: status, spans: spans.slice(0, maximum), overflow: spans.length > maximum || candidate.overflow === true };
}

export function validateMinimalUncertain(value: unknown, participantMessage: string): MinimalUncertainResult | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (item.status !== "uncertain" || typeof item.evidence !== "string" || !participantMessage.includes(item.evidence)) return null;
  if (typeof item.confidence !== "number" || item.confidence < 0 || item.confidence > 1) return null;
  if (!["unresolved_reference", "weak_commitment", "conflicting_language"].includes(item.reason_code as string)) return null;
  if (item.possible_reference !== null && typeof item.possible_reference !== "string") return null;
  return {
    status: "uncertain",
    evidence: item.evidence,
    confidence: Math.min(item.confidence, 0.79),
    reasonCode: item.reason_code as MinimalUncertainResult["reasonCode"],
    possibleReference: item.possible_reference as string | null,
  };
}
