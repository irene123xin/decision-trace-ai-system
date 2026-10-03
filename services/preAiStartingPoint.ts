import type { PreAiStartingPoint, Session } from "@/types";

export const PRE_AI_INTERPRETATION_MIN = 20;
export const PRE_AI_INTERPRETATION_MAX = 500;
export const PRE_AI_VISUAL_QUESTION_MIN = 15;
export const PRE_AI_VISUAL_QUESTION_MAX = 300;

export function createPreAiStartingPoint(startedAt: string | null = null): PreAiStartingPoint {
  return {
    status: "draft",
    initialInterpretation: "",
    keywords: ["", "", ""],
    visualQuestion: "",
    startedAt,
    submittedAt: null,
    durationMs: null,
  };
}

export function normalisePreAiStartingPoint(value: PreAiStartingPoint): PreAiStartingPoint {
  const keywords = Array.isArray(value.keywords) ? value.keywords : [];
  return {
    status: value.status === "submitted" ? "submitted" : "draft",
    initialInterpretation: value.initialInterpretation ?? "",
    keywords: [keywords[0] ?? "", keywords[1] ?? "", keywords[2] ?? ""],
    visualQuestion: value.visualQuestion ?? "",
    startedAt: value.startedAt ?? null,
    submittedAt: value.submittedAt ?? null,
    durationMs: typeof value.durationMs === "number" ? value.durationMs : null,
  };
}

export function getPreAiValidation(record: PreAiStartingPoint) {
  const interpretationLength = record.initialInterpretation.trim().length;
  const visualQuestionLength = record.visualQuestion.trim().length;
  const keywordsValid = record.keywords.length === 3 && record.keywords.every((keyword) => keyword.trim().length > 0);
  return {
    initialInterpretation: interpretationLength >= PRE_AI_INTERPRETATION_MIN && interpretationLength <= PRE_AI_INTERPRETATION_MAX,
    keywords: keywordsValid,
    visualQuestion: visualQuestionLength >= PRE_AI_VISUAL_QUESTION_MIN && visualQuestionLength <= PRE_AI_VISUAL_QUESTION_MAX,
    isValid: interpretationLength >= PRE_AI_INTERPRETATION_MIN
      && interpretationLength <= PRE_AI_INTERPRETATION_MAX
      && keywordsValid
      && visualQuestionLength >= PRE_AI_VISUAL_QUESTION_MIN
      && visualQuestionLength <= PRE_AI_VISUAL_QUESTION_MAX,
  };
}

export function submitPreAiStartingPoint(record: PreAiStartingPoint, submittedAt: string): PreAiStartingPoint {
  if (!getPreAiValidation(record).isValid || !record.startedAt) throw new Error("Pre-AI starting point is incomplete");
  return {
    ...record,
    status: "submitted",
    submittedAt,
    durationMs: Math.max(0, new Date(submittedAt).getTime() - new Date(record.startedAt).getTime()),
  };
}

export function startPreAiStage(session: Session, startedAt: string): Session {
  return {
    ...session,
    status: "starting_point",
    startedAt,
    participantStartedAt: startedAt,
    briefingConfirmedAt: startedAt,
    preAiStartingPoint: createPreAiStartingPoint(startedAt),
  };
}

export function completePreAiStage(session: Session, submittedAt: string): Session {
  if (!session.preAiStartingPoint) throw new Error("Pre-AI starting point is unavailable");
  return { ...session, status: "active", preAiStartingPoint: submitPreAiStartingPoint(session.preAiStartingPoint, submittedAt) };
}

export function canAccessAiWorkspace(session: Session): boolean {
  return session.preAiStartingPoint?.status === "submitted";
}

export function getPreAiRecordStatus(session: Session): "Draft" | "Submitted" | "Not available for legacy session" {
  if (!session.preAiStartingPoint) return "Not available for legacy session";
  return session.preAiStartingPoint.status === "submitted" ? "Submitted" : "Draft";
}
