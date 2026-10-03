"use client";

import { useParams } from "next/navigation";
import { ResearcherView } from "@/components/ResearcherView";
import { ResearcherSessionControls } from "@/components/ResearcherSessionControls";
import { useResearcherSession } from "@/components/useResearcherSession";

export default function ResearcherSessionPage() {
  const params = useParams<{ sessionId: string }>();
  const { hydrated, session, sessions, setSession, source, revision, updatedAt } = useResearcherSession(params.sessionId);
  if (!hydrated) return <main className="loadingScreen">Loading session record…</main>;
  if (!session) return <main className="sessionUnavailable"><p className="eyebrow">RESEARCHER VIEW</p><h1>Session record not found.</h1><a href="/researcher/records">Return to researcher records</a></main>;
  return <div className="researcherShell"><header className="researcherRouteHeader"><a href="/researcher/records">← Records</a><div><span>PRIVATE RESEARCHER VIEW</span><strong>{session.participantId} · Attempt {session.attemptNumber} · Condition {session.condition}</strong><small>{source === "remote" ? `Remote · revision ${revision} · updated ${updatedAt ? new Date(updatedAt).toLocaleString("en-GB") : "—"}` : "Local legacy"}</small></div><span>{session.status.toUpperCase()}</span></header><ResearcherSessionControls session={session} onChange={setSession} /><ResearcherView session={session} sessions={sessions} onChange={setSession} /></div>;
}
