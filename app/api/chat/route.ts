import { NextRequest, NextResponse } from "next/server";
import { requestTextCompletion, SafeAITextError, type TextHistoryItem } from "@/services/server/geminiTextService";
import { authoriseParticipantModelRequest } from "@/services/server/participantModelAuth";
import { PARTICIPANT_MESSAGE_LIMIT } from "@/data/experiment";
import { getConversationAllowanceCount } from "@/services/conversationAllowance";

export const runtime = "nodejs";

const MAX_MESSAGES = PARTICIPANT_MESSAGE_LIMIT * 2 + 1;
const MAX_MESSAGE_CHARACTERS = 6_000;
const MAX_TOTAL_CHARACTERS = 220_000;
const MAX_REQUEST_BYTES = 250_000;

function validatePayload(value: unknown): { sessionId: string; requestId: string; messages: TextHistoryItem[] } | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as { sessionId?: unknown; requestId?: unknown; messages?: unknown };
  if (typeof payload.sessionId !== "string" || !/^SESSION-[A-Za-z0-9-]{8,100}$/.test(payload.sessionId)) return null;
  if (typeof payload.requestId !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(payload.requestId)) return null;
  if (!Array.isArray(payload.messages) || payload.messages.length < 1 || payload.messages.length > MAX_MESSAGES) return null;

  let totalCharacters = 0;
  const messages: TextHistoryItem[] = [];
  for (const item of payload.messages) {
    if (!item || typeof item !== "object") return null;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role !== "participant" && role !== "assistant") || typeof content !== "string") return null;
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > MAX_MESSAGE_CHARACTERS) return null;
    totalCharacters += trimmed.length;
    messages.push({ role, content: trimmed });
  }
  if (totalCharacters > MAX_TOTAL_CHARACTERS || messages.at(-1)?.role !== "participant") return null;
  return { sessionId: payload.sessionId, requestId: payload.requestId, messages };
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 413 });

  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  if (JSON.stringify(value).length > MAX_REQUEST_BYTES) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 413 });
  const payload = validatePayload(value);
  if (!payload) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const authorised = await authoriseParticipantModelRequest(request, payload.sessionId);
  if (!authorised) return NextResponse.json({ error: "PARTICIPANT_SESSION_UNAVAILABLE" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const storedRequest = authorised.session.aiTextRequests.find((item) => item.requestId === payload.requestId && item.status === "started");
  const authoritativeMessages = authorised.session.messages.filter((item) => item.role === "participant" || item.role === "assistant").map((item) => ({ role: item.role as "participant" | "assistant", content: item.content }));
  if (!storedRequest || getConversationAllowanceCount(authorised.session) >= PARTICIPANT_MESSAGE_LIMIT || authoritativeMessages.at(-1)?.role !== "participant") return NextResponse.json({ error: "REQUEST_NOT_AUTHORISED" }, { status: 409, headers: { "Cache-Control": "no-store" } });

  try {
    const result = await requestTextCompletion(payload.requestId, authoritativeMessages);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const category = error instanceof SafeAITextError ? error.category : "unknown";
    const status = category === "invalid_request" ? 400 : category === "permission_denied" ? 403 : category === "model_not_found" ? 404 : category === "rate_limit" ? 429 : category === "timeout" ? 504 : category === "configuration" ? 503 : 502;
    const diagnostics = error instanceof SafeAITextError ? error.diagnostics : undefined;
    return NextResponse.json({ requestId: payload.requestId, error: "AI_TEXT_REQUEST_FAILED", category, finishReason: error instanceof SafeAITextError ? error.finishReason : undefined, providerStatusCode: error instanceof SafeAITextError ? error.providerStatusCode : undefined, diagnostics }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
