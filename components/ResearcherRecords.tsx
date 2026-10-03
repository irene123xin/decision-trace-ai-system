"use client";

import { useEffect, useMemo, useState } from "react";
import { ResearcherAIConfigPanel } from "@/components/ResearcherAIConfigPanel";
import { PilotCalibrationWorkspace } from "@/components/PilotCalibrationWorkspace";
import { useStoredSession } from "@/components/useStoredSession";
import { createDemoSession } from "@/data/demoSession";
import { getBoardProgress } from "@/services/boardUtils";
import { buildSessionJson, buildSessionSummaryCsv } from "@/services/exportService";
import { buildControlledStabilitySummary, evaluateControlledDevelopmentSession } from "@/services/researchDataAudit";
import { lockResearcherAccess } from "@/services/researcherAccessClient";
import { calibrationStorageAdapter } from "@/services/calibrationStorageAdapter";
import type { Session, StudyStatus } from "@/types";

interface RemoteRecord { session: Session; revision: number; updatedAt: string; }

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ResearcherRecords() {
  const { hydrated, sessions: localSessions, setSession: setLocalSession, clearSession } = useStoredSession();
  const [remoteRecords, setRemoteRecords] = useState<RemoteRecord[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StudyStatus | "all">("all");
  const [exclusionReasons, setExclusionReasons] = useState<Record<string, string>>({});
  const [statusNotice, setStatusNotice] = useState("");
  useEffect(() => {
    fetch("/api/researcher/sessions", { credentials: "same-origin", cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { sessions: RemoteRecord[] }) => setRemoteRecords(data.sessions))
      .catch(() => setStatusNotice("Remote records could not be loaded."));
  }, []);
  const remoteById = useMemo(() => new Map(remoteRecords.map((record) => [record.session.id, record])), [remoteRecords]);
  const sessions = useMemo(() => [...remoteRecords.map((record) => record.session), ...localSessions.filter((session) => !remoteById.has(session.id))], [localSessions, remoteById, remoteRecords]);
  const setSession = (next: Session) => {
    const remote = remoteById.get(next.id);
    if (!remote) { setLocalSession(next); return; }
    void fetch(`/api/researcher/sessions/${encodeURIComponent(next.id)}`, { method: "PUT", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session: next, expectedRevision: remote.revision }) })
      .then(async (response) => {
        if (!response.ok) throw new Error("save_failed");
        const saved = await response.json() as RemoteRecord;
        setRemoteRecords((current) => current.map((record) => record.session.id === next.id ? saved : record));
        setStatusNotice("");
      })
      .catch(() => setStatusNotice("The remote record changed or could not be saved. Reload before trying again."));
  };
  if (!hydrated) return <main className="loadingScreen">Loading researcher records…</main>;

  const returnToSetup = async () => {
    await lockResearcherAccess();
    window.location.assign("/");
  };
  const changeStudyStatus = (item: (typeof sessions)[number], studyStatus: StudyStatus) => {
    const frozen = calibrationStorageAdapter.load().freezeRecords.findLast((record) => record.status === "frozen");
    if (studyStatus === "formal" && !frozen) {
      setStatusNotice("A frozen classifier record is required before a session can be marked formal.");
      return;
    }
    setStatusNotice("");
    setSession({ ...item, studyStatus, statusChangedAt: new Date().toISOString(), statusChangedBy: "R01", exclusionReason: studyStatus === "excluded" ? exclusionReasons[item.id] || item.exclusionReason : undefined, activeFrozenClassifierVersion: studyStatus === "formal" ? frozen?.classifierPromptVersion : item.activeFrozenClassifierVersion });
  };
  const visibleSessions = sessions.filter((item) => statusFilter === "all" || (item.studyStatus ?? "development_test") === statusFilter);
  const developmentSessions = sessions.filter((item) => (item.studyStatus ?? "development_test") === "development_test").sort((left, right) => new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime());
  const developmentTestNumbers = new Map(developmentSessions.map((item, index) => [item.id, index + 1]));
  const stability = buildControlledStabilitySummary(sessions);

  return <main className="researchRecordsPage">
    <header className="recordsHeader">
      <div><p className="eyebrow">PRIVATE RESEARCHER AREA</p><h1>Researcher records</h1><p>Retained session data, review tools and reproducibility metadata.</p></div>
      <button type="button" onClick={() => void returnToSetup()}>Return to session setup</button>
    </header>

    <ResearcherAIConfigPanel />
    <PilotCalibrationWorkspace sessions={sessions} />
    <section className="attemptArchive recordsArchive" aria-label="Controlled development stability test">
      <header><div><p className="eyebrow">DEVELOPMENT ONLY</p><h2>{stability.label}</h2></div><span>{stability.controlledSessions} complete controlled sessions</span></header>
      <div className="attemptCounts">
        <span>{stability.totalClassificationRequests} classification requests</span>
        <span>{stability.successfulOnFirstAttempt} first-attempt successes</span>
        <span>{stability.successfulAfterRetry} retry successes</span>
        <span>{stability.finalFailures} final failures</span>
        <span>{stability.schemaFailures} schema failures</span>
        <span>{stability.providerFailures} provider failures</span>
        <span>{stability.timeouts} timeouts</span>
        <span>{stability.uncertainResults} uncertain units</span>
        <span>{stability.incorrectCategories} category mismatches</span>
        <span>{stability.missingUnits} missing units</span>
        <span>{stability.extraUnits} extra units</span>
        <span>Average {stability.averageDurationMs === null ? "—" : `${stability.averageDurationMs} ms`}</span>
        <span>Maximum {stability.maximumDurationMs === null ? "—" : `${stability.maximumDurationMs} ms`}</span>
        <span>Visible controlled cases {stability.participantVisibleAccuracy === null ? "—" : `${Math.round(stability.participantVisibleAccuracy * 100)}%`}</span>
      </div>
      <p className="emptyNote">This development diagnostic is not a scientific accuracy or general classifier-validity measure.</p>
    </section>
    {statusNotice && <p className="recordsStatusNotice" role="status">{statusNotice}</p>}

    {sessions.length === 0 ? <section className="recordsEmpty"><p className="eyebrow">RESEARCH DATA</p><h2>No records yet</h2><p>Participant attempts will appear here after they are created.</p></section> :
      <section className="attemptArchive recordsArchive"><header><div><p className="eyebrow">REMOTE AND LEGACY DATA</p><h2>Session and attempt summary</h2></div><label className="recordsFilter">Study status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StudyStatus | "all")}><option value="all">All</option><option value="development_test">Development test</option><option value="pilot">Pilot</option><option value="formal">Formal</option><option value="excluded">Excluded</option></select></label></header><div className="attemptList">{visibleSessions.map((item) => {
        const progress = getBoardProgress(item.board);
        const reviewed = item.decisions.filter((decision) => decision.reviewStatus !== "Unreviewed").length;
        const successfulImages = item.imageRequests.filter((request) => request.status === "succeeded").length || item.imageRequestCount;
        const failedImages = item.imageRequests.filter((request) => request.status === "failed").length;
        const usedImages = item.images.filter((image) => (image.usageTargets?.length ?? 0) > 0).length;
        const elapsed = item.completionTimeSeconds ?? (item.participantStartedAt && (item.endedAt || item.submittedAt) ? Math.max(0, Math.floor((new Date(item.endedAt ?? item.submittedAt!).getTime() - new Date(item.participantStartedAt).getTime()) / 1000)) : undefined);
        const controlledResult = evaluateControlledDevelopmentSession(item);
        const classifierVersion = item.traceClassifications?.findLast((record) => Boolean(record.classifierPromptVersion))?.classifierPromptVersion ?? "No classification yet";
        const conversationModel = item.aiTextRequests.findLast((request) => Boolean(request.modelId))?.modelId ?? item.messages.findLast((message) => message.role === "assistant" && Boolean(message.modelId))?.modelId ?? "No conversation response yet";
        return <article key={item.id}>
          <div className="attemptIdentity"><strong>{item.participantId} · Attempt {item.attemptNumber}</strong><span>{item.id}</span><small>{remoteById.has(item.id) ? `Remote · revision ${remoteById.get(item.id)!.revision} · updated ${new Date(remoteById.get(item.id)!.updatedAt).toLocaleString("en-GB")}` : "Local legacy"}</small><small>Condition {item.condition} · {item.status} · {item.taskDurationMinutes} min · {(item.studyStatus ?? "development_test").replaceAll("_", " ")}</small>{(item.studyStatus ?? "development_test") === "development_test" && <small>Development test {developmentTestNumbers.get(item.id)} · {new Date(item.startedAt).toLocaleString("en-GB")} · {classifierVersion} · {conversationModel} · controlled result {controlledResult.finalResult}</small>}</div>
          <div className="studyStatusControl"><label>Study status<select value={item.studyStatus ?? "development_test"} onChange={(event) => changeStudyStatus(item, event.target.value as StudyStatus)}><option value="development_test">Development test</option><option value="pilot">Pilot</option><option value="formal">Formal</option><option value="excluded">Excluded</option></select></label>{(item.studyStatus ?? "development_test") === "excluded" && <label>Exclusion reason<input value={exclusionReasons[item.id] ?? item.exclusionReason ?? ""} onChange={(event) => setExclusionReasons((current) => ({ ...current, [item.id]: event.target.value }))} onBlur={() => changeStudyStatus(item, "excluded")} /></label>}<small>{item.statusChangedAt ? `Changed ${new Date(item.statusChangedAt).toLocaleString("en-GB")} by ${item.statusChangedBy}` : "Historical/default status"}{item.activeFrozenClassifierVersion ? ` · frozen classifier ${item.activeFrozenClassifierVersion}` : ""}</small></div>
          <dl>
            <div><dt>Start</dt><dd>{item.participantStartedAt ? new Date(item.participantStartedAt).toLocaleString("en-GB") : "Not started"}</dd></div>
            <div><dt>Suggested time</dt><dd>{item.suggestedTimeReachedAt ? new Date(item.suggestedTimeReachedAt).toLocaleTimeString("en-GB") : "—"}</dd></div>
            <div><dt>Final review</dt><dd>{item.finalReviewOpenedAt ? new Date(item.finalReviewOpenedAt).toLocaleTimeString("en-GB") : "—"}</dd></div>
            <div><dt>Submitted</dt><dd>{item.submittedAt ? new Date(item.submittedAt).toLocaleTimeString("en-GB") : "—"}</dd></div>
            <div><dt>Elapsed</dt><dd>{elapsed === undefined ? "—" : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`}</dd></div>
            <div><dt>End reason</dt><dd>{item.endReason?.replaceAll("_", " ") ?? "—"}</dd></div>
            <div><dt>Brand brief</dt><dd>{item.brandBriefId ?? "Historical session"}</dd></div>
            <div><dt>Task guide</dt><dd>{item.taskGuideVersion ?? "Historical session"}</dd></div>
            <div><dt>Text prompt</dt><dd>{item.textPromptVersion ?? "Historical session"}</dd></div>
            <div><dt>Image prompt</dt><dd>{item.imagePromptVersion ?? "Historical session"}</dd></div>
            <div><dt>Assignment method</dt><dd>{item.assignmentMethod === "researcher_manual" ? "Researcher manual" : item.assignmentMethod === "balanced_random" ? "Balanced random" : "Historical session"}</dd></div>
            <div><dt>Assigned</dt><dd>{item.assignmentTimestamp ? new Date(item.assignmentTimestamp).toLocaleString("en-GB") : "—"}</dd></div>
            <div><dt>Allocation</dt><dd>{item.assignmentBlockId ? `${item.assignmentBlockId} · position ${item.assignmentPosition ?? "—"}` : item.assignmentMethod === "researcher_manual" ? "Manual override" : "—"}</dd></div>
          </dl>
          <div className="attemptCounts"><span>{item.messages.filter((message) => message.role === "participant").length} participant messages</span><span>{successfulImages} successful image requests</span><span>{failedImages} failed image requests</span><span>{item.images.length} images generated</span><span>{usedImages} images used</span><span>{item.boardEvents.length} board events</span><span>{item.decisions.length} decisions</span><span>{reviewed} reviewed · {item.decisions.length - reviewed} unreviewed</span><span>{progress.requiredComplete}/8 required</span><span>{progress.supportingComplete}/3 supporting</span><span>{item.finalSubmission ? "Submission snapshot saved" : "No final submission"}</span></div>
          <div className="attemptActions"><a href={`/researcher/session/${item.id}`}>Open researcher record</a><a href={`/researcher/session/${item.id}#final-board`}>View final board</a><button type="button" onClick={() => download(`${item.participantId}-attempt-${item.attemptNumber}.json`, buildSessionJson(item), "application/json")}>Export JSON</button><button type="button" onClick={() => download(`${item.participantId}-attempt-${item.attemptNumber}-summary.csv`, buildSessionSummaryCsv(item), "text/csv;charset=utf-8")}>Export CSV</button>{item.previousAttemptId && <a href={`/researcher/session/${item.previousAttemptId}`}>Open previous attempt</a>}</div>
        </article>;
      })}</div></section>}

    <details className="developmentTools recordsDevelopment" onToggle={(event) => { if (!(event.currentTarget as HTMLDetailsElement).open) setConfirmReset(false); }}>
      <summary>Development tools</summary>
      <div>
        <button type="button" className="textButton" onClick={() => setSession(createDemoSession())}>Load demo session</button>
        {!confirmReset ? <button type="button" className="textButton quiet" onClick={() => setConfirmReset(true)}>Clear local test records</button> : <div className="developmentReset recordsReset" role="group" aria-label="Confirm local test record deletion"><span>This permanently deletes all retained local test records and cannot be undone.</span><button type="button" onClick={() => setConfirmReset(false)}>Cancel</button><button type="button" onClick={() => { clearSession(); setConfirmReset(false); }}>Permanently delete</button></div>}
      </div>
    </details>
  </main>;
}
