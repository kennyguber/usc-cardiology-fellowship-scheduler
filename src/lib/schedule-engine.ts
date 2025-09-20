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

// Get vacation counts across all PGY levels for cross-PGY validation
export function getAllPGYVacationCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  const pgyLevels: PGY[] = ["PGY-4", "PGY-5", "PGY-6"];
  
  for (const pgy of pgyLevels) {
    const schedule = loadSchedule(pgy);
    if (schedule?.byFellow) {
      for (const fellowRow of Object.values(schedule.byFellow)) {
        for (const [blockKey, rotation] of Object.entries(fellowRow)) {
          if (rotation === "VAC") {
            counts[blockKey] = (counts[blockKey] || 0) + 1;
          }
        }
      }
    }
  }
  
  return counts;
}

// New solver: assign up to 2 vacations per fellow with >= 6-block spacing
// Allow up to 2 fellows per block (within PGY), max 2 total across all PGYs
// Only assign preferred vacation pairs - no random assignments
export type VacationSolveResult = {
  byFellow: FellowSchedule;
  success: boolean;
  conflicts?: string[];
  tried?: number;
  partialAssignments?: string[]; // Fellows who got < 2 vacations
};

export function buildVacationScheduleForPGY(
  fellows: Fellow[],
  blocks: BlockInfo[],
  minOrOpts?: number | { randomize?: boolean; maxAttempts?: number; timeout?: number },
  maybeOpts?: { randomize?: boolean; maxAttempts?: number; timeout?: number }
): VacationSolveResult {
  const opts = (typeof minOrOpts === "object" && minOrOpts !== null ? minOrOpts : maybeOpts) || {};
  const randomize = !!opts.randomize;
  const maxAttempts = opts.maxAttempts || 10000;
  const timeout = opts.timeout || 30000; // 30 seconds
  const minSpacingBlocks = typeof minOrOpts === "number" ? minOrOpts : VACATION_MIN_SPACING_BLOCKS;

  const blockKeys = blocks.map((b) => b.key);
  const indexByKey = new Map<string, number>(blockKeys.map((k, i) => [k, i] as const));
  const N = fellows.length;

  // Get existing vacation counts across all PGYs
  const crossPGYCounts = getAllPGYVacationCounts();

  function spaced(a: string, b: string) {
    const ia = indexByKey.get(a) ?? -1;
    const ib = indexByKey.get(b) ?? -1;
    if (ia < 0 || ib < 0) return false;
    const diff = Math.abs(ia - ib);
    return diff >= minSpacingBlocks;
  }

  // Prepare candidates - ONLY preference-based pairs
  const allKeysSet = new Set(blockKeys);
  const byFellowCandidates = fellows.map((f) => {
    const prefs = Array.from(new Set((f.vacationPrefs || []).filter((k): k is string => !!k && allKeysSet.has(k))));

    // Only preference-based pairs (pref,pref)
    const prefPref: [string, string][] = [];
    for (let i = 0; i < prefs.length; i++) {
      for (let j = i + 1; j < prefs.length; j++) {
        if (spaced(prefs[i], prefs[j])) prefPref.push([prefs[i], prefs[j]]);
      }
    }

    // Single preference blocks for partial assignments
    const singlePrefs: [string][] = prefs.map(p => [p]);

    // Combine pairs and singles, with pairs preferred
    const allOptions = [...prefPref.map(p => ({ blocks: p, score: 0 })), ...singlePrefs.map(p => ({ blocks: p, score: 1000 }))];

    // Sort by preference score (pairs first)
    allOptions.sort((a, b) => a.score - b.score);

    return { fellow: f, options: allOptions, prefPairCount: prefPref.length };
  });

  // Order fellows: most constrained first
  const order = [...byFellowCandidates]
    .map((c, idx) => ({ ...c, idx }))
    .sort((a, b) => {
      const cmp = (a.prefPairCount - b.prefPairCount) || (a.options.length - b.options.length);
      if (cmp !== 0) return cmp;
      return randomize ? Math.random() - 0.5 : 0;
    });

  // Multi-restart algorithm with enhanced diagnostics
  const startTime = Date.now();
  let bestResult: VacationSolveResult | null = null;
  let totalTried = 0;
  const diagnostics: string[] = [];

  function tryWithOrdering(fellowOrder: typeof order, attemptNum: number): VacationSolveResult | null {
    const usedCount = new Map<string, number>();
    const byFellow: FellowSchedule = {};
    const partialAssignments: string[] = [];
    let tried = 0;
    const attemptStart = Date.now();

    function backtrack(i: number): boolean {
      if (Date.now() - startTime > timeout) return false; // Timeout check
      if (tried > maxAttempts / 5) return false; // Per-attempt limit
      
      if (i >= N) return true;
      const { fellow, options } = fellowOrder[i];

      // Try to assign vacation options (pairs first, then singles)
      for (const option of options) {
        const blocks = option.blocks;
        
        // Check if all blocks in this option are available
        const canAssign = blocks.every(block => {
          const currentUsed = usedCount.get(block) || 0;
          const crossPGYUsed = crossPGYCounts[block] || 0;
          return currentUsed < 2 && (currentUsed + crossPGYUsed) < 2;
        });

        if (!canAssign) continue;

        // Assign blocks
        const fellowRow: Record<string, string> = {};
        for (const block of blocks) {
          fellowRow[block] = "VAC";
          usedCount.set(block, (usedCount.get(block) || 0) + 1);
        }
        
        byFellow[fellow.id] = fellowRow;
        
        // Track partial assignments (< 2 vacations)
        if (blocks.length < 2) {
          partialAssignments.push(fellow.name || fellow.id);
        }
        
        tried++;
        
        if (backtrack(i + 1)) return true;
        
        // Undo assignment
        for (const block of blocks) {
          const count = usedCount.get(block) || 0;
          if (count <= 1) {
            usedCount.delete(block);
          } else {
            usedCount.set(block, count - 1);
          }
        }
        delete byFellow[fellow.id];
        
        // Remove from partial assignments if it was added
        if (blocks.length < 2) {
          const index = partialAssignments.indexOf(fellow.name || fellow.id);
          if (index > -1) partialAssignments.splice(index, 1);
        }
      }
      
      // If no vacation assignment worked, try with no vacations for this fellow
      if (backtrack(i + 1)) return true;
      
      return false;
    }

    const success = backtrack(0);
    
    // Ensure all fellows have an entry (even if empty)
    for (const f of fellows) {
      if (!byFellow[f.id]) byFellow[f.id] = {};
    }

    const duration = Date.now() - attemptStart;
    diagnostics.push(`Attempt ${attemptNum}: ${success ? 'SUCCESS' : 'FAILED'} in ${duration}ms, tried ${tried} assignments`);

    if (success) {
      return { byFellow, success: true, tried, partialAssignments };
    }

    return null;
  }

  // Try multiple restart strategies
  const strategies = [
    { name: "mostConstrained", order: [...order] },
    { name: "leastConstrained", order: [...order].reverse() },
    { name: "random1", order: [...order].sort(() => Math.random() - 0.5) },
    { name: "random2", order: [...order].sort(() => Math.random() - 0.5) },
    { name: "byPreferenceCount", order: [...order].sort((a, b) => b.prefPairCount - a.prefPairCount) }
  ];

  for (let i = 0; i < strategies.length && Date.now() - startTime < timeout; i++) {
    const strategy = strategies[i];
    diagnostics.push(`Trying strategy: ${strategy.name}`);
    
    const result = tryWithOrdering(strategy.order, i + 1);
    totalTried += result?.tried || 0;
    
    if (result) {
      bestResult = result;
      bestResult.tried = totalTried;
      diagnostics.push(`SUCCESS with strategy: ${strategy.name}`);
      break;
    }
  }

  if (bestResult) {
    return bestResult;
  }

  // Build enhanced diagnostics for failure
  const conflicts: string[] = [...diagnostics];
  
  // Analyze constraint conflicts
  const constraintAnalysis: string[] = [];
  for (const c of order) {
    if (c.options.length === 0) {
      constraintAnalysis.push(`${c.fellow.name || c.fellow.id}: no valid vacation preferences (need 6+ block spacing)`);
    } else if (c.prefPairCount === 0) {
      constraintAnalysis.push(`${c.fellow.name || c.fellow.id}: no preference pairs with valid spacing`);
    }
  }
  
  // Check cross-PGY vacation density
  const blockConstraints: string[] = [];
  const highUsageBlocks = Object.entries(crossPGYCounts).filter(([, count]) => count >= 1);
  if (highUsageBlocks.length > 0) {
    blockConstraints.push(`Cross-PGY constraint blocks: ${highUsageBlocks.map(([block, count]) => `${block}(${count})`).join(', ')}`);
  }
  
  conflicts.push(...constraintAnalysis, ...blockConstraints);
  
  if (conflicts.length === 0) {
    conflicts.push("Algorithm failed - try increasing maxAttempts or timeout, or adjust vacation preferences");
  }

  return { byFellow: {}, success: false, conflicts, tried: totalTried, partialAssignments: [] };
}
