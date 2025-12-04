import { SchedulerSettings, DEFAULT_SETTINGS } from "./settings-engine";

// Storage keys to capture
const STORAGE_KEYS = {
  setup: "cfsa_setup_v1",
  blocks: "cfsa_blocks_v1",
  calls: "cfsa_calls_v1",
  callsMetadata: "cfsa_calls_coverage_v1",
  hf: "cfsa_hf_v2",
  jeopardy: "cfsa_jeopardy_v1",
  clinics: "cfsa_clinics_v1",
  settings: "cfsa_settings_v1",
} as const;

const SNAPSHOTS_KEY = "cfsa_snapshots_v1";
const MAX_AUTO_SAVES = 5;

export interface SnapshotStats {
  fellowCount: number;
  academicYearStart: number;
  primaryCoverage: number;
  hfCoverage: number;
  jeopardyCoverage: number;
  uncoveredDays: number;
}

export interface ScheduleSnapshot {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  autoSaved: boolean;
  stats: SnapshotStats;
  data: {
    setup: unknown;
    blocks: unknown;
    calls: unknown;
    callsMetadata: unknown;
    hf: unknown;
    jeopardy: unknown;
    clinics: unknown;
    settings: SchedulerSettings;
  };
}

function generateId(): string {
  return crypto.randomUUID();
}

function getStorageItem(key: string): unknown {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : null;
  } catch {
    return null;
  }
}

function setStorageItem(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(`Failed to save ${key}:`, e);
  }
}

export function captureCurrentSchedule(): ScheduleSnapshot["data"] {
  return {
    setup: getStorageItem(STORAGE_KEYS.setup),
    blocks: getStorageItem(STORAGE_KEYS.blocks),
    calls: getStorageItem(STORAGE_KEYS.calls),
    callsMetadata: getStorageItem(STORAGE_KEYS.callsMetadata),
    hf: getStorageItem(STORAGE_KEYS.hf),
    jeopardy: getStorageItem(STORAGE_KEYS.jeopardy),
    clinics: getStorageItem(STORAGE_KEYS.clinics),
    settings: (getStorageItem(STORAGE_KEYS.settings) as SchedulerSettings) || DEFAULT_SETTINGS,
  };
}

export function calculateSnapshotStats(data: ScheduleSnapshot["data"]): SnapshotStats {
  const setup = data.setup as { fellows?: unknown[]; academicYearStart?: number } | null;
  const calls = data.calls as Record<string, unknown> | null;
  const callsMetadata = data.callsMetadata as { uncoveredDays?: string[] } | null;
  const hf = data.hf as Record<string, unknown> | null;
  const jeopardy = data.jeopardy as Record<string, unknown> | null;

  const fellowCount = setup?.fellows?.length ?? 0;
  const academicYearStart = setup?.academicYearStart ?? new Date().getFullYear();

  // Calculate coverage percentages
  const callDays = calls ? Object.keys(calls).length : 0;
  const hfDays = hf ? Object.keys(hf).length : 0;
  const jeopardyDays = jeopardy ? Object.keys(jeopardy).length : 0;
  const uncoveredDays = callsMetadata?.uncoveredDays?.length ?? 0;

  // Rough estimate: academic year is ~365 days
  const totalDays = 365;
  const primaryCoverage = totalDays > 0 ? Math.round((callDays / totalDays) * 100) : 0;
  const hfCoverage = totalDays > 0 ? Math.round((hfDays / totalDays) * 100) : 0;
  const jeopardyCoverage = totalDays > 0 ? Math.round((jeopardyDays / totalDays) * 100) : 0;

  return {
    fellowCount,
    academicYearStart,
    primaryCoverage: Math.min(primaryCoverage, 100),
    hfCoverage: Math.min(hfCoverage, 100),
    jeopardyCoverage: Math.min(jeopardyCoverage, 100),
    uncoveredDays,
  };
}

export function loadSnapshots(): ScheduleSnapshot[] {
  try {
    const item = localStorage.getItem(SNAPSHOTS_KEY);
    return item ? JSON.parse(item) : [];
  } catch {
    return [];
  }
}

function saveSnapshots(snapshots: ScheduleSnapshot[]): void {
  setStorageItem(SNAPSHOTS_KEY, snapshots);
}

export function saveSnapshot(
  name: string,
  description?: string,
  autoSaved: boolean = false
): ScheduleSnapshot {
  const data = captureCurrentSchedule();
  const stats = calculateSnapshotStats(data);
  const now = new Date().toISOString();

  const snapshot: ScheduleSnapshot = {
    id: generateId(),
    name,
    description,
    createdAt: now,
    updatedAt: now,
    autoSaved,
    stats,
    data,
  };

  const snapshots = loadSnapshots();

  // If auto-save, prune old auto-saves
  if (autoSaved) {
    const autoSaves = snapshots.filter((s) => s.autoSaved);
    if (autoSaves.length >= MAX_AUTO_SAVES) {
      // Remove oldest auto-saves
      const sortedAutoSaves = autoSaves.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      const toRemove = sortedAutoSaves.slice(0, autoSaves.length - MAX_AUTO_SAVES + 1);
      const idsToRemove = new Set(toRemove.map((s) => s.id));
      const filtered = snapshots.filter((s) => !idsToRemove.has(s.id));
      filtered.push(snapshot);
      saveSnapshots(filtered);
      return snapshot;
    }
  }

  snapshots.push(snapshot);
  saveSnapshots(snapshots);
  return snapshot;
}

