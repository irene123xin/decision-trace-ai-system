import type { Session } from "@/types";
import type { ParticipantSessionDto } from "@/services/server/sessionPayload";

export type SaveStatus = "idle" | "saving" | "saved" | "retrying" | "conflict";
export interface RemoteSessionEnvelope { session: Session; revision: number; updatedAt: string; }
interface ParticipantRemoteEnvelope { session: ParticipantSessionDto; revision: number; updatedAt: string; }

const RECOVERY_KEY = "decision-trace-remote-recovery-v1";

function readRecovery(): Record<string, RemoteSessionEnvelope> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(window.localStorage.getItem(RECOVERY_KEY) ?? "{}") as Record<string, RemoteSessionEnvelope>; } catch { return {}; }
}

export function loadRemoteRecovery(sessionId: string): RemoteSessionEnvelope | null {
  return readRecovery()[sessionId] ?? null;
}

export function saveRemoteRecovery(value: RemoteSessionEnvelope): void {
  if (typeof window === "undefined") return;
  const records = readRecovery();
  records[value.session.id] = value;
  window.localStorage.setItem(RECOVERY_KEY, JSON.stringify(records));
}

export async function loadRemoteParticipantSession(): Promise<RemoteSessionEnvelope | null> {
  const response = await fetch("/api/participant/session", { credentials: "same-origin", cache: "no-store" });
  return response.ok ? hydrateParticipantEnvelope(await response.json() as ParticipantRemoteEnvelope) : null;
}

export function hydrateParticipantEnvelope(value: ParticipantRemoteEnvelope): RemoteSessionEnvelope {
  const { traceEnabled, decisions, ...session } = value.session;
  return {
    revision: value.revision,
    updatedAt: value.updatedAt,
    session: {
      ...session,
      condition: traceEnabled ? "B" : "A",
      decisions: decisions.map((decision) => {
        const label = { action: decision.action, source: decision.source, object: decision.object, summary: decision.summary };
        return { ...label, id: decision.id, timestampSeconds: decision.timestampSeconds, relatedTurn: decision.relatedTurn, evidenceText: decision.evidenceText, confidence: "High", modelGeneratedLabel: decision.summary, reviewStatus: "Confirmed", originalModelLabel: label, finalReviewedLabel: label, participantFacingLabel: decision.action === "Human-initiated" ? "New Direction" : decision.action, visibilityStatus: "participant_visible" };
      }),
    } as Session,
  };
}

export async function saveRemoteParticipantSession(session: Session, expectedRevision: number): Promise<RemoteSessionEnvelope | "conflict"> {
  const response = await fetch("/api/participant/session", {
    method: "PUT", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session, expectedRevision }),
  });
  if (response.status === 409) return "conflict";
  if (!response.ok) throw new Error("remote_save_failed");
  return hydrateParticipantEnvelope(await response.json() as ParticipantRemoteEnvelope);
}
