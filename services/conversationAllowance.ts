import type { Session } from "@/types";

/** Failed provider attempts do not consume the message allowance， legacy messages without request records still count */
export function getConversationAllowanceCount(session: Pick<Session, "messages" | "aiTextRequests">): number {
  const requestedMessageIds = new Set(session.aiTextRequests.map((request) => request.participantMessageId));
  const succeededMessageIds = new Set(session.aiTextRequests.filter((request) => request.status === "succeeded").map((request) => request.participantMessageId));
  return session.messages.filter((message) => message.role === "participant" && (!requestedMessageIds.has(message.id) || succeededMessageIds.has(message.id))).length;
}
