import { NextRequest, NextResponse } from "next/server";
import { findStudySessionByPublicId, updateStudySessionWithRevision } from "@/services/server/sessionRepository";
import { isResearcherRequestAuthorised } from "@/services/server/researcherRequestAuth";
import { isSessionPayload, MAX_SESSION_PAYLOAD_BYTES } from "@/services/server/sessionPayload";
import type { Json } from "@/types/database";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  if (!isResearcherRequestAuthorised(request)) return NextResponse.json({ error: "RESEARCHER_ACCESS_REQUIRED" }, { status: 401 });
  const { sessionId } = await context.params;
  const row = await findStudySessionByPublicId(sessionId);
  if (!row) return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ session: row.session_data, revision: row.revision, updatedAt: row.updated_at }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  if (!isResearcherRequestAuthorised(request)) return NextResponse.json({ error: "RESEARCHER_ACCESS_REQUIRED" }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_SESSION_PAYLOAD_BYTES) return NextResponse.json({ error: "SESSION_TOO_LARGE" }, { status: 413 });
  const { sessionId } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID_SESSION" }, { status: 400 }); }
  const value = body as { session?: unknown; expectedRevision?: unknown };
  if (!isSessionPayload(value.session) || !Number.isInteger(value.expectedRevision) || value.session.id !== sessionId) return NextResponse.json({ error: "INVALID_SESSION" }, { status: 400 });
  const current = await findStudySessionByPublicId(sessionId);
  if (!current) return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 });
  const result = await updateStudySessionWithRevision(current.id, Number(value.expectedRevision), {
    sessionData: value.session as unknown as Json,
    studyStatus: value.session.studyStatus ?? current.study_status,
    sessionStatus: value.session.status,
    completedAt: value.session.status === "submitted" ? value.session.postTaskQuestionnaires?.studyCompletedAt ?? value.session.submittedAt ?? null : current.completed_at,
  });
  if (result.status === "conflict") return NextResponse.json({ error: "REVISION_CONFLICT" }, { status: 409 });
  return NextResponse.json({ session: result.row.session_data, revision: result.row.revision, updatedAt: result.row.updated_at }, { headers: { "Cache-Control": "no-store" } });
}
