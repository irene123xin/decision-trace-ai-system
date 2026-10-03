"use client";

import { useState } from "react";
import { restartSession } from "@/data/demoSession";
import { storageAdapter } from "@/services/storageAdapter";
import type { ResearchEvent, Session } from "@/types";

export function ResearcherSessionControls({ session, onChange }: { session: Session; onChange: (session: Session) => void }) {
  const [dialog, setDialog] = useState<"restart" | "end" | null>(null);
  const event = (base: Session, type: "researcher_restart" | "researcher_end_session", summary: string): ResearchEvent => ({ id: `RE${String(base.researchEvents.length + 1).padStart(2, "0")}`, type, summary, actor: "researcher", createdAt: new Date().toISOString(), timestampSeconds: base.participantStartedAt ? Math.max(0, Math.floor((Date.now() - new Date(base.participantStartedAt).getTime()) / 1000)) : 0 });
  const end = () => { const endedAt = new Date().toISOString(); const researchEvent = event(session, "researcher_end_session", "Researcher ended the session."); onChange({ ...session, status: "ended", endedAt, endReason: "researcher_end", participantExitedAt: undefined, researchEvents: [...session.researchEvents, researchEvent] }); setDialog(null); };
  const restart = () => { const { previousAttempt, nextAttempt } = restartSession(session); storageAdapter.saveAttempts(previousAttempt, nextAttempt); setDialog(null); window.location.assign(`/researcher/session/${nextAttempt.id}`); };
  const openWorkspace = () => { onChange({ ...session, participantExitedAt: undefined }); window.open(`/session/${session.id}`, "_blank", "noopener,noreferrer"); };
  return <>
    <nav className="researcherControls" aria-label="Researcher session controls"><a href="/researcher/records">Return to records</a><a href={`/session/${session.id}`} target="_blank">Open participant entry</a><button disabled={session.status !== "active"} onClick={openWorkspace}>Open participant workspace</button><button disabled={session.status === "ended" || session.status === "submitted"} onClick={() => setDialog("end")}>End session</button><button className="restartControl" onClick={() => setDialog("restart")}>Restart session</button><a href="/researcher/setup">Create new session</a></nav>
    {dialog && <div className="modalBackdrop"><section className="confirmDialog researcherConfirm" role="alertdialog" aria-modal="true"><p className="eyebrow">RESEARCHER CONTROL</p><h2>{dialog === "restart" ? "Create a new attempt?" : "End this session?"}</h2><p>{dialog === "restart" ? "This attempt will be retained in full and marked as ended by researcher restart. A linked attempt will open with the same participant, condition and duration." : "The participant workspace will close and remain saved as an ended session."}</p><div><button onClick={() => setDialog(null)}>Cancel</button><button className="primaryButton" onClick={dialog === "restart" ? restart : end}>{dialog === "restart" ? "Retain and restart" : "End session"}</button></div></section></div>}
  </>;
}
