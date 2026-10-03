import type { TraceClassificationRecord } from "@/types";

export function mergeTraceClassificationRecords(
  stored: TraceClassificationRecord[] = [],
  incoming: TraceClassificationRecord[] = [],
): TraceClassificationRecord[] {
  const merged = stored.map((record) => ({ ...record }));
  const indexByRequestId = new Map(merged.map((record, index) => [record.requestId, index]));

  for (const record of incoming) {
    const index = indexByRequestId.get(record.requestId);
    if (index === undefined) {
      indexByRequestId.set(record.requestId, merged.length);
      merged.push(record);
      continue;
    }
    // The server owns completed diagnostics. A participant-safe response omits
    // them, so a later client draft must never downgrade or erase that record.
    if (merged[index].status === "TRACE_CLASSIFICATION_PENDING") merged[index] = record;
  }
  return merged;
}
