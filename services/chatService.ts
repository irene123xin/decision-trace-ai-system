import type { AITextAttempt, AITextErrorStage, AITextFailureCategory, AITextMode, Message } from "@/types";

export interface ChatDiagnostics {
  attempts?: AITextAttempt[];
  errorStage?: AITextErrorStage;
  candidateCount?: number;
  inputTokenCount?: number;
  outputTokenCount?: number;
  finalResolution?: "succeeded" | "failed_transient" | "failed_non_retryable" | "incomplete_response";
  safeErrorMessage?: string;
}

export interface ChatResponse {
  requestId: string;
  content: string;
  provider: string;
  modelId: string;
  promptVersion: string;
  integrationMode: AITextMode;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  finishReason: string;
  attempts: AITextAttempt[];
  attemptCount: number;
  candidateCount: number;
  inputTokenCount?: number;
  outputTokenCount?: number;
  finalResolution: "succeeded";
}

export class ChatRequestError extends Error {
  constructor(public readonly category: AITextFailureCategory, public readonly finishReason?: string, public readonly providerStatusCode?: number, public readonly diagnostics: ChatDiagnostics = {}) {
    super("AI text request failed");
    this.name = "ChatRequestError";
  }
}

export async function requestChatResponse(sessionId: string, requestId: string, messages: Message[]): Promise<ChatResponse> {
  const history = messages
    .filter((message) => message.role === "participant" || message.role === "assistant")
    .map((message) => ({ role: message.role, content: message.content }));
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ sessionId, requestId, messages: history }),
    });
    const value = await response.json() as Partial<ChatResponse> & { category?: AITextFailureCategory; providerStatusCode?: number; diagnostics?: ChatDiagnostics };
    if (!response.ok || typeof value.content !== "string" || !value.provider || !value.modelId || !value.promptVersion || !value.integrationMode || !value.startedAt || !value.completedAt || typeof value.latencyMs !== "number" || !value.finishReason) {
      throw new ChatRequestError(value.category ?? "invalid_response", value.finishReason, value.providerStatusCode, value.diagnostics);
    }
    return value as ChatResponse;
  } catch (error) {
    if (error instanceof ChatRequestError) throw error;
    throw new ChatRequestError("unknown");
  }
}
