import type { Condition, PostTaskQuestionnaires, Session } from "@/types";

export const MAIN_QUESTIONNAIRE_URL = process.env.NEXT_PUBLIC_MAIN_QUESTIONNAIRE_URL ?? "https://example.com/main-questionnaire";
export const ADDITIONAL_QUESTIONNAIRE_URL = process.env.NEXT_PUBLIC_ADDITIONAL_QUESTIONNAIRE_URL ?? "https://example.com/additional-questionnaire";

export type QuestionnaireKind = "main" | "additional";

const emptyItem = (required: boolean) => ({
  required,
  openedAt: null,
  participantConfirmedSubmitted: false,
  confirmedAt: null,
});

export function createPostTaskQuestionnaires(condition: Condition): PostTaskQuestionnaires {
  return {
    main: emptyItem(true),
    additional: emptyItem(condition === "B"),
    studyCompletedAt: null,
  };
}

export function normalisePostTaskQuestionnaires(value: PostTaskQuestionnaires, condition: Condition): PostTaskQuestionnaires {
  const defaults = createPostTaskQuestionnaires(condition);
  return {
    main: {
      ...defaults.main,
      ...value.main,
      required: true,
    },
    additional: {
      ...defaults.additional,
      ...value.additional,
      required: condition === "B",
    },
    studyCompletedAt: value.studyCompletedAt ?? null,
  };
}

export function markQuestionnaireOpened(workflow: PostTaskQuestionnaires, kind: QuestionnaireKind, openedAt: string): PostTaskQuestionnaires {
  return {
    ...workflow,
    [kind]: { ...workflow[kind], openedAt: workflow[kind].openedAt ?? openedAt },
  };
}

export function setQuestionnaireConfirmation(workflow: PostTaskQuestionnaires, kind: QuestionnaireKind, confirmed: boolean, confirmedAt: string): PostTaskQuestionnaires {
  return {
    ...workflow,
    [kind]: {
      ...workflow[kind],
      participantConfirmedSubmitted: confirmed,
      confirmedAt: confirmed ? confirmedAt : null,
    },
  };
}

export function canCompleteQuestionnaireWorkflow(workflow: PostTaskQuestionnaires): boolean {
  return workflow.main.participantConfirmedSubmitted
    && (!workflow.additional.required || workflow.additional.participantConfirmedSubmitted);
}

export function completeQuestionnaireWorkflow(workflow: PostTaskQuestionnaires, completedAt: string): PostTaskQuestionnaires {
  if (!canCompleteQuestionnaireWorkflow(workflow)) return workflow;
  return { ...workflow, studyCompletedAt: workflow.studyCompletedAt ?? completedAt };
}

export function completePostTaskStudy(session: Session, completedAt: string): Session {
  const workflow = session.postTaskQuestionnaires ?? createPostTaskQuestionnaires(session.condition);
  if (!canCompleteQuestionnaireWorkflow(workflow)) return session;
  const completionTimeSeconds = session.participantStartedAt
    ? Math.max(0, Math.floor((new Date(completedAt).getTime() - new Date(session.participantStartedAt).getTime()) / 1000))
    : session.completionTimeSeconds;
  return {
    ...session,
    status: "submitted",
    endedAt: completedAt,
    endReason: "participant_submission",
    completionTimeSeconds,
    postTaskQuestionnaires: completeQuestionnaireWorkflow(workflow, completedAt),
  };
}
