import { NextRequest, NextResponse } from "next/server";
import { findGeneratedImageForSession } from "@/services/server/imageRepository";
import { downloadPrivateGeneratedImage } from "@/services/server/remoteImageStorage";
import { PARTICIPANT_SESSION_COOKIE, verifyParticipantSessionCookie } from "@/services/server/participantAuth";
import { isResearcherRequestAuthorised } from "@/services/server/researcherRequestAuth";
import { findStudySessionByPublicId } from "@/services/server/sessionRepository";

export const runtime = "nodejs";

const SESSION_ID_PATTERN = /^SESSION-[A-Za-z0-9-]{8,100}$/;
const IMAGE_ID_PATTERN = /^IMG\d{2,10}$/;

export async function GET(request: NextRequest, context: { params: Promise<{ sessionId: string; imageId: string }> }) {
  const { sessionId, imageId } = await context.params;
  if (!SESSION_ID_PATTERN.test(sessionId) || !IMAGE_ID_PATTERN.test(imageId)) return new NextResponse(null, { status: 404 });
  const participantSessionId = verifyParticipantSessionCookie(request.cookies.get(PARTICIPANT_SESSION_COOKIE)?.value);
  const researcherAuthorised = isResearcherRequestAuthorised(request);
  if (participantSessionId !== sessionId && !researcherAuthorised) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });

  const session = await findStudySessionByPublicId(sessionId);
  if (!session) return new NextResponse(null, { status: 404 });
  const image = await findGeneratedImageForSession(session.id, imageId);
  if (!image || !image.storage_path.startsWith(`${session.id}/`) || image.storage_path.includes("..")) return new NextResponse(null, { status: 404 });

  try {
    const blob = await downloadPrivateGeneratedImage(image.storage_path);
    return new NextResponse(await blob.arrayBuffer(), {
      headers: {
        "Content-Type": image.mime_type,
        "Content-Length": String(image.byte_size),
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
