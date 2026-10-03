import { NextRequest, NextResponse } from "next/server";
import { requestDecisionTraceClassification, SafeDecisionTraceError } from "@/services/server/geminiDecisionTraceService";
import type { DecisionTraceContext } from "@/services/decisionTraceClassifier";
import { DECISION_TRACE_PROMPT_VERSION } from "@/services/decisionTraceClassifier";
import type { AIProposition, DecisionUnit, Message, Session } from "@/types";
import { authoriseParticipantModelRequest } from "@/services/server/participantModelAuth";
import { PARTICIPANT_MESSAGE_LIMIT } from "@/data/experiment";
import { getConversationAllowanceCount } from "@/services/conversationAllowance";
import { buildDecisionTracePayload } from "@/services/decisionTraceService";
import { applyTraceClassificationFailure, applyTraceClassificationResponse } from "@/services/decisionTraceSessionState";
import { findStudySessionByPublicId, updateStudySessionWithRevision } from "@/services/server/sessionRepository";
import { participantSafeSession } from "@/services/server/sessionPayload";
import type { Json, StudySessionRow } from "@/types/database";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 80_000;
const MAX_MESSAGE_CHARACTERS = 6_000;

function text(value: unknown, maximum = MAX_MESSAGE_CHARACTERS): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function validateMessage(value: unknown): DecisionTraceContext["recentMessages"][number] | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<Message>;
  if (!text(item.id, 100) || (item.role !== "participant" && item.role !== "assistant") || !text(item.content) || !text(item.createdAt, 60) || !Number.isInteger(item.turn) || item.turn! < 0) return null;
  return { id: item.id, role: item.role, content: item.content.trim(), createdAt: item.createdAt, turn: item.turn as number };
}

function validateParticipantRequest(value: unknown): { sessionId: string; participantMessageId: string; requestId: string } | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (!text(payload.sessionId, 140) || !text(payload.participantMessageId, 100) || !text(payload.requestId, 100) || !/^[A-Za-z0-9_-]{8,100}$/.test(payload.requestId)) return null;
  return { sessionId: payload.sessionId as string, participantMessageId: payload.participantMessageId as string, requestId: payload.requestId as string };
}

function validatePayload(value: unknown): { requestId: string; classifierVersion: string; context: DecisionTraceContext } | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (!text(payload.requestId, 100) || !/^[A-Za-z0-9_-]{8,100}$/.test(payload.requestId) || !text(payload.sessionId, 140) || !text(payload.classifierVersion, 100)) return null;
  const current = validateMessage(payload.participantMessage);
  if (!current || current.role !== "participant") return null;
  if (!Array.isArray(payload.recentMessages) || payload.recentMessages.length < 1 || payload.recentMessages.length > 9) return null;
  const recentMessages = payload.recentMessages.map(validateMessage);
  if (recentMessages.some((item) => !item)) return null;
  const messages = recentMessages as DecisionTraceContext["recentMessages"];
  if (!messages.some((item) => item.id === current.id && item.role === "participant" && item.content === current.content)) return null;
  if (messages.filter((item) => item.role === "participant" && item.id !== current.id).length > 4 || messages.filter((item) => item.role === "assistant").length > 4) return null;

  if (!Array.isArray(payload.aiPropositions) || payload.aiPropositions.length > 32) return null;
  const aiPropositions: AIProposition[] = [];
  for (const raw of payload.aiPropositions) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Partial<AIProposition>;
    if (!text(item.id, 120) || !text(item.aiMessageId, 100) || !Number.isInteger(item.turn) || !text(item.summary, 500) || !text(item.createdAt, 60)) return null;
    aiPropositions.push({ id: item.id, aiMessageId: item.aiMessageId, turn: item.turn as number, summary: item.summary, optionLabel: typeof item.optionLabel === "string" ? item.optionLabel.slice(0, 100) : undefined, createdAt: item.createdAt });
  }

  if (!Array.isArray(payload.recentDecisionUnits) || payload.recentDecisionUnits.length > 16) return null;
  const recentDecisionUnits: DecisionTraceContext["recentDecisionUnits"] = [];
  for (const raw of payload.recentDecisionUnits) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Partial<DecisionUnit>;
    if (!text(item.id, 100) || !text(item.summary, 300)) return null;
    recentDecisionUnits.push({
      id: item.id, summary: item.summary,
      category: item.category,
      participantMessageId: item.participantMessageId,
      linkedAiPropositionIds: Array.isArray(item.linkedAiPropositionIds) ? item.linkedAiPropositionIds.filter((id): id is string => typeof id === "string").slice(0, 8) : [],
    });
  }
  return { requestId: payload.requestId, classifierVersion: payload.classifierVersion as string, context: { sessionId: payload.sessionId as string, participantMessage: current, recentMessages: messages, aiPropositions, recentDecisionUnits } };
}

