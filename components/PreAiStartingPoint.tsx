"use client";

import { useEffect, useRef, useState } from "react";
import { BriefPanel } from "@/components/BriefPanel";
import { getPreAiValidation, PRE_AI_INTERPRETATION_MAX, PRE_AI_INTERPRETATION_MIN, PRE_AI_VISUAL_QUESTION_MAX, PRE_AI_VISUAL_QUESTION_MIN } from "@/services/preAiStartingPoint";
import type { PreAiStartingPoint, Session } from "@/types";
import type { SaveStatus } from "@/services/remoteSessionClient";

interface Props {
  session: Session;
  record: PreAiStartingPoint;
  onDraftChange: (record: PreAiStartingPoint) => void;
  onDraftCheckpoint: () => void;
  onSubmit: () => void;
  saveStatus?: SaveStatus;
}

export function PreAiStartingPoint({ session, record, onDraftChange, onDraftCheckpoint, onSubmit, saveStatus = "idle" }: Props) {
  const [now, setNow] = useState(Date.now);
  const [showBrief, setShowBrief] = useState(false);
  const [touched, setTouched] = useState({ interpretation: false, keywords: false, visualQuestion: false });
  const checkpoint = useRef(JSON.stringify(record));
  const validation = getPreAiValidation(record);
  const taskStartedAt = session.participantStartedAt ?? record.startedAt ?? session.startedAt;
  const elapsedSeconds = Math.max(0, Math.floor((now - new Date(taskStartedAt).getTime()) / 1000));
  const remainingSeconds = Math.max(0, session.taskDurationMinutes * 60 - elapsedSeconds);
  const timer = `${String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:${String(remainingSeconds % 60).padStart(2, "0")}`;

  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(interval); }, []);

  const saveCheckpoint = () => {
    const next = JSON.stringify(record);
    if (next === checkpoint.current) return;
    checkpoint.current = next;
    onDraftCheckpoint();
  };
  const updateKeyword = (index: number, value: string) => {
    const keywords: [string, string, string] = [...record.keywords];
    keywords[index] = value;
    onDraftChange({ ...record, keywords });
  };

  return <main className="preAiPage">
    <header className="preAiHeader"><button type="button" className="entryBrand" onClick={() => setShowBrief(false)}><span>E</span><p>Early brand identity workspace</p></button><div className="preAiMetrics"><div><span>Participant</span><strong>{session.participantId}</strong></div><div><span>Time guide</span><strong>{timer}</strong></div></div></header>
    <nav className="preAiNav" aria-label="Task preparation"><button type="button" className={showBrief ? "" : "active"} onClick={() => setShowBrief(false)}>Starting point</button><button type="button" className={showBrief ? "active" : ""} onClick={() => setShowBrief(true)}>Task brief</button></nav>
    {showBrief ? <section className="preAiBrief"><div><p className="eyebrow">TASK BRIEF</p><h1>Elsewhere — Early Brand Identity</h1><p>Your Starting Point draft remains saved while you review the brief.</p><button type="button" className="preAiReturn" onClick={() => setShowBrief(false)}>Return to Starting Point →</button></div><BriefPanel compact durationMinutes={session.taskDurationMinutes} /></section> :
      <section className="preAiLayout"><aside><p className="eyebrow">BEFORE THE AI WORKSPACE</p><h1>Starting point</h1><p>Before opening the AI workspace, briefly record how you currently interpret the brief. There are no correct answers, and these notes do not need to be fully developed.</p><p>Spend approximately 4 minutes on this page. You may continue as soon as you have completed all three prompts.</p><small>Suggested time for this stage: about 4 minutes.</small></aside>
        <form className="preAiForm" onSubmit={(event) => { event.preventDefault(); if (validation.isValid) onSubmit(); }}>
          <label className="preAiField"><span><strong>Initial interpretation</strong><i>{record.initialInterpretation.length} / {PRE_AI_INTERPRETATION_MAX}</i></span><p>In one or two sentences, how do you currently understand Elsewhere and the kind of identity it may need?</p><textarea rows={5} maxLength={PRE_AI_INTERPRETATION_MAX} value={record.initialInterpretation} onChange={(event) => onDraftChange({ ...record, initialInterpretation: event.target.value })} onBlur={() => { setTouched((current) => ({ ...current, interpretation: true })); saveCheckpoint(); }} />{touched.interpretation && !validation.initialInterpretation && <small>Enter at least {PRE_AI_INTERPRETATION_MIN} characters.</small>}</label>
          <fieldset className="preAiKeywords" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { setTouched((current) => ({ ...current, keywords: true })); saveCheckpoint(); } }}><legend>Three starting keywords</legend><p>Enter three words or short phrases that currently feel relevant to the brand.</p><div>{record.keywords.map((keyword, index) => <label key={index}><span>{String(index + 1).padStart(2, "0")}</span><input aria-label={`Starting keyword ${index + 1}`} value={keyword} maxLength={80} onChange={(event) => updateKeyword(index, event.target.value)} /></label>)}</div>{touched.keywords && !validation.keywords && <small>Complete all three keyword fields.</small>}</fieldset>
          <label className="preAiField"><span><strong>Initial visual question or direction</strong><i>{record.visualQuestion.length} / {PRE_AI_VISUAL_QUESTION_MAX}</i></span><p>What is one visual question or direction you would currently be interested in exploring?</p><textarea rows={4} maxLength={PRE_AI_VISUAL_QUESTION_MAX} value={record.visualQuestion} onChange={(event) => onDraftChange({ ...record, visualQuestion: event.target.value })} onBlur={() => { setTouched((current) => ({ ...current, visualQuestion: true })); saveCheckpoint(); }} />{touched.visualQuestion && !validation.visualQuestion && <small>Enter at least {PRE_AI_VISUAL_QUESTION_MIN} characters.</small>}</label>
          <footer><p>{validation.isValid ? "All three prompts are complete." : "Complete all three prompts to continue."} {saveStatus === "saving" ? "Saving…" : saveStatus === "retrying" ? "Save failed — retrying" : saveStatus === "saved" ? "Saved" : ""}</p><button className="primaryButton" type="submit" disabled={!validation.isValid}>Continue to AI workspace →</button></footer>
        </form>
      </section>}
  </main>;
}