export function restoreSnapshot(id: string): boolean {
  const snapshots = loadSnapshots();
  const snapshot = snapshots.find((s) => s.id === id);

  if (!snapshot) return false;

  const { data } = snapshot;

  // Restore all data to localStorage
  if (data.setup !== null) setStorageItem(STORAGE_KEYS.setup, data.setup);
  else localStorage.removeItem(STORAGE_KEYS.setup);

  if (data.blocks !== null) setStorageItem(STORAGE_KEYS.blocks, data.blocks);
  else localStorage.removeItem(STORAGE_KEYS.blocks);

  if (data.calls !== null) setStorageItem(STORAGE_KEYS.calls, data.calls);
  else localStorage.removeItem(STORAGE_KEYS.calls);

  if (data.callsMetadata !== null) setStorageItem(STORAGE_KEYS.callsMetadata, data.callsMetadata);
  else localStorage.removeItem(STORAGE_KEYS.callsMetadata);

  if (data.hf !== null) setStorageItem(STORAGE_KEYS.hf, data.hf);
  else localStorage.removeItem(STORAGE_KEYS.hf);

  if (data.jeopardy !== null) setStorageItem(STORAGE_KEYS.jeopardy, data.jeopardy);
  else localStorage.removeItem(STORAGE_KEYS.jeopardy);

  if (data.clinics !== null) setStorageItem(STORAGE_KEYS.clinics, data.clinics);
  else localStorage.removeItem(STORAGE_KEYS.clinics);

  setStorageItem(STORAGE_KEYS.settings, data.settings);

  return true;
}

export function deleteSnapshot(id: string): void {
  const snapshots = loadSnapshots();
  const filtered = snapshots.filter((s) => s.id !== id);
  saveSnapshots(filtered);
}

export function renameSnapshot(id: string, name: string, description?: string): void {
  const snapshots = loadSnapshots();
  const snapshot = snapshots.find((s) => s.id === id);

  if (snapshot) {
    snapshot.name = name;
    snapshot.description = description;
    snapshot.updatedAt = new Date().toISOString();
    saveSnapshots(snapshots);
  }
}

export function exportSnapshot(id: string): void {
  const snapshots = loadSnapshots();
  const snapshot = snapshots.find((s) => s.id === id);

  if (!snapshot) return;

  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `schedule-snapshot-${snapshot.name.replace(/\s+/g, "-").toLowerCase()}-${
    snapshot.createdAt.split("T")[0]
  }.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportAllSnapshots(): void {
  const snapshots = loadSnapshots();
  if (snapshots.length === 0) return;

  const blob = new Blob([JSON.stringify(snapshots, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `all-schedule-snapshots-${new Date().toISOString().split("T")[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function importSnapshot(file: File): Promise<ScheduleSnapshot> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const imported = JSON.parse(content);

        // Check if it's an array (multiple snapshots) or single
        if (Array.isArray(imported)) {
          const snapshots = loadSnapshots();
          const existingIds = new Set(snapshots.map((s) => s.id));

          for (const snap of imported) {
            if (!existingIds.has(snap.id) && isValidSnapshot(snap)) {
              snapshots.push(snap);
            }
          }

          saveSnapshots(snapshots);
          resolve(imported[0]);
        } else if (isValidSnapshot(imported)) {
          // Single snapshot - assign new ID to avoid conflicts
          const snapshot: ScheduleSnapshot = {
            ...imported,
            id: generateId(),
            createdAt: imported.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          const snapshots = loadSnapshots();
          snapshots.push(snapshot);
          saveSnapshots(snapshots);
          resolve(snapshot);
        } else {
          reject(new Error("Invalid snapshot format"));
        }
      } catch {
        reject(new Error("Failed to parse snapshot file"));
      }
    };

    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

function isValidSnapshot(obj: unknown): obj is ScheduleSnapshot {
  if (!obj || typeof obj !== "object") return false;
  const snap = obj as Record<string, unknown>;
  return (
    typeof snap.name === "string" &&
    snap.data !== null &&
    typeof snap.data === "object"
  );
}

export function getStorageUsage(): { used: number; total: number; percentage: number } {
  let used = 0;
  for (const key in localStorage) {
    if (localStorage.hasOwnProperty(key)) {
      used += localStorage.getItem(key)?.length ?? 0;
    }
  }
  // localStorage limit is typically ~5MB (5,242,880 bytes)
  const total = 5 * 1024 * 1024;
  return {
    used,
    total,
    percentage: Math.round((used / total) * 100),
  };
}
