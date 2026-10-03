"use client";

import type { Session } from "@/types";

export function ParticipantEntry({ session, onContinue }: { session: Session; onContinue: () => void }) {
  return (
    <main className="participantEntry">
      <section className="participantIdentity">
        <div className="entryBrand"><span>E</span><p>AI-assisted creative workspace</p></div>
        <div>
          <p className="eyebrow">EARLY BRAND IDENTITY TASK</p>
          <h1>Elsewhere</h1>
          <p className="entryLead">Develop one coherent early-stage brand identity direction for Elsewhere, an independent fragrance brand.</p>
        </div>
        <div className="todayTask"><span>Today’s task</span><p>Move between the brief, conversation, generated visual material and your working direction board. Your final direction should feel considered, coherent and achievable within the session.</p></div>
      </section>
      <section className="participantStart">
        <div className="entryMeta"><div><span>Participant code</span><strong>{session.participantId}</strong></div><div><span>Task duration</span><strong>{session.taskDurationMinutes} minutes</strong></div></div>
        <div className="entryBrief"><p className="eyebrow">ELSEWHERE · INDEPENDENT FRAGRANCE</p><h2>Early Brand Identity Task</h2><p>Develop an early identity direction inspired by ordinary places, passing moments and personal memories rather than luxury, gender or status.</p><ul><li>Review the fixed Brief before beginning.</li><li>Use the conversation and generated material to develop the Board.</li><li>Use Final Review before submitting the direction.</li></ul></div>
        <button className="primaryButton substantial participantStartButton" onClick={onContinue}><span><small>REVIEW THE TASK BEFORE TIMING BEGINS</small>Continue to task briefing</span><span aria-hidden>→</span></button>
        <p className="entryPrivacy">Your session uses an anonymous participant code. Do not enter personal information in the workspace.</p>
      </section>
    </main>
  );
}
