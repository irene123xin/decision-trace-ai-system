"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { storageAdapter } from "@/services/storageAdapter";
import type { Session } from "@/types";

const subscribeToHydration = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function useStoredSession(expectedId?: string) {
  const [session, setSessionState] = useState<Session | null>(() => storageAdapter.load(expectedId));
  const sessionRef = useRef<Session | null>(session);
  const [sessions, setSessions] = useState<Session[]>(() => storageAdapter.loadAll());
  const hydrated = useSyncExternalStore(subscribeToHydration, getClientSnapshot, getServerSnapshot);

  const refresh = () => {
    const loaded = storageAdapter.load(expectedId);
    sessionRef.current = loaded;
    setSessionState(loaded);
    setSessions(storageAdapter.loadAll());
  };

  useEffect(() => {
    const sync = () => refresh();
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  });

  const setSession = (next: Session) => {
    sessionRef.current = next;
    storageAdapter.save(next, !expectedId);
    setSessionState(next);
    setSessions(storageAdapter.loadAll());
  };

  const updateSession = (updater: (current: Session) => Session): Session | null => {
    const current = sessionRef.current ?? storageAdapter.load(expectedId);
    if (!current) return null;
    const next = updater(current);
    sessionRef.current = next;
    storageAdapter.save(next, !expectedId);
    setSessionState(next);
    setSessions(storageAdapter.loadAll());
    return next;
  };

  return {
    hydrated,
    session,
    sessions,
    setSession,
    updateSession,
    refresh,
    clearSession: () => { storageAdapter.clear(); setSessionState(null); setSessions([]); },
  };
}
