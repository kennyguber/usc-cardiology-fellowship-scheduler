export type PGY = "PGY-4" | "PGY-5" | "PGY-6";

export type Fellow = {
  id: string;
  name: string;
  pgy: PGY;
  clinicDay?: "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday";
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

// Helper function to check if a vacation is allowed based on restrictions
function isVacationAllowed(blockKey: string, pgy: PGY): boolean {
  // No fellow can be granted vacation in July
  if (blockKey.startsWith('JUL')) return false;
  
  // No PGY4 fellow can be granted vacation in July or August
  if (pgy === 'PGY-4' && blockKey.startsWith('AUG')) return false;
  
  return true;
}

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
      // Check vacation restrictions
      if (!isVacationAllowed(pref, f.pgy)) continue;
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

// Enhanced multi-phase vacation assignment algorithm
export type VacationSolveResult = {
  byFellow: FellowSchedule;
  success: boolean;
  conflicts?: string[];
  tried?: number;
  partialAssignments?: string[]; // Fellows who got < 2 vacations
  phaseResults?: string[]; // Details from each phase
};

// Helper functions for enhanced algorithm
function getPreferenceScore(blockKey: string, preferences: (string | undefined)[]): number {
  const index = preferences.findIndex(pref => pref === blockKey);
  return index === -1 ? 1000 : index; // Lower score = higher preference
}

function isInFirstHalf(blockKey: string, blocks: BlockInfo[]): boolean {
  const blockIndex = blocks.findIndex(b => b.key === blockKey);
  return blockIndex < blocks.length / 2;
}

function hasBalancedDistribution(assignments: string[], blocks: BlockInfo[]): boolean {
  if (assignments.length !== 2) return true;
  const firstHalf = assignments.some(block => isInFirstHalf(block, blocks));
  const secondHalf = assignments.some(block => !isInFirstHalf(block, blocks));
  return firstHalf && secondHalf;
}

export function buildVacationScheduleForPGY(
  fellows: Fellow[],
  blocks: BlockInfo[],
  minOrOpts?: number | { randomize?: boolean; maxAttempts?: number; timeout?: number },
  maybeOpts?: { randomize?: boolean; maxAttempts?: number; timeout?: number }
): VacationSolveResult {
  const opts = (typeof minOrOpts === "object" && minOrOpts !== null ? minOrOpts : maybeOpts) || {};
  const randomize = !!opts.randomize;
  const maxAttempts = opts.maxAttempts || 50000;
  const timeout = opts.timeout || 120000; // 2 minutes
  const initialMinSpacing = typeof minOrOpts === "number" ? minOrOpts : VACATION_MIN_SPACING_BLOCKS;

  const blockKeys = blocks.map((b) => b.key);
  const indexByKey = new Map<string, number>(blockKeys.map((k, i) => [k, i] as const));
  const allKeysSet = new Set(blockKeys);
  const startTime = Date.now();
  const phaseResults: string[] = [];

  // Get existing vacation counts across all PGYs
  const crossPGYCounts = getAllPGYVacationCounts();

  function hasSpacing(a: string, b: string, minSpacing: number): boolean {
    const ia = indexByKey.get(a) ?? -1;
    const ib = indexByKey.get(b) ?? -1;
    if (ia < 0 || ib < 0) return false;
    return Math.abs(ia - ib) >= minSpacing;
  }

  // Prepare fellow data with enhanced preference analysis
  const fellowData = fellows.map((f) => {
    const validPrefs = (f.vacationPrefs || [])
      .map((pref, index) => ({ pref, index }))
      .filter(({ pref }) => pref && allKeysSet.has(pref) && isVacationAllowed(pref, f.pgy))
      .map(({ pref, index }) => ({ block: pref!, preferenceScore: index }));

    return { fellow: f, validPrefs, vacationCount: 0, assignments: [] as string[] };
  });

  const result: FellowSchedule = {};
  const usedCount = new Map<string, number>();
  let totalTried = 0;

  // Initialize empty schedules
  for (const f of fellows) {
    result[f.id] = {};
  }

  // Phase 1: Primary preference pairs with optimal spacing
  phaseResults.push("Phase 1: Assigning preference pairs with 6-block spacing");
  let phase1Success = 0;
  
  for (const data of fellowData.sort((a, b) => a.validPrefs.length - b.validPrefs.length)) {
    if (Date.now() - startTime > timeout) break;
    
    const { fellow, validPrefs } = data;
    if (validPrefs.length < 2) continue;

    // Find best preference pair with 6-block spacing
    let bestPair: { blocks: [string, string]; score: number } | null = null;
    
    for (let i = 0; i < validPrefs.length && !bestPair; i++) {
      for (let j = i + 1; j < validPrefs.length; j++) {
        const block1 = validPrefs[i].block;
        const block2 = validPrefs[j].block;
        
        if (!hasSpacing(block1, block2, 6)) continue;
        
        const canAssign = [block1, block2].every(block => {
          const currentUsed = usedCount.get(block) || 0;
          const crossPGYUsed = crossPGYCounts[block] || 0;
          // Allow up to 2 fellows per PGY and up to 2 total across all PGY levels
          return currentUsed < 2 && (currentUsed + crossPGYUsed) <= 2;
        });
        
        if (canAssign) {
          const score = validPrefs[i].preferenceScore + validPrefs[j].preferenceScore;
          const balanced = hasBalancedDistribution([block1, block2], blocks);
          bestPair = { blocks: [block1, block2], score: score - (balanced ? 10 : 0) };
          break;
        }
      }
    }

    if (bestPair) {
      for (const block of bestPair.blocks) {
        result[fellow.id][block] = "VAC";
        usedCount.set(block, (usedCount.get(block) || 0) + 1);
        data.assignments.push(block);
      }
      data.vacationCount = 2;
      phase1Success++;
      totalTried++;
    }
  }
  
  phaseResults.push(`Phase 1 completed: ${phase1Success} fellows got 2 vacations`);

  // Phase 2: Single preferences for remaining fellows and those with only 1 vacation
  phaseResults.push("Phase 2: Assigning single preferences");
  let phase2Success = 0;
  
  const fellowsNeedingMore = fellowData
    .filter(data => data.vacationCount < 2)
    .sort((a, b) => (a.vacationCount - b.vacationCount) || (a.validPrefs.length - b.validPrefs.length));
  
  for (const data of fellowsNeedingMore) {
    if (Date.now() - startTime > timeout) break;
    
    const { fellow, validPrefs, assignments } = data;
    const remainingSlots = 2 - data.vacationCount;
    let assigned = 0;
    
    // Sort preferences by score, prioritizing first half/second half balance
    const sortedPrefs = validPrefs
      .filter(({ block }) => !assignments.includes(block))
      .sort((a, b) => {
        const balanceBonus = (pref: typeof a) => {
          if (assignments.length === 1) {
            const existingInFirstHalf = isInFirstHalf(assignments[0], blocks);
            const thisInFirstHalf = isInFirstHalf(pref.block, blocks);
            return existingInFirstHalf !== thisInFirstHalf ? -5 : 0;
          }
          return 0;
        };
        return (a.preferenceScore + balanceBonus(a)) - (b.preferenceScore + balanceBonus(b));
      });

    for (const { block } of sortedPrefs) {
      if (assigned >= remainingSlots) break;
      
      // Check spacing with existing assignments
      const hasValidSpacing = assignments.every(existing => hasSpacing(block, existing, 6));
      if (!hasValidSpacing) continue;
      
      // Check availability
      const currentUsed = usedCount.get(block) || 0;
      const crossPGYUsed = crossPGYCounts[block] || 0;
      if (currentUsed >= 2 || (currentUsed + crossPGYUsed) > 2) continue;
      
      result[fellow.id][block] = "VAC";
      usedCount.set(block, currentUsed + 1);
      data.assignments.push(block);
      data.vacationCount++;
      assigned++;
      totalTried++;
    }
    
    if (assigned > 0) phase2Success++;
  }
  
  phaseResults.push(`Phase 2 completed: ${phase2Success} additional fellows got vacations`);

  // Phase 3: Progressive constraint relaxation for remaining fellows
  phaseResults.push("Phase 3: Progressive constraint relaxation");
  let phase3Success = 0;
  const spacingLevels = [5, 4, 3]; // Progressively relax spacing requirements
  
  for (const minSpacing of spacingLevels) {
    if (Date.now() - startTime > timeout) break;
    
    const stillNeedingVacations = fellowData.filter(data => data.vacationCount === 0);
    if (stillNeedingVacations.length === 0) break;
    
    phaseResults.push(`Phase 3.${6-minSpacing}: Trying ${minSpacing}-block minimum spacing`);
    
    for (const data of stillNeedingVacations) {
      const { fellow, validPrefs } = data;
      
      // Try to find any pair with the current spacing requirement
      let bestAssignment: string[] | null = null;
      let bestScore = Infinity;
      
      for (let i = 0; i < validPrefs.length && !bestAssignment; i++) {
        for (let j = i + 1; j < validPrefs.length; j++) {
          const block1 = validPrefs[i].block;
          const block2 = validPrefs[j].block;
          
          if (!hasSpacing(block1, block2, minSpacing)) continue;
          
          // Allow slightly more flexible cross-PGY limits in this phase
          const canAssign = [block1, block2].every(block => {
            const currentUsed = usedCount.get(block) || 0;
            const crossPGYUsed = crossPGYCounts[block] || 0;
            return currentUsed < 2 && (currentUsed + crossPGYUsed) <= 2; // Allow exactly 2 total
          });
          
          if (canAssign) {
            const score = validPrefs[i].preferenceScore + validPrefs[j].preferenceScore;
            if (score < bestScore) {
              bestScore = score;
              bestAssignment = [block1, block2];
            }
          }
        }
      }
      
      if (bestAssignment) {
        for (const block of bestAssignment) {
          result[fellow.id][block] = "VAC";
          usedCount.set(block, (usedCount.get(block) || 0) + 1);
          data.assignments.push(block);
        }
        data.vacationCount = 2;
        phase3Success++;
        totalTried++;
      }
    }
  }
  
  phaseResults.push(`Phase 3 completed: ${phase3Success} fellows got vacations with relaxed spacing`);

  // Phase 4: Final single assignments for any remaining fellows
  phaseResults.push("Phase 4: Final single vacation assignments");
  let phase4Success = 0;
  
  const finalUnassigned = fellowData.filter(data => data.vacationCount === 0);
  for (const data of finalUnassigned) {
    if (Date.now() - startTime > timeout) break;
    
    const { fellow, validPrefs } = data;
    
    // Just try to get them one vacation from their preferences
    for (const { block } of validPrefs.sort((a, b) => a.preferenceScore - b.preferenceScore)) {
      const currentUsed = usedCount.get(block) || 0;
      const crossPGYUsed = crossPGYCounts[block] || 0;
      
      // Very relaxed constraints for final assignments
      if (currentUsed < 2 && (currentUsed + crossPGYUsed) <= 2) {
        result[fellow.id][block] = "VAC";
        usedCount.set(block, currentUsed + 1);
        data.assignments.push(block);
        data.vacationCount = 1;
        phase4Success++;
        totalTried++;
        break;
      }
    }
  }
  
  phaseResults.push(`Phase 4 completed: ${phase4Success} fellows got at least one vacation`);

  // Calculate success metrics
  const fellowsWith2Vacations = fellowData.filter(data => data.vacationCount === 2).length;
  const fellowsWith1Vacation = fellowData.filter(data => data.vacationCount === 1).length;
  const fellowsWith0Vacations = fellowData.filter(data => data.vacationCount === 0).length;
  
  phaseResults.push(`Final results: ${fellowsWith2Vacations} fellows with 2 vacations, ${fellowsWith1Vacation} with 1 vacation, ${fellowsWith0Vacations} with 0 vacations`);
  
  const partialAssignments = fellowData
    .filter(data => data.vacationCount > 0 && data.vacationCount < 2)
    .map(data => data.fellow.name || data.fellow.id);

  const conflicts = fellowsWith0Vacations > 0 ? 
    [`${fellowsWith0Vacations} fellows could not be assigned any vacations`] : [];

  return {
    byFellow: result,
    success: fellowsWith0Vacations === 0,
    conflicts: conflicts.length > 0 ? conflicts : undefined,
    tried: totalTried,
    partialAssignments,
    phaseResults
  };
}
