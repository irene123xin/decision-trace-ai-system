import type { GeneratedImage, ImageDiagnosticCode, ImageErrorCode, Session } from "@/types";
import { hydrateParticipantEnvelope } from "@/services/remoteSessionClient";
import type { ParticipantSessionDto } from "@/services/server/sessionPayload";

export interface ImageAPIResult {
  requestId: string;
  images: GeneratedImage[];
  remoteSession: { session: Session; revision: number; updatedAt: string };
}

interface ParticipantImageAPIResult extends Omit<ImageAPIResult, "remoteSession"> {
  remoteSession: { session: ParticipantSessionDto; revision: number; updatedAt: string };
}

export class ImageRequestError extends Error {
  constructor(public readonly code: ImageErrorCode, public readonly diagnosticCode?: ImageDiagnosticCode) {
    super("Image request failed");
    this.name = "ImageRequestError";
  }
}

export async function requestGeneratedImages(payload: {
  requestId: string;
  sessionId: string;
  promptText: string;
}): Promise<ImageAPIResult> {
  let response: Response;
  try {
    response = await fetch("/api/images/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new ImageRequestError("IMAGE_PROVIDER_ERROR");
  }
  const body = await response.json().catch(() => null) as (ParticipantImageAPIResult & { error?: ImageErrorCode; diagnosticCode?: ImageDiagnosticCode }) | null;
  if (!response.ok || !body || body.images?.length !== 2) throw new ImageRequestError(body?.error ?? "IMAGE_PROVIDER_ERROR", body?.diagnosticCode);
  return { ...body, remoteSession: hydrateParticipantEnvelope(body.remoteSession) };
}
