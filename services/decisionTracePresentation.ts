import type { DecisionAction, DecisionUnit } from "@/types";

export interface DecisionTraceTurnGroup {
  key: string;
  turn: number | null;
  decisions: DecisionUnit[];
}

export function buildDecisionTraceTurnGroups(decisions: DecisionUnit[]): DecisionTraceTurnGroup[] {
  const sorted = [...decisions].sort((left, right) => left.timestampSeconds - right.timestampSeconds || left.id.localeCompare(right.id));
  const groups: DecisionTraceTurnGroup[] = [];
  const byKey = new Map<string, DecisionTraceTurnGroup>();
  for (const decision of sorted) {
    const key = decision.relatedTurn && decision.relatedTurn > 0 ? `turn-${decision.relatedTurn}` : `board-${decision.id}`;
    const existing = byKey.get(key);
    if (existing) existing.decisions.push(decision);
    else {
      const group = { key, turn: decision.relatedTurn && decision.relatedTurn > 0 ? decision.relatedTurn : null, decisions: [decision] };
      byKey.set(key, group);
      groups.push(group);
    }
  }
  return groups;
}

export const traceActionClass = (action: string) => action.toLowerCase().replaceAll("-", "");

export function participantDecisionLabel(action: DecisionAction): "Accept" | "Modify" | "Reject" | "New Direction" | "Uncertain" {
  return action === "Human-initiated" ? "New Direction" : action;
}

export function getCurrentDecisionGroup(decisions: DecisionUnit[]): DecisionUnit[] {
  const latest = [...decisions].sort((left, right) => (right.relatedTurn ?? -1) - (left.relatedTurn ?? -1) || right.timestampSeconds - left.timestampSeconds || right.id.localeCompare(left.id))[0];
  if (!latest) return [];
  if (latest.participantMessageId) return decisions.filter((decision) => decision.participantMessageId === latest.participantMessageId);
  if (latest.relatedTurn) return decisions.filter((decision) => decision.relatedTurn === latest.relatedTurn);
  return [latest];
}
