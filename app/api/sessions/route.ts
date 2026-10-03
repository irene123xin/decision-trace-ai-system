import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/data/demoSession";
import {
  createParticipantAccessToken,
  createParticipantSessionCookie,
  hashParticipantAccessToken,
  PARTICIPANT_SESSION_COOKIE,
  PARTICIPANT_SESSION_MAX_AGE_SECONDS,
} from "@/services/server/participantAuth";
import { isResearcherRequestAuthorised } from "@/services/server/researcherRequestAuth";
import { createAssignedStudySession, findStudySessionByParticipantCode } from "@/services/server/sessionRepository";
import type { ManualAssignment, PublicSessionSetupData, StudyStatus } from "@/types";
import type { Json } from "@/types/database";
import { DEFAULT_TASK_DURATION_MINUTES } from "@/data/experiment";
import { getStudyPhase } from "@/services/server/environment";

export const runtime = "nodejs";

const creationAttempts = new Map<string, { count: number; resetAt: number }>();
const CREATION_WINDOW_MS = 60 * 60 * 1000;
const MAX_CREATIONS_PER_WINDOW = 20;

function requestKey(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

function consumeCreationAttempt(request: NextRequest): boolean {
  const key = requestKey(request);
  const now = Date.now();
  const existing = creationAttempts.get(key);
  const current = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + CREATION_WINDOW_MS };
  if (current.count >= MAX_CREATIONS_PER_WINDOW) return false;
  creationAttempts.set(key, { ...current, count: current.count + 1 });
  return true;
}

function setupFrom(value: unknown): PublicSessionSetupData | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (typeof input.participantId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(input.participantId.trim())) return null;
  const manualAssignment: ManualAssignment = input.manualAssignment === "A" || input.manualAssignment === "B" ? input.manualAssignment : "automatic";
  return { participantId: input.participantId.trim(), manualAssignment };
}

export async function POST(request: NextRequest) {
  if (!consumeCreationAttempt(request)) return NextResponse.json({ error: "SESSION_CREATION_RATE_LIMITED" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
  if (Number(request.headers.get("content-length") ?? 0) > 32_000) return NextResponse.json({ error: "INVALID_SESSION_SETUP" }, { status: 413 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID_SESSION_SETUP" }, { status: 400 }); }
  const setup = setupFrom(body);
  if (!setup) return NextResponse.json({ error: "INVALID_SESSION_SETUP" }, { status: 400 });
  if (await findStudySessionByParticipantCode(setup.participantId)) return NextResponse.json({ error: "PARTICIPANT_CODE_ALREADY_EXISTS" }, { status: 409 });

  const researcherAuthorised = isResearcherRequestAuthorised(request);
  const manualCondition = researcherAuthorised && (setup.manualAssignment === "A" || setup.manualAssignment === "B")
    ? setup.manualAssignment
    : undefined;
  const studyStatus: StudyStatus = getStudyPhase();
  const sessionDate = new Date().toISOString().slice(0, 10);
  const session = { ...createSession({
    participantId: setup.participantId,
    researcherId: "R01",
    condition: "A",
    sessionDate,
    taskDurationMinutes: DEFAULT_TASK_DURATION_MINUTES,
  }), studyStatus };
  try {
    // The schema retains a one-way access hash for compatibility, but normal
    // same-browser study entry never returns or uses the ephemeral raw value.
    const participantAccessTokenHash = hashParticipantAccessToken(createParticipantAccessToken());
    const participantCookie = createParticipantSessionCookie(session.id);
    const row = await createAssignedStudySession({
      publicSessionId: session.id,
      participantCode: session.participantId,
      participantAccessTokenHash,
      studyStatus: session.studyStatus ?? "development_test",
      sessionStatus: session.status,
      sessionData: session as unknown as Json,
      manualCondition,
    });
    const response = NextResponse.json(
      { destination: `/session/${encodeURIComponent(row.public_session_id)}` },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(PARTICIPANT_SESSION_COOKIE, participantCookie, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: PARTICIPANT_SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "SESSION_CREATION_FAILED" }, { status: 409 });
  }
}
