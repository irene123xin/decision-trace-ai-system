import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { PARTICIPANT_SESSION_COOKIE, verifyParticipantSessionCookie } from "@/services/server/participantAuth";
import { findStudySessionByPublicId, updateStudySessionWithRevision } from "@/services/server/sessionRepository";
import { isSessionPayload, MAX_SESSION_PAYLOAD_BYTES, mergeParticipantSession, participantSafeSession } from "@/services/server/sessionPayload";
import type { Json } from "@/types/database";
import type { Session } from "@/types";

export const runtime = "nodejs";

async function authorisedRow() {
  const cookieStore = await cookies();
  const publicId = verifyParticipantSessionCookie(cookieStore.get(PARTICIPANT_SESSION_COOKIE)?.value);
  return publicId ? findStudySessionByPublicId(publicId) : null;
}

export async function GET() {
  const row = await authorisedRow();
  if (!row) return NextResponse.json({ error: "PARTICIPANT_SESSION_UNAVAILABLE" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const stored = { ...(row.session_data as unknown as Session), condition: row.trace_enabled ? "B" as const : "A" as const };
  return NextResponse.json({ session: participantSafeSession(stored), revision: row.revision, updatedAt: row.updated_at }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_SESSION_PAYLOAD_BYTES) return NextResponse.json({ error: "SESSION_TOO_LARGE" }, { status: 413 });
  const row = await authorisedRow();
  if (!row) return NextResponse.json({ error: "PARTICIPANT_SESSION_UNAVAILABLE" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID_SESSION" }, { status: 400 }); }
  const value = body as { session?: unknown; expectedRevision?: unknown };
  if (!isSessionPayload(value.session) || !Number.isInteger(value.expectedRevision)) return NextResponse.json({ error: "INVALID_SESSION" }, { status: 400 });
  const current = { ...(row.session_data as unknown as Session), condition: row.trace_enabled ? "B" as const : "A" as const };
  if (value.session.id !== current.id || value.session.participantId !== current.participantId || value.session.condition !== (row.trace_enabled ? "B" : "A")) return NextResponse.json({ error: "INVALID_SESSION" }, { status: 400 });
  let merged: Session;
  try { merged = mergeParticipantSession(current, value.session); } catch { return NextResponse.json({ error: "INVALID_SESSION_TRANSITION" }, { status: 400 }); }
  const result = await updateStudySessionWithRevision(row.id, Number(value.expectedRevision), {
    sessionData: merged as unknown as Json,
    sessionStatus: merged.status,
    completedAt: merged.status === "submitted" ? merged.postTaskQuestionnaires?.studyCompletedAt ?? merged.submittedAt ?? null : row.completed_at,
  });
  if (result.status === "conflict") return NextResponse.json({ error: "REVISION_CONFLICT" }, { status: 409 });
  return NextResponse.json({ session: participantSafeSession(result.row.session_data as unknown as Session), revision: result.row.revision, updatedAt: result.row.updated_at }, { headers: { "Cache-Control": "no-store" } });
}
