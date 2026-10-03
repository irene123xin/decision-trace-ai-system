import "server-only";

import {
  createGeneratedImageRecords,
  deleteGeneratedImageRecords,
  listGeneratedImagesForSession,
  type CreateGeneratedImageRecordInput,
} from "@/services/server/imageRepository";
import {
  buildGeneratedImageStoragePath,
  decodeGeneratedImage,
  removePrivateGeneratedImages,
  uploadPrivateGeneratedImage,
} from "@/services/server/remoteImageStorage";
import { findStudySessionById, updateStudySessionWithRevision } from "@/services/server/sessionRepository";
import type { ImageServiceResult } from "@/services/server/geminiImageService";
import type { GeneratedImageRow, Json, StudySessionRow } from "@/types/database";
import type { GeneratedImage, ImageErrorCode, ImageRequestRecord, Message, ResearchEvent, Session } from "@/types";

export class RemoteImageCommitError extends Error {
  constructor(
    public readonly stage: "validation" | "upload" | "record_insert" | "session_update",
    public readonly code: ImageErrorCode = "IMAGE_STORAGE_ERROR",
  ) {
    super("Remote image commit failed");
    this.name = "RemoteImageCommitError";
  }
}

interface PairMetadata {
  images: [GeneratedImage, GeneratedImage];
  effectivePrompt: string;
  provider: string;
  model: string;
  promptVersion: string;
  completedAt: string;
  latencyMs: number;
}

function nextStableImageIds(session: Session): [string, string] {
  const numericIds = session.images.map((image) => Number(image.id.replace(/\D/g, ""))).filter(Number.isFinite);
  const firstNumber = Math.max(0, ...numericIds) + 1;
  return [
    `IMG${String(firstNumber).padStart(2, "0")}`,
    `IMG${String(firstNumber + 1).padStart(2, "0")}`,
  ];
}

function nextMessageId(messages: Message[]): string {
  const numericIds = messages.map((message) => Number(message.id.replace(/\D/g, ""))).filter(Number.isFinite);
  return `M${String(Math.max(0, ...numericIds) + 1).padStart(2, "0")}`;
}

function nextResearchEventId(events: ResearchEvent[]): string {
  const numericIds = events.map((event) => Number(event.id.replace(/\D/g, ""))).filter(Number.isFinite);
  return `RE${String(Math.max(0, ...numericIds) + 1).padStart(2, "0")}`;
}

function applyPairToSession(session: Session, requestId: string, pair: PairMetadata): Session {
  const alreadyComplete = pair.images.every((image) => session.images.some((existing) => existing.id === image.id && existing.requestId === requestId));
  const storedRequest = session.imageRequests.find((request) => request.requestId === requestId);
  if (alreadyComplete && storedRequest?.status === "succeeded") return session;

  const relatedTurn = storedRequest?.relatedTurn ?? pair.images[0].relatedTurn;
  const completedRequest: ImageRequestRecord = {
    ...(storedRequest ?? {
      requestId,
      sessionId: session.id,
      participantId: session.participantId,
      createdAt: pair.completedAt,
      promptText: pair.images[0].prompt,
      promptVersion: pair.promptVersion,
      requestedImageCount: 2,
      returnedImageCount: 0,
      status: "pending" as const,
      imageIds: [],
    }),
    completedAt: pair.completedAt,
    effectivePrompt: pair.effectivePrompt,
    provider: pair.provider,
    model: pair.model,
    promptVersion: pair.promptVersion,
    returnedImageCount: 2,
    status: "succeeded",
    imageIds: pair.images.map((image) => image.id),
    latencyMs: pair.latencyMs,
    errorCode: undefined,
    diagnosticCode: undefined,
    safeErrorMessage: undefined,
  };
  const imageRequests = storedRequest
    ? session.imageRequests.map((request) => request.requestId === requestId ? completedRequest : request)
    : [...session.imageRequests, completedRequest];
  const images = [...session.images];
  for (const image of pair.images) if (!images.some((existing) => existing.id === image.id)) images.push(image);

  const messages = session.messages.some((message) => message.role === "assistant" && message.requestId === requestId)
    ? session.messages
    : [...session.messages, {
      id: nextMessageId(session.messages),
      role: "assistant" as const,
      content: "Two visual directions were generated. Compare them in Generated visuals and add either image to the Working Board if useful.",
      turn: relatedTurn ?? 0,
      createdAt: pair.completedAt,
      relatedImageIds: pair.images.map((image) => image.id),
      provider: pair.provider,
      modelId: pair.model,
      promptVersion: pair.promptVersion,
      requestId,
    }];
  const researchEvents = session.researchEvents.some((event) => event.type === "ai_image_request_succeeded" && event.requestId === requestId)
    ? session.researchEvents
    : [...session.researchEvents, {
      id: nextResearchEventId(session.researchEvents),
      type: "ai_image_request_succeeded" as const,
      summary: "AI image request completed with two retained images.",
      actor: "system" as const,
      createdAt: pair.completedAt,
      timestampSeconds: session.participantStartedAt ? Math.max(0, Math.floor((new Date(pair.completedAt).getTime() - new Date(session.participantStartedAt).getTime()) / 1000)) : 0,
      requestId,
    }];
  return {
    ...session,
    imageRequests,
    imageRequestCount: imageRequests.filter((request) => request.status === "succeeded").length,
    images,
    messages,
    researchEvents,
  };
}

