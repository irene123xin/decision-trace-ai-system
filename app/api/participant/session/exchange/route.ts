import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createParticipantSessionCookie, PARTICIPANT_SESSION_COOKIE, PARTICIPANT_SESSION_MAX_AGE_SECONDS, verifyParticipantAccessToken } from "@/services/server/participantAuth";
import { findStudySessionByPublicId } from "@/services/server/sessionRepository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 4_096) return NextResponse.json({ ok: false }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const value = body as { sessionId?: unknown; token?: unknown };
  if (typeof value.sessionId !== "string" || typeof value.token !== "string" || value.token.length > 256) return NextResponse.json({ ok: false }, { status: 401 });
  const row = await findStudySessionByPublicId(value.sessionId);
  if (!row || !verifyParticipantAccessToken(value.token, row.participant_access_token_hash)) return NextResponse.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const cookieStore = await cookies();
  cookieStore.set(PARTICIPANT_SESSION_COOKIE, createParticipantSessionCookie(row.public_session_id), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: PARTICIPANT_SESSION_MAX_AGE_SECONDS,
  });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
