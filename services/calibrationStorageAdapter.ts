import type { CalibrationWorkspaceRecord } from "@/types";

const KEY = "decision-trace-calibration-workspace-v1";
const empty = (): CalibrationWorkspaceRecord => ({ calibrationLog: [], freezeRecords: [] });

export const calibrationStorageAdapter = {
  load(): CalibrationWorkspaceRecord {
    if (typeof window === "undefined") return empty();
    try {
      const value = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Partial<CalibrationWorkspaceRecord> | null;
      return { calibrationLog: value?.calibrationLog ?? [], freezeRecords: value?.freezeRecords ?? [] };
    } catch { return empty(); }
  },
  save(value: CalibrationWorkspaceRecord) {
    if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(value));
  },
  clear() {
    if (typeof window !== "undefined") window.localStorage.removeItem(KEY);
  },
};