async function persistTraceSession(row: StudySessionRow, next: Session): Promise<StudySessionRow | null> {
  let base = row;
  let candidate = next;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const saved = await updateStudySessionWithRevision(base.id, base.revision, { sessionData: candidate as unknown as Json });
    if (saved.status === "updated") return saved.row;
    const latest = await findStudySessionByPublicId(base.public_session_id);
    if (!latest) return null;
    base = latest;
    const latestSession = latest.session_data as unknown as Session;
    const traceClassifications = (latestSession.traceClassifications ?? []).map((record) => next.traceClassifications?.find((incoming) => incoming.requestId === record.requestId) ?? record);
    for (const incoming of next.traceClassifications ?? []) if (!traceClassifications.some((record) => record.requestId === incoming.requestId)) traceClassifications.push(incoming);
    candidate = {
      ...latestSession,
      decisions: [...latestSession.decisions, ...next.decisions.filter((decision) => !latestSession.decisions.some((stored) => stored.id === decision.id))],
      aiPropositions: [...(latestSession.aiPropositions ?? []), ...(next.aiPropositions ?? []).filter((proposition) => !(latestSession.aiPropositions ?? []).some((stored) => stored.id === proposition.id))],
      traceClassifications,
    };
  }
  return null;
}

function participantTraceResponse(row: StudySessionRow) {
  return NextResponse.json({
    remoteSession: { session: participantSafeSession(row.session_data as unknown as Session), revision: row.revision, updatedAt: row.updated_at },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) return NextResponse.json({ error: "TRACE_CONTEXT_ERROR" }, { status: 413 });
  let value: unknown;
  try { value = await request.json(); } catch { return NextResponse.json({ error: "TRACE_CONTEXT_ERROR" }, { status: 400 }); }
  if (JSON.stringify(value).length > MAX_REQUEST_BYTES) return NextResponse.json({ error: "TRACE_CONTEXT_ERROR" }, { status: 413 });
  const participantRequest = validateParticipantRequest(value);
  if (!participantRequest) return NextResponse.json({ error: "TRACE_CONTEXT_ERROR" }, { status: 400 });
  const authorised = await authoriseParticipantModelRequest(request, participantRequest.sessionId);
  if (!authorised) return NextResponse.json({ error: "PARTICIPANT_SESSION_UNAVAILABLE" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const participantMessage = authorised.session.messages.find((message) => message.id === participantRequest.participantMessageId && message.role === "participant");
  const pending = (authorised.session.traceClassifications ?? []).find((item) => item.requestId === participantRequest.requestId && item.participantMessageId === participantRequest.participantMessageId && item.status === "TRACE_CLASSIFICATION_PENDING");
  if (!participantMessage || !pending || getConversationAllowanceCount(authorised.session) > PARTICIPANT_MESSAGE_LIMIT) return NextResponse.json({ error: "TRACE_CONTEXT_ERROR" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  const authoritativePayload = buildDecisionTracePayload(authorised.session, participantMessage, participantRequest.requestId);
  const payload = validatePayload(authoritativePayload);
  if (!payload) return NextResponse.json({ error: "TRACE_CONTEXT_ERROR" }, { status: 400 });
  if (payload.classifierVersion !== DECISION_TRACE_PROMPT_VERSION) return NextResponse.json({ error: "TRACE_CONTEXT_ERROR" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  try {
    const result = await requestDecisionTraceClassification(payload.requestId, payload.context);
    const next = applyTraceClassificationResponse(authorised.session, participantMessage, payload.requestId, result, authorised.session.participantStartedAt ?? authorised.session.startedAt);
    const saved = await persistTraceSession(authorised.row, next);
    return saved ? participantTraceResponse(saved) : NextResponse.json({ error: "TRACE_CONTEXT_ERROR" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof SafeDecisionTraceError ? error.code : "TRACE_PROVIDER_ERROR";
    const diagnostics = error instanceof SafeDecisionTraceError ? error.diagnostics : undefined;
    const next = applyTraceClassificationFailure(authorised.session, payload.requestId, code, new Date().toISOString(), diagnostics);
    const saved = await persistTraceSession(authorised.row, next);
    return saved ? participantTraceResponse(saved) : NextResponse.json({ error: "TRACE_CONTEXT_ERROR" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
}
