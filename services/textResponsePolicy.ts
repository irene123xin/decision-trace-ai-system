export function completedAssistantContent(content: string | undefined, finishReason: string | undefined): string | null {
  const value = content?.trim();
  return value && finishReason === "STOP" ? value : null;
}

export function isCompletedAssistantMessage(message: { role: string; finishReason?: string }): boolean {
  return message.role !== "assistant" || !message.finishReason || message.finishReason === "STOP" || message.finishReason === "MOCK_COMPLETE";
}
