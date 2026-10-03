"use client";

import { useState } from "react";
import type { ManualAssignment, PublicSessionSetupData } from "@/types";

interface Props {
  onStart: (data: PublicSessionSetupData) => void;
  onOpenResearcherRecords?: () => void;
  creationError?: string;
  researcherAuthenticated?: boolean;
  creating?: boolean;
  hasResumableParticipantSession?: boolean;
  onContinueParticipantSession?: () => void;
}

export function SessionSetup({ onStart, onOpenResearcherRecords, creationError, researcherAuthenticated = false, creating = false, hasResumableParticipantSession = false, onContinueParticipantSession }: Props) {
  const [participantId, setParticipantId] = useState("P01");
  const [manualAssignment, setManualAssignment] = useState<ManualAssignment>("automatic");

  return (
    <main className="researchSetupPage homeMinimal">
      <section className="researchSetupIntro">
        <div className="homeIdentity homeEnter homeEnterTitle">
          <p className="eyebrow">CREATIVE DESIGN STUDY</p>
          <h1>Elsewhere</h1>
          <p className="homeSessionType">Participant session</p>
          <p className="lead">Begin an anonymous AI-assisted creative session.</p>
        </div>
        <div className="researchProtocol homeEnter homeEnterNote">
          <span>Before you begin</span>
          <p>Please complete this study on a desktop or laptop browser. Minimum recommended width: 1024px.</p>
        </div>
      </section>

      <section className="researchSetupControls homeSetupSurface homeEnter homeEnterForm">
        <header className="privateHeader"><span>Participant session</span><div><strong>Session setup</strong><button type="button" onClick={onOpenResearcherRecords}>Researcher records</button></div></header>
        <p className="viewportWarning">This screen is narrower than the recommended 1024px. You may continue, but use a desktop or laptop for the study where possible.</p>
        {creationError && <p className="recordsStatusNotice" role="status">{creationError}</p>}
        {hasResumableParticipantSession ? <section className="homeSetupForm participantRecovery" aria-labelledby="continue-session-title">
          <div className="sectionHeading"><p className="eyebrow">SESSION IN PROGRESS</p><h2 id="continue-session-title">Your current session is saved</h2><p>Continue with the same participant session and return to your saved work.</p></div>
          <button className="primaryButton substantial" type="button" onClick={onContinueParticipantSession}><span><small>RETURN TO SAVED WORK</small>Continue current session</span><span aria-hidden>→</span></button>
        </section> : <form className="homeSetupForm" id="new-session" onSubmit={(event) => { event.preventDefault(); if (!creating) onStart({ participantId, manualAssignment: researcherAuthenticated ? manualAssignment : "automatic" }); }}>
          <div className="sectionHeading"><p className="eyebrow">NEW SESSION</p><h2>Configure study session</h2><p>Use anonymous study identifiers only. Do not enter names or email addresses.</p></div>
          <div className="researchFormGrid">
            <label className="spanTwo">Anonymous Participant ID<input required value={participantId} onChange={(e) => setParticipantId(e.target.value)} placeholder="P01" /></label>
            <div className="spanTwo interfaceVersionField"><span>INTERFACE VERSION</span><strong>Assigned automatically</strong><small>The interface version will be assigned when the session begins.</small></div>
            {researcherAuthenticated && <fieldset className="spanTwo manualAssignmentControl"><legend>Manual assignment</legend><div role="group" aria-label="Manual assignment">
              {(["automatic", "A", "B"] as const).map((value) => <label key={value}><input type="radio" name="manualAssignment" checked={manualAssignment === value} onChange={() => setManualAssignment(value)} /><span>{value === "automatic" ? "Automatic" : value}</span></label>)}
            </div></fieldset>}
          </div>
          <button className="primaryButton substantial" type="submit" disabled={creating}><span><small>{creating ? "CREATING PARTICIPANT SESSION" : "CREATE PARTICIPANT SESSION"}</small>{creating ? "Starting…" : "Start session"}</span><span aria-hidden>→</span></button>
        </form>}
      </section>
    </main>
  );
}
