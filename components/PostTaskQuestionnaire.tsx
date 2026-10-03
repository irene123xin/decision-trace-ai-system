"use client";

import { useState } from "react";
import {
  ADDITIONAL_QUESTIONNAIRE_URL,
  canCompleteQuestionnaireWorkflow,
  completePostTaskStudy,
  createPostTaskQuestionnaires,
  MAIN_QUESTIONNAIRE_URL,
  markQuestionnaireOpened,
  setQuestionnaireConfirmation,
  type QuestionnaireKind,
} from "@/services/postTaskQuestionnaires";
import type { Session } from "@/types";
import type { SaveStatus } from "@/services/remoteSessionClient";

interface Props {
  session: Session;
  onUpdate: (updater: (current: Session) => Session) => Session | null;
  onCriticalUpdate?: (session: Session) => Promise<boolean>;
  saveStatus?: SaveStatus;
}

export function PostTaskQuestionnaire({ session, onUpdate, onCriticalUpdate, saveStatus = "idle" }: Props) {
  const [copied, setCopied] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const workflow = session.postTaskQuestionnaires ?? createPostTaskQuestionnaires(session.condition);
  const updateWorkflow = (updater: (current: typeof workflow) => typeof workflow) => onUpdate((current) => ({
    ...current,
    postTaskQuestionnaires: updater(current.postTaskQuestionnaires ?? createPostTaskQuestionnaires(current.condition)),
  }));
  const opened = (kind: QuestionnaireKind) => updateWorkflow((current) => markQuestionnaireOpened(current, kind, new Date().toISOString()));
  const confirmSubmitted = (kind: QuestionnaireKind, confirmed: boolean) => updateWorkflow((current) => setQuestionnaireConfirmation(current, kind, confirmed, new Date().toISOString()));
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(session.participantId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };
  const completeStudy = async () => {
    const completedAt = new Date().toISOString();
    const next = completePostTaskStudy(session, completedAt);
    if (onCriticalUpdate) await onCriticalUpdate(next); else onUpdate(() => next);
  };

  return <main className="postTaskQuestionnaire">
    <div className="entryBrand"><span>E</span><p>AI-assisted creative workspace</p></div>
    <section className="questionnairePanel">
      <header><p className="eyebrow">ELSEWHERE · EARLY BRAND IDENTITY TASK</p><h1>Post-task questionnaire</h1></header>
      <div className="participantCodeBlock"><div><span>Use the participant code below when completing the questionnaire.</span><strong>{session.participantId}</strong></div><button type="button" onClick={() => void copyCode()}>Copy code</button>{copied && <small role="status">Participant code copied</small>}</div>
      <div className={`questionnaireSteps${workflow.additional.required ? "" : " single"}`}>
        <article>
          <span>Step 1 of {workflow.additional.required ? "2" : "1"}</span>
          <h2>Complete the post-task questionnaire.</h2>
          <a href={MAIN_QUESTIONNAIRE_URL} target="_blank" rel="noopener noreferrer" onClick={() => opened("main")}>Open post-task questionnaire</a>
          <label><input type="checkbox" checked={workflow.main.participantConfirmedSubmitted} onChange={(event) => confirmSubmitted("main", event.target.checked)} />I have completed and submitted the post-task questionnaire.</label>
        </article>
        {workflow.additional.required && <article>
          <span>Step 2 of 2</span>
          <h2>Complete the additional questionnaire about the process information shown during the task.</h2>
          <a href={ADDITIONAL_QUESTIONNAIRE_URL} target="_blank" rel="noopener noreferrer" onClick={() => opened("additional")}>Open additional questionnaire</a>
          <label><input type="checkbox" checked={workflow.additional.participantConfirmedSubmitted} onChange={(event) => confirmSubmitted("additional", event.target.checked)} />I have completed and submitted the additional questionnaire.</label>
        </article>}
      </div>
      <footer><p>The forms open in a new tab. Keep this design-session tab open until you return to complete the study. {saveStatus === "saving" ? "Saving…" : saveStatus === "retrying" ? "Save failed — retrying" : saveStatus === "saved" ? "Saved" : ""}</p><button className="primaryButton" type="button" disabled={!canCompleteQuestionnaireWorkflow(workflow)} onClick={() => setConfirmOpen(true)}>Complete study</button></footer>
    </section>
    {confirmOpen && <div className="modalBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmOpen(false); }}><section className="confirmDialog" role="alertdialog" aria-modal="true" aria-labelledby="complete-study-title"><p className="eyebrow">FINAL CONFIRMATION</p><h2 id="complete-study-title">Complete the study?</h2><p>Please confirm that you have submitted all required questionnaires. After completing the study, the participant session will be locked.</p><div><button type="button" onClick={() => setConfirmOpen(false)}>Cancel</button><button className="primaryButton" type="button" onClick={() => void completeStudy()}>Complete study</button></div></section></div>}
  </main>;
}
