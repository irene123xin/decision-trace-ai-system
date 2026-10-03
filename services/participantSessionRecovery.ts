import type { SessionStatus } from "@/types";

export const RESUMABLE_PARTICIPANT_STATUSES: readonly SessionStatus[] = [
  "ready",
  "briefing",
  "starting_point",
  "active",
  "questionnaire",
];

export function isResumableParticipantStatus(status: string): status is SessionStatus {
  return (RESUMABLE_PARTICIPANT_STATUSES as readonly string[]).includes(status);
}
