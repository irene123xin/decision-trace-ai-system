import "server-only";

import type { NextRequest } from "next/server";
import { PARTICIPANT_SESSION_COOKIE, verifyParticipantSessionCookie } from "@/services/server/participantAuth";
import { findStudySessionByPublicId } from "@/services/server/sessionRepository";
import type { Session } from "@/types";
import type { StudySessionRow } from "@/types/database";

export interface AuthorisedParticipantModelSession {
  row: StudySessionRow;
  session: Session;
}

export async function authoriseParticipantModelRequest(request: NextRequest, claimedSessionId: string): Promise<AuthorisedParticipantModelSession | null> {
  const cookieSessionId = verifyParticipantSessionCookie(request.cookies.get(PARTICIPANT_SESSION_COOKIE)?.value);
  if (!cookieSessionId || cookieSessionId !== claimedSessionId) return null;
  const row = await findStudySessionByPublicId(cookieSessionId);
  if (!row || row.session_status !== "active") return null;
  return { row, session: { ...(row.session_data as unknown as Session), condition: row.trace_enabled ? "B" : "A" } };
}
