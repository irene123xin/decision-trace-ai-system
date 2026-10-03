"use client";

import { useState } from "react";
import { BriefPanel } from "@/components/BriefPanel";
import { TaskGuideContent } from "@/components/TaskGuideContent";
import type { Session } from "@/types";

export function PreTaskBriefing({ session, onStart }: { session: Session; onStart: () => void }) {
  const [checks, setChecks] = useState([false, false, false]);
  const statements = [
    "I understand that this is an early-stage direction, not a finished identity.",
    "I understand the required outputs and session limits.",
    "I am ready to begin the timed task using only this workspace.",
  ];
  const ready = checks.every(Boolean);
  return <main className="briefingPage">
    <header className="briefingHeader"><div className="entryBrand"><span>E</span><p>AI-assisted creative workspace</p></div><div><span>Participant code</span><strong>{session.participantId}</strong></div></header>
    <div className="briefingLayout"><aside><p className="eyebrow">BEFORE THE TIMER STARTS</p><h1>Task briefing</h1><p>Review the fixed Brief and workspace guide, then confirm the three statements. Your {session.taskDurationMinutes}-minute timer begins when you continue to the Starting Point.</p></aside><div><BriefPanel compact durationMinutes={session.taskDurationMinutes} /><TaskGuideContent session={session} /><section className="briefingConfirm"><p className="eyebrow">READY TO BEGIN</p><h2>Confirm before starting</h2>{statements.map((statement, index) => <label key={statement}><input type="checkbox" checked={checks[index]} onChange={() => setChecks(checks.map((value, item) => item === index ? !value : value))} /><span>{statement}</span></label>)}<button className="primaryButton substantial" disabled={!ready} onClick={onStart}><span><small>TIMER BEGINS ON THIS ACTION</small>Continue to Starting Point</span><span aria-hidden>→</span></button></section></div></div>
  </main>;
}
