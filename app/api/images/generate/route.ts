import { NextRequest, NextResponse } from "next/server";
import { requestImageGeneration, SafeImageGenerationError } from "@/services/server/geminiImageService";
import {
  deleteGeneratedImageRecords,
  listGeneratedImagesForRequest,
  listGeneratedImagesForSession,
} from "@/services/server/imageRepository";
import { commitRemoteImagePair, RemoteImageCommitError, resumeRemoteImageCommit } from "@/services/server/remoteImageCommit";
import { removePrivateGeneratedImages } from "@/services/server/remoteImageStorage";
import { PARTICIPANT_SESSION_COOKIE, verifyParticipantSessionCookie } from "@/services/server/participantAuth";
import { findStudySessionByPublicId } from "@/services/server/sessionRepository";
import { participantSafeSession } from "@/services/server/sessionPayload";
import type { StudySessionRow } from "@/types/database";
import type { Session } from "@/types";

export const runtime = "nodejs";

const MAX_PROMPT_CHARACTERS = 1_000;
const MAX_REQUEST_BYTES = 20_000;
const REQUEST_LIMIT = 5;
const IMAGE_LIMIT = 10;

interface ValidPayload {
  requestId: string;
  sessionId: string;
  promptText: string;
}

function validatePayload(value: unknown): ValidPayload | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const promptText = typeof item.promptText === "string" ? item.promptText.trim() : "";
  if (typeof item.requestId !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(item.requestId)) return null;
  if (typeof item.sessionId !== "string" || !/^SESSION-[A-Za-z0-9-]{8,100}$/.test(item.sessionId)) return null;
  if (!promptText || promptText.length > MAX_PROMPT_CHARACTERS) return null;
  return { requestId: item.requestId, sessionId: item.sessionId, promptText };
}

function remoteResponse(row: StudySessionRow, requestId: string) {
  const session = row.session_data as unknown as Session;
  const safeSession = participantSafeSession(session);
  const images = safeSession.images.filter((image) => image.requestId === requestId && image.storageBackend === "supabase");
  return NextResponse.json({
    requestId,
    images,
    remoteSession: {
      session: safeSession,
      revision: row.revision,
      updatedAt: row.updated_at,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}

async function cleanupPartialRequest(rows: Awaited<ReturnType<typeof listGeneratedImagesForRequest>>): Promise<void> {
  await Promise.allSettled([
    removePrivateGeneratedImages(rows.map((row) => row.storage_path)),
    deleteGeneratedImageRecords(rows.map((row) => row.id)),
  ]);
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 413 });
  let value: unknown;
  try { value = await request.json(); } catch { return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 }); }
  if (JSON.stringify(value).length > MAX_REQUEST_BYTES) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 413 });
  const payload = validatePayload(value);
  if (!payload) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

  const cookieSessionId = verifyParticipantSessionCookie(request.cookies.get(PARTICIPANT_SESSION_COOKIE)?.value);
  if (!cookieSessionId || cookieSessionId !== payload.sessionId) return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const row = await findStudySessionByPublicId(cookieSessionId);
  if (!row) return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (row.session_status !== "active") return NextResponse.json({ error: "SESSION_NOT_ACTIVE" }, { status: 409, headers: { "Cache-Control": "no-store" } });

  const storedSession = row.session_data as unknown as Session;
  const requestRows = await listGeneratedImagesForRequest(row.id, payload.requestId);
  if (requestRows.length === 2) {
    const storedRequest = storedSession.imageRequests.find((item) => item.requestId === payload.requestId);
    const storedImages = storedSession.images.filter((image) => image.requestId === payload.requestId && image.storageBackend === "supabase");
    if (storedRequest?.status === "succeeded" && storedImages.length === 2) return remoteResponse(row, payload.requestId);
    const resumed = await resumeRemoteImageCommit(row, payload.requestId, requestRows);
    if (resumed) return remoteResponse(resumed, payload.requestId);
    await cleanupPartialRequest(requestRows);
  } else if (requestRows.length > 0) {
    await cleanupPartialRequest(requestRows);
  }

  const session = row.session_data as unknown as Session;
  if (!session.imageRequests.some((item) => item.requestId === payload.requestId && item.status === "pending")) {
    return NextResponse.json({ requestId: payload.requestId, error: "INVALID_REQUEST" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  const centralImages = await listGeneratedImagesForSession(row.id);
  const centralRequestCount = new Set(centralImages.map((image) => image.request_id)).size;
  const sessionRequestCount = session.imageRequests.filter((item) => item.status === "succeeded").length;
  if (Math.max(centralRequestCount, sessionRequestCount) >= REQUEST_LIMIT || Math.max(centralImages.length, session.images.length) + 2 > IMAGE_LIMIT) {
    return NextResponse.json({ requestId: payload.requestId, error: "IMAGE_LIMIT_REACHED" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const result = await requestImageGeneration(payload.requestId, payload.promptText);
    const committed = await commitRemoteImagePair(row, payload.requestId, payload.promptText, result);
    return remoteResponse(committed, payload.requestId);
  } catch (error) {
    if (error instanceof RemoteImageCommitError) {
      return NextResponse.json({ requestId: payload.requestId, error: error.code, diagnosticCode: "REMOTE_IMAGE_STORAGE_ERROR" }, { status: error.code === "IMAGE_LIMIT_REACHED" ? 409 : 502, headers: { "Cache-Control": "no-store" } });
    }
    const code = error instanceof SafeImageGenerationError ? error.code : "IMAGE_PROVIDER_ERROR";
    const diagnosticCode = error instanceof SafeImageGenerationError ? error.diagnosticCode : "PROVIDER_SDK_ERROR";
    const status = diagnosticCode === "PROVIDER_TIMEOUT" ? 504 : 502;
    return NextResponse.json({ requestId: payload.requestId, error: code, diagnosticCode }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
