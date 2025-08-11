export type PGY = "PGY-4" | "PGY-5" | "PGY-6";

export type Fellow = {
  id: string;
  name: string;
  pgy: PGY;
  vacationPrefs: (string | undefined)[]; // keys like JUL1, JUL2, ...
};

export type SetupState = {
  yearStart: string; // ISO date
  fellows: Fellow[];
  holidays: { id: string; date: string; name: string }[];
};

export type FellowSchedule = Record<string, Record<string, string | undefined>>; // fellowId -> blockKey -> label

export type StoredSchedule = {
  version: 1;
  pgy: PGY;
  byFellow: FellowSchedule;
};

export const SETUP_STORAGE_KEY = "cfsa_setup_v1";
export const SCHEDULE_STORAGE_KEY = "cfsa_blocks_v1";

export function loadSetup(): SetupState | null {
  try {
    const raw = localStorage.getItem(SETUP_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SetupState;
  } catch {
    return null;
  }
}

export function loadSchedule(pgy: PGY): StoredSchedule | null {
  try {
    const raw = localStorage.getItem(SCHEDULE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, StoredSchedule>;
    return parsed[pgy] ?? null;
  } catch {
    return null;
  }
}

export function saveSchedule(pgy: PGY, schedule: StoredSchedule) {
  try {
    const raw = localStorage.getItem(SCHEDULE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, StoredSchedule>) : {};
    parsed[pgy] = schedule;
    localStorage.setItem(SCHEDULE_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore
  }
}

// Step 1 engine: place vacations only, respecting fellow preferences order (no conflict resolution yet)
export function buildVacationOnlySchedule(fellows: Fellow[]): FellowSchedule {
  const byFellow: FellowSchedule = {};
  for (const f of fellows) {
    const row: Record<string, string | undefined> = {};
    for (const pref of f.vacationPrefs) {
      if (!pref) continue;
      // If the block already has a label (shouldn't for a single fellow), last write wins
      row[pref] = "VAC";
    }
    byFellow[f.id] = row;
  }
  return byFellow;
}

export function countByBlock(byFellow: FellowSchedule): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const fid of Object.keys(byFellow)) {
    const row = byFellow[fid];
    for (const [block, label] of Object.entries(row)) {
      if (!label) continue;
      counts[block] = (counts[block] ?? 0) + (label === "VAC" ? 1 : 0);
    }
  }
  return counts;
}