async function updateAuthoritativeSession(row: StudySessionRow, requestId: string, pair: PairMetadata): Promise<StudySessionRow> {
  let current = row;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const session = current.session_data as unknown as Session;
    const next = applyPairToSession(session, requestId, pair);
    const result = await updateStudySessionWithRevision(current.id, current.revision, {
      sessionData: next as unknown as Json,
      sessionStatus: next.status,
    });
    if (result.status === "updated") return result.row;
    const latest = await findStudySessionById(current.id);
    if (!latest) break;
    current = latest;
  }
  throw new RemoteImageCommitError("session_update");
}

function pairFromRows(rows: GeneratedImageRow[]): PairMetadata | null {
  if (rows.length !== 2) return null;
  const metadata = [...rows].sort((left, right) => left.existing_image_id.localeCompare(right.existing_image_id)).map((row) => row.metadata as unknown as { image?: GeneratedImage; request?: Omit<PairMetadata, "images"> });
  if (!metadata.every((item) => item.image && item.request)) return null;
  const request = metadata[0].request!;
  return { ...request, images: [metadata[0].image!, metadata[1].image!] };
}

export async function resumeRemoteImageCommit(row: StudySessionRow, requestId: string, records: GeneratedImageRow[]): Promise<StudySessionRow | null> {
  const pair = pairFromRows(records);
  return pair ? updateAuthoritativeSession(row, requestId, pair) : null;
}

async function bestEffortCleanup(paths: string[], recordIds: string[]): Promise<void> {
  await Promise.allSettled([
    removePrivateGeneratedImages(paths),
    deleteGeneratedImageRecords(recordIds),
  ]);
}

export async function commitRemoteImagePair(row: StudySessionRow, requestId: string, promptText: string, result: ImageServiceResult): Promise<StudySessionRow> {
  const latest = await findStudySessionById(row.id);
  if (!latest || latest.session_status !== "active") throw new RemoteImageCommitError("validation");
  const session = latest.session_data as unknown as Session;
  const centralImages = await listGeneratedImagesForSession(latest.id);
  const requestLimit = session.configuredImageRequestLimit ?? 5;
  const imageLimit = session.configuredImageTotalLimit ?? 10;
  const centralRequestCount = new Set(centralImages.map((image) => image.request_id)).size;
  const sessionRequestCount = session.imageRequests.filter((request) => request.status === "succeeded").length;
  if (Math.max(centralRequestCount, sessionRequestCount) >= requestLimit || Math.max(centralImages.length, session.images.length) + 2 > imageLimit) {
    throw new RemoteImageCommitError("validation", "IMAGE_LIMIT_REACHED");
  }
  const pendingRequest = session.imageRequests.find((request) => request.requestId === requestId);
  const relatedTurn = pendingRequest?.relatedTurn ?? 0;
  const imageIds = nextStableImageIds(session);

  let binaries;
  try {
    binaries = result.images.map((image) => decodeGeneratedImage(image.data, image.mimeType)) as [ReturnType<typeof decodeGeneratedImage>, ReturnType<typeof decodeGeneratedImage>];
  } catch {
    throw new RemoteImageCommitError("validation");
  }
  const paths = binaries.map((binary, index) => buildGeneratedImageStoragePath(latest.id, requestId, imageIds[index], binary.extension)) as [string, string];
  const images = result.images.map((image, index): GeneratedImage => ({
    id: imageIds[index],
    kind: "visual",
    prompt: promptText,
    createdAt: result.completedAt,
    relatedTurn,
    palette: [],
    label: `Generated visual ${image.imageIndex}`,
    requestId,
    sessionId: session.id,
    imageIndex: image.imageIndex,
    mimeType: binaries[index].mimeType,
    storageBackend: "supabase",
    storagePath: paths[index],
    byteSize: binaries[index].byteSize,
    checksum: binaries[index].checksum,
    displayedAt: result.completedAt,
    usageTargets: [],
    usageEvents: [],
  })) as [GeneratedImage, GeneratedImage];
  const pair: PairMetadata = {
    images,
    effectivePrompt: result.effectivePrompt,
    provider: result.provider,
    model: result.model,
    promptVersion: result.promptVersion,
    completedAt: result.completedAt,
    latencyMs: result.latencyMs,
  };

  const uploads = await Promise.allSettled(binaries.map((binary, index) => uploadPrivateGeneratedImage(paths[index], binary)));
  if (uploads.some((upload) => upload.status === "rejected")) {
    const uploadedPaths = paths.filter((_, index) => uploads[index].status === "fulfilled");
    await bestEffortCleanup(uploadedPaths, []);
    throw new RemoteImageCommitError("upload");
  }

  let records: GeneratedImageRow[] = [];
  try {
    const inserts: CreateGeneratedImageRecordInput[] = images.map((image, index) => ({
      sessionId: latest.id,
      existingImageId: image.id,
      requestId,
      storagePath: paths[index],
      mimeType: binaries[index].mimeType,
      byteSize: binaries[index].byteSize,
      sha256Checksum: binaries[index].checksum,
      metadata: { image, request: { ...pair, images: undefined } } as unknown as Json,
    }));
    records = await createGeneratedImageRecords(inserts);
  } catch {
    await bestEffortCleanup(paths, []);
    throw new RemoteImageCommitError("record_insert");
  }

  try {
    return await updateAuthoritativeSession(latest, requestId, pair);
  } catch {
    await bestEffortCleanup(paths, records.map((record) => record.id));
    throw new RemoteImageCommitError("session_update");
  }
}
