"use client";

import { useEffect, useMemo, useState } from "react";
import { storageAdapter } from "@/services/storageAdapter";
import type { Session } from "@/types";

interface RemoteRecord { session: Session; revision: number; updatedAt: string; }

export function useResearcherSession(sessionId: string) {
  const [remote, setRemote] = useState<RemoteRecord | null>(null);
  const [remoteList, setRemoteList] = useState<RemoteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const local = storageAdapter.load(sessionId);
  const localSessions = storageAdapter.loadAll();
  useEffect(() => {
    Promise.all([
      fetch(`/api/researcher/sessions/${encodeURIComponent(sessionId)}`, { credentials: "same-origin", cache: "no-store" }),
      fetch("/api/researcher/sessions", { credentials: "same-origin", cache: "no-store" }),
    ]).then(async ([recordResponse, listResponse]) => {
      if (recordResponse.ok) setRemote(await recordResponse.json() as RemoteRecord);
      if (listResponse.ok) setRemoteList((await listResponse.json() as { sessions: RemoteRecord[] }).sessions);
    }).finally(() => setLoading(false));
  }, [sessionId]);
  const session = remote?.session ?? local;
  const sessions = useMemo(() => [...remoteList.map((item) => item.session), ...localSessions.filter((item) => !remoteList.some((remoteItem) => remoteItem.session.id === item.id))], [localSessions, remoteList]);
  const setSession = (next: Session) => {
    if (!remote) { storageAdapter.save(next, false); return; }
    void fetch(`/api/researcher/sessions/${encodeURIComponent(sessionId)}`, { method: "PUT", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session: next, expectedRevision: remote.revision }) })
      .then(async (response) => { if (response.ok) setRemote(await response.json() as RemoteRecord); });
  };
  return { hydrated: !loading, session, sessions, setSession, source: remote ? "remote" as const : "local_legacy" as const, revision: remote?.revision, updatedAt: remote?.updatedAt };
}
