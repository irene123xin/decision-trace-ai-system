"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { ParticipantEntry } from "@/components/ParticipantEntry";
import { PreAiStartingPoint } from "@/components/PreAiStartingPoint";
import { ParticipantWorkspace } from "@/components/ParticipantWorkspace";
import { PostTaskQuestionnaire } from "@/components/PostTaskQuestionnaire";
import { PreTaskBriefing } from "@/components/PreTaskBriefing";
import { SubmissionConfirmation } from "@/components/SubmissionConfirmation";
import { useParticipantSession } from "@/components/useParticipantSession";
import { canAccessAiWorkspace, completePreAiStage, createPreAiStartingPoint, startPreAiStage } from "@/services/preAiStartingPoint";
import type { ResearchEvent, ResearchEventType, Session } from "@/types";

function addEvent(base: Session, type: ResearchEventType, summary: string): Session {
  const event: ResearchEvent = { id: `RE${String(base.researchEvents.length + 1).padStart(2, "0")}`, type, summary, actor: "participant", createdAt: new Date().toISOString(), timestampSeconds: base.participantStartedAt ? Math.max(0, Math.floor((Date.now() - new Date(base.participantStartedAt).getTime()) / 1000)) : 0 };
  return { ...base, researchEvents: [...base.researchEvents, event] };
}

export default function ParticipantSessionPage() {
  const params = useParams<{ sessionId: string }>();
  const { hydrated, loading, invalid, tabBlocked, session, setSession, updateSession, persistCritical, acceptRemoteEnvelope, saveStatus } = useParticipantSession(params.sessionId);
  useEffect(() => {
    if (!session || session.preAiStartingPoint || !["starting_point", "active"].includes(session.status)) return;
    const now = new Date().toISOString();
    const participantStartedAt = session.participantStartedAt ?? now;
    const next = addEvent({ ...session, status: "starting_point", participantStartedAt, preAiStartingPoint: createPreAiStartingPoint(now) }, "pre_ai_started", "Participant opened the Starting Point stage.");
    setSession(next);
  }, [session, setSession]);
  if (tabBlocked) return <main className="sessionUnavailable"><p className="eyebrow">ELSEWHERE SESSION</p><h1>This session is already open in another tab.</h1><p>Return to the original tab. This page will become available after the other tab is closed.</p></main>;
  if (!hydrated || loading) return <main className="loadingScreen delayedParticipantLoading">Opening participant session…</main>;
  if (saveStatus === "conflict") return <main className="sessionUnavailable"><p className="eyebrow">SESSION SAVE PAUSED</p><h1>This session changed elsewhere.</h1><p>Refresh this page to reload the latest saved version before continuing.</p></main>;
  if (!session || invalid) return <main className="sessionUnavailable"><p className="eyebrow">ELSEWHERE SESSION</p><h1>This participant session link is invalid or no longer available.</h1></main>;
  if (session.status === "submitted") return <SubmissionConfirmation session={session} />;
  if (session.status === "questionnaire") return <PostTaskQuestionnaire session={session} onUpdate={updateSession} onCriticalUpdate={persistCritical} saveStatus={saveStatus} />;
  if (session.status === "ended" || session.status === "restarted") return <main className="sessionUnavailable"><p className="eyebrow">ELSEWHERE SESSION</p><h1>This session has ended.</h1><p>Your saved work is no longer editable. Please notify the researcher.</p></main>;
  if (session.status === "ready") return <ParticipantEntry session={session} onContinue={() => { const now = new Date().toISOString(); setSession(addEvent({ ...session, status: "briefing", briefingOpenedAt: now }, "briefing_opened", "Participant opened the pre-task briefing.")); }} />;
  if (session.status === "briefing") return <PreTaskBriefing session={session} onStart={() => { const startedAt = new Date().toISOString(); let next = addEvent(startPreAiStage(session, startedAt), "briefing_confirmed", "Participant confirmed the briefing statements."); next = addEvent(next, "task_started", "Participant started the timed task."); next = addEvent(next, "pre_ai_started", "Participant opened the Starting Point stage."); setSession(next); }} />;
  if (["starting_point", "active"].includes(session.status) && !canAccessAiWorkspace(session)) {
    if (!session.preAiStartingPoint) return <main className="loadingScreen">Preparing the Starting Point…</main>;
    return <PreAiStartingPoint
      session={session}
      record={session.preAiStartingPoint}
      onDraftChange={(record) => setSession({ ...session, status: "starting_point", preAiStartingPoint: record })}
      onDraftCheckpoint={() => setSession(addEvent(session, "pre_ai_draft_updated", "Participant saved updates to the Starting Point draft."))}
      onSubmit={() => {
        const submittedAt = new Date().toISOString();
        const next = addEvent(completePreAiStage(session, submittedAt), "pre_ai_submitted", "Participant submitted the Starting Point record.");
        void persistCritical(next);
      }}
      saveStatus={saveStatus}
    />;
  }
  if (session.participantExitedAt) return <main className="participantReturn"><div className="entryBrand"><span>E</span><p>AI-assisted creative workspace</p></div><section><p className="eyebrow">WORKSPACE SAVED</p><h1>Task workspace closed</h1><p>Your progress is saved. The session timer continues while the workspace is closed.</p><button className="primaryButton" onClick={() => setSession({ ...session, participantExitedAt: undefined })}>Continue working →</button><small>If you intended to finish the session, please contact the researcher.</small></section></main>;
  if (!canAccessAiWorkspace(session)) return <main className="loadingScreen">Preparing the Starting Point…</main>;
  return <ParticipantWorkspace session={session} onChange={setSession} onUpdate={updateSession} onCriticalChange={persistCritical} onRemoteCommit={acceptRemoteEnvelope} saveStatus={saveStatus} />;
}
