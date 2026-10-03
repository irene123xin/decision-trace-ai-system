"use client";

import { useState, useSyncExternalStore } from "react";
import { ResearcherAccessModal } from "@/components/ResearcherAccessModal";
import { SessionSetup } from "@/components/SessionSetup";
import type { PublicSessionSetupData } from "@/types";

const subscribeToHydration = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

interface Props {
  initialAccessTarget?: string;
  researcherAuthenticated?: boolean;
  resumableParticipantSessionId?: string;
}

export function ResearcherSetupApp({ initialAccessTarget, researcherAuthenticated = false, resumableParticipantSessionId }: Props) {
  const hydrated = useSyncExternalStore(subscribeToHydration, getClientSnapshot, getServerSnapshot);
  const [accessTarget, setAccessTarget] = useState<string | null>(initialAccessTarget ?? null);
  const [creationError, setCreationError] = useState("");
  const [creating, setCreating] = useState(false);

  if (!hydrated) return <main className="loadingScreen">Loading researcher controls…</main>;

  const createCentralSession = async (setup: PublicSessionSetupData) => {
    if (creating) return;
    setCreating(true);
    setCreationError("");
    try {
      const response = await fetch("/api/sessions", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(setup) });
      if (!response.ok) { setCreationError("The remote participant session could not be created. Check that the participant code is unique."); return; }
      const result = await response.json() as { destination: string };
      window.location.assign(result.destination);
    } finally { setCreating(false); }
  };
  const accessGranted = () => {
    const target = accessTarget || "/researcher/records";
    setAccessTarget(null);
    window.location.assign(target);
  };
  const cancelAccess = () => {
    setAccessTarget(null);
    if (initialAccessTarget) window.history.replaceState({}, "", "/");
  };
  const openResearcherRecords = () => setAccessTarget("/researcher/records");
  const continueParticipantSession = () => {
    if (resumableParticipantSessionId) window.location.assign(`/session/${encodeURIComponent(resumableParticipantSessionId)}`);
  };
  const start = (setup: PublicSessionSetupData) => { void createCentralSession(setup); };
  return <>
    <SessionSetup
      onStart={start}
      onOpenResearcherRecords={openResearcherRecords}
      creationError={creationError}
      researcherAuthenticated={researcherAuthenticated}
      creating={creating}
      hasResumableParticipantSession={Boolean(resumableParticipantSessionId)}
      onContinueParticipantSession={continueParticipantSession}
    />
    {accessTarget !== null && <ResearcherAccessModal onCancel={cancelAccess} onSuccess={accessGranted} />}
  </>;
}
