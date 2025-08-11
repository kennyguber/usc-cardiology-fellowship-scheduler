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

import { hasMinSpacing, type BlockInfo } from "@/lib/block-utils";

export const MAX_VACATIONS_PER_YEAR = 2;
export const VACATION_MIN_SPACING_BLOCKS = 6; // 3 months (2-week blocks)

// Step 1 engine: place vacations only: at most 2 per fellow, >= 6 blocks apart, honoring preference order
export function buildVacationOnlySchedule(fellows: Fellow[], blocks: BlockInfo[]): FellowSchedule {
  const byFellow: FellowSchedule = {};
  for (const f of fellows) {
    const row: Record<string, string | undefined> = {};
    const seen = new Set<string>();
    const selected: string[] = [];

    for (const pref of f.vacationPrefs) {
      if (!pref) continue;
      if (seen.has(pref)) continue;
      seen.add(pref);
      const next = [...selected, pref];
      if (hasMinSpacing(blocks, next, VACATION_MIN_SPACING_BLOCKS)) {
        selected.push(pref);
        if (selected.length >= MAX_VACATIONS_PER_YEAR) break;
      }
    }

    for (const key of selected) row[key] = "VAC";
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

// New solver: assign exactly 2 vacations per fellow with >= 6-block spacing
// and prevent overlaps within the same PGY (max 1 vacation per block across fellows)
export type VacationSolveResult = {
  byFellow: FellowSchedule;
  success: boolean;
  conflicts?: string[];
  tried?: number;
};

export function buildVacationScheduleForPGY(
  fellows: Fellow[],
  blocks: BlockInfo[],
  minSpacingBlocks = VACATION_MIN_SPACING_BLOCKS
): VacationSolveResult {
  const blockKeys = blocks.map((b) => b.key);
  const indexByKey = new Map<string, number>(blockKeys.map((k, i) => [k, i] as const));
  const N = fellows.length;

  function spaced(a: string, b: string) {
    const ia = indexByKey.get(a) ?? -1;
    const ib = indexByKey.get(b) ?? -1;
    if (ia < 0 || ib < 0) return false;
    const diff = Math.abs(ia - ib);
    return diff >= minSpacingBlocks;
  }

  // Prepare candidates (preferences first, then all others)
  const allKeysSet = new Set(blockKeys);
  const byFellowCandidates = fellows.map((f) => {
    const prefs = Array.from(new Set((f.vacationPrefs || []).filter((k): k is string => !!k && allKeysSet.has(k))));
    const nonPrefs = blockKeys.filter((k) => !prefs.includes(k));

    // Tiered pairs: (pref,pref) -> (pref,nonpref) -> (nonpref,nonpref)
    const prefPref: [string, string][] = [];
    for (let i = 0; i < prefs.length; i++) {
      for (let j = i + 1; j < prefs.length; j++) {
        if (spaced(prefs[i], prefs[j])) prefPref.push([prefs[i], prefs[j]]);
      }
    }

    const prefNon: [string, string][] = [];
    for (const p of prefs) {
      for (const q of nonPrefs) {
        if (spaced(p, q)) prefNon.push([p, q]);
      }
    }

    const nonNon: [string, string][] = [];
    for (let i = 0; i < nonPrefs.length; i++) {
      for (let j = i + 1; j < nonPrefs.length; j++) {
        if (spaced(nonPrefs[i], nonPrefs[j])) nonNon.push([nonPrefs[i], nonPrefs[j]]);
      }
    }

    const allPairs = [...prefPref, ...prefNon, ...nonNon];

    // Simple heuristic: sort pairs by how centered they are (optional)
    const mid = (blockKeys.length - 1) / 2;
    const score = (a: string, b: string) => {
      const ia = indexByKey.get(a)!;
      const ib = indexByKey.get(b)!;
      const center = Math.abs(ia - mid) + Math.abs(ib - mid);
      // Prefer pairs closer to middle, and pairs with both preferences first
      const prefScore = (prefs.includes(a) ? 0 : 1) + (prefs.includes(b) ? 0 : 1);
      return prefScore * 1000 + center;
    };

    allPairs.sort((p1, p2) => score(p1[0], p1[1]) - score(p2[0], p2[1]));
    return { fellow: f, pairs: allPairs, prefCount: prefPref.length };
  });

  // Order fellows: most constrained first (fewest pref-pref pairs, then fewest total pairs)
  const order = [...byFellowCandidates]
    .map((c, idx) => ({ ...c, idx }))
    .sort((a, b) => (a.prefCount - b.prefCount) || (a.pairs.length - b.pairs.length));

  const used = new Set<string>();
  const byFellow: FellowSchedule = {};
  let tried = 0;

  function backtrack(i: number): boolean {
    if (i >= N) return true;
    const { fellow, pairs } = order[i];

    for (const [a, b] of pairs) {
      if (used.has(a) || used.has(b)) continue;
      // place
      byFellow[fellow.id] = { [a]: "VAC", [b]: "VAC" };
      used.add(a);
      used.add(b);
      tried++;
      if (backtrack(i + 1)) return true;
      // undo
      used.delete(a);
      used.delete(b);
      delete byFellow[fellow.id];
      // continue
    }
    return false;
  }

  const success = backtrack(0);
  if (success) {
    // Ensure everyone has exactly two vacations marked
    for (const f of fellows) {
      if (!byFellow[f.id]) byFellow[f.id] = {};
    }
    return { byFellow, success: true, tried };
  }

  // Build conflicts diagnostics
  const conflicts: string[] = [];
  for (const c of order) {
    if (c.pairs.length === 0) {
      conflicts.push(`${c.fellow.name || c.fellow.id}: no valid pairs available given spacing`);
    }
  }
  if (conflicts.length === 0) conflicts.push("No assignment satisfies all constraints (try adjusting preferences)");

  return { byFellow: {}, success: false, conflicts, tried };
}
