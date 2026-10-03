"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { loadRemoteParticipantSession, loadRemoteRecovery, saveRemoteParticipantSession, saveRemoteRecovery, type SaveStatus } from "@/services/remoteSessionClient";
import { storageAdapter } from "@/services/storageAdapter";
import type { Session } from "@/types";
import { coordinateParticipantTab } from "@/services/participantTabLock";

const subscribeToHydration = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function useParticipantSession(expectedId: string) {
  const hydrated = useSyncExternalStore(subscribeToHydration, getClientSnapshot, getServerSnapshot);
  const [session, setSessionState] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [tabLockReady, setTabLockReady] = useState(false);
  const [tabBlocked, setTabBlocked] = useState(false);
  const sessionRef = useRef<Session | null>(null);
  const remoteRef = useRef(false);
  const revisionRef = useRef(0);
  const updatedAtRef = useRef("");
  const queuedRef = useRef<Session | null>(null);
  const timerRef = useRef<number | null>(null);
  const savingRef = useRef<Promise<boolean> | null>(null);
  const conflictRef = useRef(false);

  useEffect(() => {
    if (!hydrated) return;
    const handle = coordinateParticipantTab(expectedId, (active) => {
      setTabBlocked(!active);
      setLoading(active && !sessionRef.current);
      setTabLockReady(true);
    });
    return handle.release;
  }, [expectedId, hydrated]);

  const acceptEnvelope = useCallback((envelope: { session: Session; revision: number; updatedAt: string }) => {
    remoteRef.current = true;
    revisionRef.current = envelope.revision;
    updatedAtRef.current = envelope.updatedAt;
    sessionRef.current = envelope.session;
    setSessionState(envelope.session);
    saveRemoteRecovery(envelope);
  }, []);

  useEffect(() => {
    if (!hydrated || !tabLockReady || tabBlocked) return;
    let cancelled = false;
    const load = async () => {
      try {
        const remote = await loadRemoteParticipantSession();
        if (cancelled) return;
        if (remote) {
          if (remote.session.id === expectedId) { acceptEnvelope(remote); setInvalid(false); return; }
          setInvalid(true);
          return;
        }
        const legacy = storageAdapter.load(expectedId);
        if (legacy) { sessionRef.current = legacy; setSessionState(legacy); setInvalid(false); return; }
        const recovery = loadRemoteRecovery(expectedId);
        if (recovery) { acceptEnvelope(recovery); setSaveStatus("retrying"); return; }
        setInvalid(true);
      } catch {
        const recovery = loadRemoteRecovery(expectedId);
        if (recovery && !cancelled) { acceptEnvelope(recovery); setSaveStatus("retrying"); }
        else if (!cancelled) setInvalid(true);
      } finally { if (!cancelled) setLoading(false); }
    };
    void load();
    return () => { cancelled = true; };
  }, [acceptEnvelope, expectedId, hydrated, tabBlocked, tabLockReady]);

  const flushRemote = useCallback(async (explicit?: Session): Promise<boolean> => {
    if (savingRef.current) await savingRef.current;
    const draft = explicit ?? queuedRef.current ?? sessionRef.current;
    if (!draft || !remoteRef.current) return true;
    if (conflictRef.current) return false;
    queuedRef.current = null;
    setSaveStatus("saving");
    const operation = (async () => {
      try {
        let result = await saveRemoteParticipantSession(draft, revisionRef.current);
        if (result === "conflict") {
          saveRemoteRecovery({ session: draft, revision: revisionRef.current, updatedAt: updatedAtRef.current || new Date().toISOString() });
          queuedRef.current = draft;
          conflictRef.current = true;
          setSaveStatus("conflict");
          return false;
        }
        const newerDraft = queuedRef.current;
        if (newerDraft) {
          revisionRef.current = result.revision;
          updatedAtRef.current = result.updatedAt;
          sessionRef.current = newerDraft;
          setSessionState(newerDraft);
          saveRemoteRecovery({ session: newerDraft, revision: result.revision, updatedAt: result.updatedAt });
          setSaveStatus("saving");
          window.setTimeout(() => window.dispatchEvent(new Event("decision-trace-remote-save")), 0);
        } else {
          acceptEnvelope(result);
          setSaveStatus("saved");
        }
        return true;
      } catch {
        saveRemoteRecovery({ session: draft, revision: revisionRef.current, updatedAt: updatedAtRef.current || new Date().toISOString() });
        queuedRef.current = draft;
        setSaveStatus("retrying");
        return false;
      } finally { savingRef.current = null; }
    })();
    savingRef.current = operation;
    return operation;
  }, [acceptEnvelope]);

  const scheduleRemote = useCallback((next: Session) => {
    if (conflictRef.current) { saveRemoteRecovery({ session: next, revision: revisionRef.current, updatedAt: updatedAtRef.current || new Date().toISOString() }); return; }
    queuedRef.current = next;
    saveRemoteRecovery({ session: next, revision: revisionRef.current, updatedAt: updatedAtRef.current || new Date().toISOString() });
    setSaveStatus("saving");
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { if (!savingRef.current) void flushRemote(); }, 650);
  }, [flushRemote]);

  useEffect(() => {
    const retry = () => { if (remoteRef.current && queuedRef.current && !savingRef.current) void flushRemote(); };
    window.addEventListener("online", retry);
    window.addEventListener("decision-trace-remote-save", retry);
    return () => { window.removeEventListener("online", retry); window.removeEventListener("decision-trace-remote-save", retry); };
  }, [flushRemote]);

  const setSession = (next: Session) => {
    sessionRef.current = next;
    setSessionState(next);
    if (remoteRef.current) scheduleRemote(next); else storageAdapter.save(next);
  };
  const updateSession = (updater: (current: Session) => Session): Session | null => {
    if (!sessionRef.current) return null;
    const next = updater(sessionRef.current);
    setSession(next);
    return next;
  };
  const persistCritical = async (next: Session): Promise<boolean> => {
    if (!remoteRef.current) { setSession(next); return true; }
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    const saved = await flushRemote(next);
    if (saved) { sessionRef.current = next; setSessionState(next); }
    return saved;
  };

  return { hydrated, loading, invalid, tabBlocked, session, setSession, updateSession, persistCritical, acceptRemoteEnvelope: acceptEnvelope, saveStatus };
}
