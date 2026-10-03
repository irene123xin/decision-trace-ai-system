import type { Session } from "@/types";
import { normaliseBoard } from "@/data/demoSession";
import { clearGeneratedImageBlobs } from "@/services/imageStorageAdapter";
import { normalisePreAiStartingPoint } from "@/services/preAiStartingPoint";
import { normalisePostTaskQuestionnaires } from "@/services/postTaskQuestionnaires";

const STORE_KEY = "decision-trace-session-store-v2";
const LEGACY_SESSION_KEY = "decision-trace-session-v1";

interface LocalSessionStore {
  version: 2;
  activeSessionId?: string;
  sessions: Session[];
}

export type OperationalSessionSummary = Pick<Session, "id" | "participantId" | "status" | "condition"> & { storageSource?: "remote" | "local_legacy" };

function normaliseSession(session: Session): Session {
  return {
    ...session,
    status: session.status ?? "active",
    attemptNumber: session.attemptNumber ?? 1,
    studyStatus: session.studyStatus ?? "development_test",
    humanCoding: session.humanCoding ?? [],
    preAiStartingPoint: session.preAiStartingPoint ? normalisePreAiStartingPoint(session.preAiStartingPoint) : undefined,
    postTaskQuestionnaires: session.postTaskQuestionnaires ? normalisePostTaskQuestionnaires(session.postTaskQuestionnaires, session.condition) : undefined,
    board: normaliseBoard(session.board),
    messages: session.messages ?? [],
    decisions: (session.decisions ?? []).map((decision) => ({
      ...decision,
      relatedTurn: decision.relatedTurn ?? null,
      linkedAiMessageIds: decision.linkedAiMessageIds ?? [],
      linkedAiPropositionIds: decision.linkedAiPropositionIds ?? [],
    })),
    aiPropositions: session.aiPropositions ?? [],
    traceClassifications: session.traceClassifications ?? [],
    boardEvents: session.boardEvents ?? [],
    researchEvents: session.researchEvents ?? [],
    aiTextRequests: session.aiTextRequests ?? [],
    imageRequests: session.imageRequests ?? [],
    imageRequestCount: session.imageRequests?.filter((request) => request.status === "succeeded").length ?? session.imageRequestCount ?? 0,
    images: (session.images ?? []).map((image) => ({ ...image, usageTargets: image.usageTargets ?? [], usageEvents: image.usageEvents ?? [] })),
  };
}

function readStore(): LocalSessionStore {
  if (typeof window === "undefined") return { version: 2, sessions: [] };
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalSessionStore;
      return { version: 2, activeSessionId: parsed.activeSessionId, sessions: (parsed.sessions ?? []).map(normaliseSession) };
    }
    const legacy = window.localStorage.getItem(LEGACY_SESSION_KEY);
    if (legacy) {
      const session = normaliseSession(JSON.parse(legacy) as Session);
      const migrated = { version: 2 as const, activeSessionId: session.id, sessions: [session] };
      window.localStorage.setItem(STORE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch {
  // Ignore malformed local records, so researcher setup can continue
  }
  return { version: 2, sessions: [] };
}

function writeStore(store: LocalSessionStore): void {
  if (typeof window !== "undefined") window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

export const storageAdapter = {
  loadActiveSummary(): OperationalSessionSummary | null {
    const store = readStore();
    const active = store.activeSessionId ? store.sessions.find((session) => session.id === store.activeSessionId) : undefined;
    return active ? { id: active.id, participantId: active.participantId, status: active.status, condition: active.condition, storageSource: "local_legacy" } : null;
  },
  load(sessionId?: string): Session | null {
    const store = readStore();
    const id = sessionId ?? store.activeSessionId;
    return id ? store.sessions.find((session) => session.id === id) ?? null : null;
  },
  loadAll(): Session[] {
    return readStore().sessions.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  },
  save(session: Session, makeActive = true): void {
    const store = readStore();
    const sessions = store.sessions.some((item) => item.id === session.id)
      ? store.sessions.map((item) => item.id === session.id ? normaliseSession(session) : item)
      : [normaliseSession(session), ...store.sessions];
    writeStore({ version: 2, activeSessionId: makeActive ? session.id : store.activeSessionId, sessions });
  },
  saveAttempts(previousAttempt: Session, nextAttempt: Session): void {
    const store = readStore();
    const retained = store.sessions.filter((item) => item.id !== previousAttempt.id && item.id !== nextAttempt.id);
    writeStore({ version: 2, activeSessionId: nextAttempt.id, sessions: [normaliseSession(nextAttempt), normaliseSession(previousAttempt), ...retained] });
  },
  setActive(sessionId: string): void {
    const store = readStore();
    if (store.sessions.some((session) => session.id === sessionId)) writeStore({ ...store, activeSessionId: sessionId });
  },
  clear(): void {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORE_KEY);
      window.localStorage.removeItem(LEGACY_SESSION_KEY);
      void clearGeneratedImageBlobs();
    }
  },
};
