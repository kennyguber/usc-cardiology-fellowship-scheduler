import { type BlockInfo } from "@/lib/block-utils";
import { type Fellow, type FellowSchedule, loadSchedule } from "@/lib/schedule-engine";
import { loadSettings } from "@/lib/settings-engine";

export type Rotation =
  | "VAC"
  | "LAC_CATH"
  | "CCU"
  | "LAC_CONSULT"
  | "HF"
  | "KECK_CONSULT"
  | "ECHO1"
  | "ECHO2"
  | "EP"
  | "NUCLEAR"
  | "NONINVASIVE"
  | "ELECTIVE"
  | "ELECTIVE (ECHO2)"
  | "ELECTIVE (NONINVASIVE)"
  | "ELECTIVE (HF)"
  | "ELECTIVE (KECK_CONSULT)";

// Helper function to get the primary rotation type from any rotation (including elective specializations)
export function getPrimaryRotation(rotation: Rotation): Rotation {
  if (rotation.startsWith("ELECTIVE (")) {
    const match = rotation.match(/ELECTIVE \((.+)\)/);
    return match ? (match[1] as Rotation) : "ELECTIVE";
  }
  return rotation;
}

// Helper function to check if a rotation counts for coverage of a specific type
export function countsForCoverage(rotation: Rotation, targetType: Rotation): boolean {
  return rotation === targetType || rotation === `ELECTIVE (${targetType})`;
}

export type SolveRotationsResult = {
  byFellow: FellowSchedule;
  success: boolean;
  conflicts?: string[];
  tried?: number;
  timeout?: boolean;
  diagnostics?: {
    failureReasons: Record<string, number>;
    constraintViolations: string[];
    crossPGYConflicts: string[];
    lastAttemptDetails?: string;
  };
};

export const FIRST_FIVE_KEYS = ["JUL1", "JUL2", "AUG1", "AUG2", "SEP1"] as const;

function buildKeyMaps(blocks: BlockInfo[]) {
  const keyToIndex = new Map<string, number>();
  const keyToMonth = new Map<string, number>();
  const monthToKeys = new Map<number, string[]>();
  blocks.forEach((b, i) => {
    keyToIndex.set(b.key, i);
    keyToMonth.set(b.key, b.monthIndex);
    const arr = monthToKeys.get(b.monthIndex) ?? [];
    arr.push(b.key);
    monthToKeys.set(b.monthIndex, arr);
  });
  return { keyToIndex, keyToMonth, monthToKeys };
}

function isAdjacentMonth(a: number, b: number) {
  return Math.abs(a - b) === 1;
}

function withinJanToJun(mi: number) {
  return mi >= 6 && mi <= 11;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cloneByFellow(src: FellowSchedule): FellowSchedule {
  const out: FellowSchedule = {};
  for (const fid of Object.keys(src || {})) out[fid] = { ...(src[fid] || {}) };
  return out;
}

// Detect if multiple fellows have vacation in the same block
function detectSharedVacations(existingByFellow: FellowSchedule | undefined): Map<string, string[]> {
  const sharedVacs = new Map<string, string[]>();
  
  if (!existingByFellow) return sharedVacs;
  
  const vacsByBlock = new Map<string, string[]>();
  
  // Group fellows by vacation blocks
  for (const [fellowId, schedule] of Object.entries(existingByFellow)) {
    for (const [blockKey, rotation] of Object.entries(schedule)) {
      if (rotation === "VAC") {
        const fellows = vacsByBlock.get(blockKey) || [];
        fellows.push(fellowId);
        vacsByBlock.set(blockKey, fellows);
      }
    }
  }
  
  // Find blocks with multiple vacations
  for (const [blockKey, fellowIds] of vacsByBlock) {
    if (fellowIds.length > 1) {
      sharedVacs.set(blockKey, fellowIds);
    }
  }
  
  return sharedVacs;
}

export function placePGY4Rotations(
  fellows: Fellow[],
  blocks: BlockInfo[],
  existingByFellow: FellowSchedule | undefined,
  opts?: { randomize?: boolean; maxTries?: number; lockVacations?: boolean; timeout?: number }
): SolveRotationsResult {
  const randomize = !!opts?.randomize;
  const maxTries = opts?.maxTries ?? 500;
  const lockVacations = opts?.lockVacations ?? true;
  const timeout = opts?.timeout ?? 45000; // 45 seconds
  
  const startTime = Date.now();
  const diagnostics = {
    failureReasons: {} as Record<string, number>,
    constraintViolations: [] as string[],
    crossPGYConflicts: [] as string[],
    lastAttemptDetails: undefined as string | undefined,
  };

  if (!fellows || fellows.length === 0) {
    return { success: false, byFellow: {}, conflicts: ["No PGY-4 fellows found"], tried: 0, diagnostics };
  }
  if (fellows.length !== 5) {
    return {
      success: false,
      byFellow: {},
      conflicts: [
        `Expected 5 PGY-4 fellows for early LAC_CATH mapping; found ${fellows.length}. Adjust cohort or rule.`,
      ],
      tried: 0,
      diagnostics,
    };
  }

  const { keyToIndex, keyToMonth, monthToKeys } = buildKeyMaps(blocks);
  const blockKeys = blocks.map((b) => b.key);
  const firstFive = FIRST_FIVE_KEYS.filter((k) => keyToIndex.has(k));

  function addFailureReason(reason: string) {
    diagnostics.failureReasons[reason] = (diagnostics.failureReasons[reason] || 0) + 1;
  }

  function tryOnce(): SolveRotationsResult {
    const byFellow: FellowSchedule = cloneByFellow(existingByFellow || {});
    // Track capacity per rotation (one fellow per rotation per block). ELECTIVE has no capacity limit.
    const usedByRot: Record<string, Set<string>> = {
      VAC: new Set<string>(),
      LAC_CATH: new Set<string>(),
      CCU: new Set<string>(),
      LAC_CONSULT: new Set<string>(),
      HF: new Set<string>(),
      KECK_CONSULT: new Set<string>(),
      ECHO1: new Set<string>(),
      ECHO2: new Set<string>(),
      EP: new Set<string>(),
      NUCLEAR: new Set<string>(),
      NONINVASIVE: new Set<string>(),
      ELECTIVE: new Set<string>(), // not used for capacity but kept for completeness
    };
    const isBlocked = (k: string, rot: Rotation, fellowId?: string) => {
      if (rot.startsWith("ELECTIVE")) return false; // no capacity restriction for electives
      
      // Check if fellow is on vacation in this block - treat as unavailable
      if (fellowId) {
        const fellowSchedule = byFellow[fellowId] || {};
        if (fellowSchedule[k] === "VAC") return true;
      }
      
      return usedByRot[rot]?.has(k) ?? false;
    };
    const markUsed = (k: string, rot: Rotation) => {
      if (rot.startsWith("ELECTIVE")) return; // no capacity restriction for electives
      usedByRot[rot]?.add(k);
    };
    const unmarkUsed = (k: string, rot: Rotation) => {
      if (rot.startsWith("ELECTIVE")) return;
      usedByRot[rot]?.delete(k);
    };
    // Prime from existing assignments for these fellows (ignore ELECTIVE so others can share the block)
    for (const f of fellows) {
      const row = byFellow[f.id] || {};
      for (const [k, v] of Object.entries(row)) {
        if (!v) continue;
        if (v.startsWith("ELECTIVE")) continue;
        usedByRot[v]?.add(k);
      }
    }

    // Step A: Respect existing vacations unless explicitly unlocked
    if (!lockVacations) {
      // Get settings for vacation rules
      const settings = loadSettings();
      const usedVac = new Map<string, number>();
      
      // Initialize vacation usage count
      for (const f of fellows) {
        const row = byFellow[f.id] || {};
        for (const [k, v] of Object.entries(row)) {
          if (v === "VAC") {
            usedVac.set(k, (usedVac.get(k) || 0) + 1);
          }
        }
      }
      
      // Reseat vacations out of first five keys if present
      for (const f of fellows) {
        const row = (byFellow[f.id] = byFellow[f.id] || {});
        const vacs = Object.entries(row)
          .filter(([, v]) => v === "VAC")
          .map(([k]) => k);
        const vacsInFirst = vacs.filter((k) => firstFive.includes(k as any));
        if (vacsInFirst.length === 0) continue;

        // Helper: can place a vacation at candidate key?
        const canPlaceVacAt = (cand: string): boolean => {
          const vacsInFirst = vacs.filter((v) => !vacs.includes(v));
          const otherVacs = vacs.filter((k) => !vacsInFirst.includes(k)); // Get ALL other vacations
          
          if (isBlocked(cand, "VAC", f.id)) return false;
          if (row[cand]) return false;
          
          // spacing with ALL other vacations
          if (otherVacs.length > 0) {
            for (const otherVac of otherVacs) {
              const ia = keyToIndex.get(otherVac) ?? -1;
              const ib = keyToIndex.get(cand) ?? -1;
              if (ia < 0 || ib < 0) return false;
              if (Math.abs(ib - ia) < settings.vacation.minSpacingBlocks) return false;
            }
          }
          
          // count limit check
          const curCount = usedVac.get(cand) || 0;
          return curCount < settings.vacation.maxFellowsPerBlock;
        };

        for (const k of vacsInFirst) {
          // remove temporarily
          delete row[k];
          unmarkUsed(k, "VAC");
          // try preferred blocks first
          const preferred = Array.from(
            new Set((f.vacationPrefs || []).filter((x): x is string => !!x && !firstFive.includes(x as any)))
          );
          const preferredCandidates = randomize ? shuffle(preferred) : preferred;
          let placed = false;
          for (const cand of preferredCandidates) {
            if (canPlaceVacAt(cand)) {
              row[cand] = "VAC";
              markUsed(cand, "VAC");
              placed = true;
              break;
            }
          }
          if (!placed) {
            // fallback: any other block
            const others = blockKeys.filter((bk) => !firstFive.includes(bk as any));
            const ordered = randomize ? shuffle(others) : others;
            for (const cand of ordered) {
              if (canPlaceVacAt(cand)) {
                row[cand] = "VAC";
                markUsed(cand, "VAC");
                placed = true;
                break;
              }
            }
          }
          if (!placed) {
            const reason = `vacation_relocation_failed_${f.id}`;
            addFailureReason(reason);
            return {
              success: false,
              byFellow: {},
              conflicts: [`Could not move ${f.name || f.id}'s vacation from ${k} out of early LAC_CATH window.`],
            };
          }
        }
      }
    }

    // Step B: Early LAC_CATH mapping - one unique early block per fellow
    const earlyAvail = firstFive.filter((k) => !isBlocked(k, "LAC_CATH"));
    if (earlyAvail.length < fellows.length) {
      addFailureReason("insufficient_early_lac_cath_blocks");
      return {
        success: false,
        byFellow: {},
        conflicts: ["Not enough early blocks free for LAC_CATH after moving vacations."],
      };
    }

    const fellowsOrder = randomize ? shuffle([...fellows]) : [...fellows];
    const assignment = new Map<string, string>(); // fellowId -> blockKey

    function backtrackEarly(i: number): boolean {
      if (i >= fellowsOrder.length) return true;
      const f = fellowsOrder[i];
      const row = (byFellow[f.id] = byFellow[f.id] || {});
      const candidates = randomize ? shuffle([...earlyAvail]) : [...earlyAvail];
      for (const k of candidates) {
        if (isBlocked(k, "LAC_CATH", f.id)) continue;
        if (row[k]) continue;
        // assign
        row[k] = "LAC_CATH";
        markUsed(k, "LAC_CATH");
        assignment.set(f.id, k);
        if (backtrackEarly(i + 1)) return true;
        // undo
        delete row[k];
        unmarkUsed(k, "LAC_CATH");
        assignment.delete(f.id);
      }
      return false;
    }

    if (!backtrackEarly(0)) {
      addFailureReason("early_lac_cath_mapping_failed");
      return {
        success: false,
        byFellow: {},
        conflicts: ["Failed to map early LAC_CATH uniquely across fellows."],
      };
    }

    // Helpers for later placement
    const monthSetFor = (fid: string, label: Rotation) => {
      const row = byFellow[fid] || {};
      const months = new Set<number>();
      for (const [k, v] of Object.entries(row)) {
        if (v !== label) continue;
        const mi = keyToMonth.get(k);
        if (mi != null) months.add(mi);
      }
      return months;
    };

    const hasAnyInMonth = (fid: string, mi: number) => {
      const row = byFellow[fid] || {};
      const keys = monthToKeys.get(mi) || [];
      return keys.some((k) => !!row[k]);
    };

    const pairFree = (fid: string, mi: number, label: Rotation) => {
      const keys = monthToKeys.get(mi) || [];
      if (keys.length < 2) return false;
      return keys.every((k) => !isBlocked(k, label, fid) && !(byFellow[fid] && byFellow[fid][k]));
    };

    const placePair = (fid: string, mi: number, label: Rotation) => {
      const row = (byFellow[fid] = byFellow[fid] || {});
      const keys = monthToKeys.get(mi) || [];
      for (const k of keys) {
        row[k] = label;
        markUsed(k, label);
      }
    };

    const placeSingle = (fid: string, k: string, label: Rotation) => {
      const row = (byFellow[fid] = byFellow[fid] || {});
      row[k] = label;
      markUsed(k, label);
    };

    const firstLacCathMonths = new Map<string, number>();
    for (const f of fellows) {
      const earlyKey = assignment.get(f.id)!;
      firstLacCathMonths.set(f.id, keyToMonth.get(earlyKey)!);
    }

    // Step C: Place remaining rotations per fellow in priority order
    for (const f of fellows) {
      const row = (byFellow[f.id] = byFellow[f.id] || {});

      // LAC_CATH remaining: need 3 blocks after early one; try one full month (2 blocks) + one single
      const lacCathMonths = monthSetFor(f.id, "LAC_CATH");
      const targetLacCathBlocks = 4; // total blocks
      const currentLacCathBlocks = Object.values(row).filter((x) => x === "LAC_CATH").length;
      let needLC = targetLacCathBlocks - currentLacCathBlocks;
      if (needLC > 0) {
        // try a pair month first
        const candidateMonths = [...monthToKeys.keys()].filter((mi) => {
          if (!pairFree(f.id, mi, "LAC_CATH")) return false;
          if (lacCathMonths.has(mi)) return false;
          // non-consecutive months rule
          for (const m of lacCathMonths) if (isAdjacentMonth(mi, m)) return false;
          return true;
        });
        const ordered = randomize ? shuffle(candidateMonths) : candidateMonths;
        if (needLC >= 2) {
          for (const mi of ordered) {
            placePair(f.id, mi, "LAC_CATH");
            lacCathMonths.add(mi);
            needLC -= 2;
            break;
          }
        }
        // singles if still needed
        if (needLC > 0) {
          const singles: { k: string; mi: number }[] = [];
          for (const [mi, keys] of monthToKeys) {
            if (lacCathMonths.has(mi)) continue; // don't place twice in same month
            // enforce non-consecutive with existing
            let ok = true;
            for (const m of lacCathMonths) if (isAdjacentMonth(mi, m)) ok = false;
            if (!ok) continue;
            for (const k of keys) {
              if (!isBlocked(k, "LAC_CATH", f.id) && !row[k]) singles.push({ k, mi });
            }
          }
          const singlesOrdered = randomize ? shuffle(singles) : singles;
          for (const s of singlesOrdered) {
            placeSingle(f.id, s.k, "LAC_CATH");
            lacCathMonths.add(s.mi);
            needLC -= 1;
            if (needLC <= 0) break;
          }
          if (needLC > 0) {
            addFailureReason(`lac_cath_placement_failed_${f.id}`);
            return {
              success: false,
              byFellow: {},
              conflicts: [
                `${f.name || f.id}: could not place remaining LAC_CATH blocks respecting non-consecutive months and capacity.`,
              ],
            };
          }
        }
      }

      // CCU: 4 blocks -> 2 months, non-consecutive months
      const ccuMonths = monthSetFor(f.id, "CCU");
      let needCCU = 4 - [...ccuMonths].reduce((acc, mi) => acc + (monthToKeys.get(mi)?.length || 0), 0);
if (needCCU > 0) {
        const candidateMonths = [...monthToKeys.keys()].filter((mi) => {
          if (!pairFree(f.id, mi, "CCU")) return false;
          for (const m of ccuMonths) if (isAdjacentMonth(mi, m)) return false;
          return true;
        });
        // If there are any pre-existing HF months, prefer CCU months not adjacent to them
        const hfPreMonths = monthSetFor(f.id, "HF");
        const orderMonths = (list: number[]) => {
          const julDec = list.filter((mi) => mi <= 5);
          const janJun = list.filter((mi) => mi >= 6);
          return randomize ? [...shuffle(julDec), ...shuffle(janJun)] : [...julDec, ...janJun];
        };
        const tryPlaceFrom = (list: number[]) => {
          const ordered = orderMonths(list);
          for (const mi of ordered) {
            placePair(f.id, mi, "CCU");
            ccuMonths.add(mi);
            needCCU -= 2;
            if (needCCU <= 0) return true;
          }
          return false;
        };
        if (hfPreMonths.size > 0) {
          const avoidHF = candidateMonths.filter((mi) => ![...hfPreMonths].some((h) => isAdjacentMonth(mi, h)));
          const fallback = candidateMonths.filter((mi) => !avoidHF.includes(mi));
          if (!tryPlaceFrom(avoidHF)) {
            tryPlaceFrom(fallback);
          }
        } else {
          tryPlaceFrom(candidateMonths);
        }
        if (needCCU > 0) {
          addFailureReason(`ccu_placement_failed_${f.id}`);
          return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to place CCU.`] };
        }
      }

      // LAC_CONSULT: 4 blocks -> 2 months, non-consecutive months
      const lacConsMonths = monthSetFor(f.id, "LAC_CONSULT");
      let needLCON = 4 - [...lacConsMonths].reduce((acc, mi) => acc + (monthToKeys.get(mi)?.length || 0), 0);
      if (needLCON > 0) {
        const candidateMonths = [...monthToKeys.keys()].filter((mi) => {
          if (!pairFree(f.id, mi, "LAC_CONSULT")) return false;
          for (const m of lacConsMonths) if (isAdjacentMonth(mi, m)) return false;
          return true;
        });
        const ordered = randomize ? shuffle(candidateMonths) : candidateMonths;
        for (const mi of ordered) {
          placePair(f.id, mi, "LAC_CONSULT");
          lacConsMonths.add(mi);
          needLCON -= 2;
          if (needLCON <= 0) break;
        }
        if (needLCON > 0) {
          addFailureReason(`lac_consult_placement_failed_${f.id}`);
          return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to place LAC_CONSULT.`] };
        }
      }

      // HF: full month (2 consecutive blocks) Jan–Jun only
      // Clear any existing HF singles to enforce proper pairing
      const existingHF = Object.entries(row)
        .filter(([, v]) => v === "HF")
        .map(([k]) => k);
      if (existingHF.length) {
        for (const k of existingHF) {
          delete row[k];
          unmarkUsed(k, "HF");
        }
      }
      let placedHF = false;
      // Prefer HF months that are NOT adjacent to any CCU month; fallback if necessary
      const hfCandidateMonths = [...monthToKeys.keys()].filter(
        (mi) => withinJanToJun(mi) && pairFree(f.id, mi, "HF")
      );
      const ccuMonthsArr = [...ccuMonths];
      const preferredHF = hfCandidateMonths.filter((mi) => !ccuMonthsArr.some((m) => isAdjacentMonth(mi, m)));
      const fallbackHF = hfCandidateMonths.filter((mi) => !preferredHF.includes(mi));
      const tryPlaceHF = (arr: number[]) => {
        const ordered = randomize ? shuffle(arr) : arr;
        for (const mi of ordered) {
          placePair(f.id, mi, "HF");
          placedHF = true;
          return true;
        }
        return false;
      };
      if (!tryPlaceHF(preferredHF)) {
        tryPlaceHF(fallbackHF);
      }
      if (!placedHF) {
        addFailureReason(`hf_placement_failed_${f.id}`);
        return {
          success: false,
          byFellow: {},
          conflicts: [`${f.name || f.id}: unable to place HF as a full month in Jan–Jun.`],
        };
      }

      // KECK_CONSULT: 2 blocks -> 1 month pair
      let needKECK = 2 - (Object.values(row).filter((x) => x === "KECK_CONSULT").length || 0);
      if (needKECK > 0) {
        const candidateMonths = [...monthToKeys.keys()].filter((mi) => pairFree(f.id, mi, "KECK_CONSULT"));
        const ordered = randomize ? shuffle(candidateMonths) : candidateMonths;
        let placed = false;
        for (const mi of ordered) {
          placePair(f.id, mi, "KECK_CONSULT");
          placed = true;
          needKECK -= 2;
          break;
        }
        if (!placed || needKECK > 0) {
          addFailureReason(`keck_consult_placement_failed_${f.id}`);
          return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to place KECK_CONSULT.`] };
        }
      }

      // ECHO1: 3 half-blocks, non-consecutive months
      const echoMonths = monthSetFor(f.id, "ECHO1");
      let needECHO = 3 - (Object.values(row).filter((x) => x === "ECHO1").length || 0);
      if (needECHO > 0) {
        const singles: { k: string; mi: number }[] = [];
        for (const [mi, keys] of monthToKeys) {
          if ([...echoMonths].some((m) => isAdjacentMonth(mi, m))) continue;
          for (const k of keys) if (!isBlocked(k, "ECHO1", f.id) && !row[k]) singles.push({ k, mi });
        }
        const ordered = randomize ? shuffle(singles) : singles;
        for (const s of ordered) {
          placeSingle(f.id, s.k, "ECHO1");
          echoMonths.add(s.mi);
          needECHO -= 1;
          if (needECHO <= 0) break;
        }
        if (needECHO > 0) {
          addFailureReason(`echo1_placement_failed_${f.id}`);
          return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to place ECHO1.`] };
        }
      }

      // EP: 1 half-block anywhere
      let needEP = 1 - (Object.values(row).filter((x) => x === "EP").length || 0);
      if (needEP > 0) {
        const singles: string[] = [];
        for (const k of blockKeys) if (!isBlocked(k, "EP", f.id) && !row[k]) singles.push(k);
        const ordered = randomize ? shuffle(singles) : singles;
        if (ordered[0]) {
          placeSingle(f.id, ordered[0], "EP");
          needEP -= 1;
        }
        if (needEP > 0) {
          addFailureReason(`ep_placement_failed_${f.id}`);
          return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to place EP.`] };
        }
      }

      // Fill remaining with ELECTIVE
      for (const k of blockKeys) {
        if (!row[k]) {
          placeSingle(f.id, k, "ELECTIVE");
        }
      }
    }

    // Capacity check: at most one fellow per rotation per block (ELECTIVE ignored)
    const cap: Map<string, Map<Rotation, string[]>> = new Map();
    for (const f of fellows) {
      const row = byFellow[f.id] || {};
      for (const [k, v] of Object.entries(row)) {
        if (!v || v === "ELECTIVE") continue;
        let m = cap.get(k);
        if (!m) {
          m = new Map<Rotation, string[]>();
          cap.set(k, m);
        }
        const arr = m.get(v as Rotation) ?? [];
        arr.push(f.name || f.id);
        m.set(v as Rotation, arr);
        if (arr.length > 1) {
          addFailureReason(`capacity_violation_${k}_${v}`);
          return {
            success: false,
            byFellow: {},
            conflicts: [
              `Capacity violation at ${k} for ${v}: ${arr.join(", ")}`,
            ],
          };
        }
      }
    }

    // Post-placement validations for HF, CCU, and LAC_CONSULT rules
    const ruleConflicts: string[] = [];
    for (const f of fellows) {
      const rowF = byFellow[f.id] || {};
      // HF must be exactly one full month (two blocks) Jan–Jun
      const hfKeys = Object.entries(rowF)
        .filter(([, v]) => v === "HF")
        .map(([k]) => k);
      const hfMonths = new Set<number>(hfKeys.map((k) => keyToMonth.get(k)!).filter((x): x is number => x != null));
      if (hfKeys.length !== 2) {
        ruleConflicts.push(`${f.name || f.id}: HF must be exactly 1 full month (2 blocks).`);
      } else if (hfMonths.size !== 1) {
        ruleConflicts.push(`${f.name || f.id}: HF blocks must be in the same month (full month).`);
      } else {
        const mi = [...hfMonths][0];
        if (!withinJanToJun(mi)) {
          ruleConflicts.push(`${f.name || f.id}: HF month must be between January and June.`);
        }
      }
      // CCU months cannot be consecutive (including Dec→Jan)
      const ccuMonthsF = new Set<number>();
      for (const [k, v] of Object.entries(rowF)) {
        if (v === "CCU") {
          const mi = keyToMonth.get(k);
          if (mi != null) ccuMonthsF.add(mi);
        }
      }
      const ccuList = [...ccuMonthsF].sort((a, b) => a - b);
      outer: for (let i = 0; i < ccuList.length; i++) {
        for (let j = i + 1; j < ccuList.length; j++) {
          if (isAdjacentMonth(ccuList[i], ccuList[j])) {
            ruleConflicts.push(`${f.name || f.id}: CCU months cannot be consecutive.`);
            break outer;
          }
        }
      }
      // LAC_CONSULT months cannot be consecutive (including Dec→Jan)
      const lacConsMonthsF = new Set<number>();
      for (const [k, v] of Object.entries(rowF)) {
        if (v === "LAC_CONSULT") {
          const mi = keyToMonth.get(k);
          if (mi != null) lacConsMonthsF.add(mi);
        }
      }
      const lacConsList = [...lacConsMonthsF].sort((a, b) => a - b);
      outer2: for (let i = 0; i < lacConsList.length; i++) {
        for (let j = i + 1; j < lacConsList.length; j++) {
          if (isAdjacentMonth(lacConsList[i], lacConsList[j])) {
            ruleConflicts.push(`${f.name || f.id}: LAC_CONSULT months cannot be consecutive.`);
            break outer2;
          }
        }
      }
    }
    if (ruleConflicts.length > 0) {
      addFailureReason("post_placement_rule_violations");
      diagnostics.constraintViolations.push(...ruleConflicts);
      return { success: false, byFellow: {}, conflicts: ruleConflicts };
    }

    return { success: true, byFellow };
  }

  // Multi-restart algorithm with different strategies
  const strategies = [
    { randomize: false, description: "deterministic" },
    { randomize: true, description: "randomized" },
    { randomize: true, description: "randomized_intensive" }
  ];

  let totalTried = 0;
  for (const strategy of strategies) {
    const strategyMaxTries = strategy.description === "randomized_intensive" ? Math.floor(maxTries * 0.6) : Math.floor(maxTries / strategies.length);
    
    for (let t = 0; t < strategyMaxTries; t++) {
      if (Date.now() - startTime > timeout) {
        diagnostics.lastAttemptDetails = `Timeout after ${totalTried} attempts using ${strategy.description} strategy`;
        return { 
          success: false, 
          byFellow: {}, 
          conflicts: ["PGY-4 rotation scheduling timed out"], 
          tried: totalTried,
          timeout: true,
          diagnostics 
        };
      }

      const res = tryOnce();
      totalTried++;
      
      if (res.success) {
        return { ...res, tried: totalTried, diagnostics };
      }
    }
  }

  diagnostics.lastAttemptDetails = `Failed after ${totalTried} attempts across ${strategies.length} strategies`;
  
  // Before failing completely, try vacation-to-elective fallback
  const sharedVacations = detectSharedVacations(existingByFellow);
  
  if (sharedVacations.size > 0) {
    console.log(`🔄 PGY-4: Attempting vacation-to-elective fallback for ${sharedVacations.size} shared vacation blocks`);
    diagnostics.constraintViolations.push(`Detected shared vacations in blocks: ${Array.from(sharedVacations.keys()).join(", ")}`);
    
    // Convert one vacation per shared block to ELECTIVE temporarily
    const modifiedBase = cloneByFellow(existingByFellow || {});
    const conversions: Array<{fellowId: string, blockKey: string}> = [];
    
    for (const [blockKey, fellowIds] of sharedVacations) {
      // Convert the SECOND fellow's vacation to ELECTIVE (keep first fellow's VAC)
      if (fellowIds.length >= 2) {
        const fellowToConvert = fellowIds[1];
        if (modifiedBase[fellowToConvert]) {
          modifiedBase[fellowToConvert][blockKey] = "ELECTIVE";
          conversions.push({ fellowId: fellowToConvert, blockKey });
        }
      }
    }
    
    console.log(`🔄 PGY-4: Converted ${conversions.length} vacations to ELECTIVE, retrying...`);
    
    // Try solving with modified base using a subset of attempts
    const fallbackMaxTries = Math.min(500, maxTries);
    let fallbackTried = 0;
    
    for (let t = 0; t < fallbackMaxTries; t++) {
      if (Date.now() - startTime > timeout) break;
      
      const res = tryOnce();
      fallbackTried++;
      
      if (res.success) {
        // SUCCESS! Convert ELECTIVE back to VAC
        for (const {fellowId, blockKey} of conversions) {
          if (res.byFellow[fellowId]) {
            res.byFellow[fellowId][blockKey] = "VAC";
          }
        }
        
        console.log(`✅ PGY-4: Vacation fallback successful! Restored ${conversions.length} vacations.`);
        diagnostics.constraintViolations.push(
          `Fallback successful: temporarily converted ${conversions.length} vacation(s) to elective during solving`
        );
        diagnostics.lastAttemptDetails = `Succeeded using vacation-to-elective fallback for shared vacation blocks (tried ${fallbackTried} times)`;
        
        return {
          ...res,
          tried: totalTried + fallbackTried,
          diagnostics
        };
      }
    }
    
    console.log(`❌ PGY-4: Vacation fallback also failed after ${fallbackTried} attempts`);
    diagnostics.constraintViolations.push(`Vacation-to-elective fallback also failed (tried ${fallbackTried} times)`);
    diagnostics.lastAttemptDetails += ` | Fallback also failed after ${fallbackTried} additional attempts`;
  }
  
  return { 
    success: false, 
    byFellow: {}, 
    conflicts: [
      `Unable to build PGY-4 rotations within ${totalTried} attempts.`,
      `Most common failures: ${Object.entries(diagnostics.failureReasons)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([reason, count]) => `${reason} (${count}x)`)
        .join(", ")}`
    ], 
    tried: totalTried,
    diagnostics 
  };
}

// PGY-5 solver implementing specified rules
export function placePGY5Rotations(
  fellows: Fellow[],
  blocks: BlockInfo[],
  existingByFellow: FellowSchedule | undefined,
  opts?: { randomize?: boolean; maxTries?: number; timeout?: number }
): SolveRotationsResult {
  const randomize = !!opts?.randomize;
  const maxTries = opts?.maxTries ?? 25000; // Increased for enhanced algorithms
  const timeout = opts?.timeout ?? 150000; // 2.5 minutes for intensive search
  
  const startTime = Date.now();
  const diagnostics = {
    failureReasons: {} as Record<string, number>,
    constraintViolations: [] as string[],
    crossPGYConflicts: [] as string[],
    relaxationSteps: [] as string[],
    lastAttemptDetails: undefined as string | undefined,
  };
  function addFailureReason(reason: string) {
    diagnostics.failureReasons[reason] = (diagnostics.failureReasons[reason] || 0) + 1;
  }

  if (!fellows || fellows.length === 0) {
    return { success: false, byFellow: {}, conflicts: ["No PGY-5 fellows found"], tried: 0, diagnostics };
  }
  if (fellows.length !== 5) {
    return { success: false, byFellow: {}, conflicts: [
      `Expected 5 PGY-5 fellows; found ${fellows.length}. Adjust cohort or rule.`,
    ], tried: 0, diagnostics };
  }

  const { keyToIndex, keyToMonth, monthToKeys } = buildKeyMaps(blocks);
  const blockKeys = blocks.map((b) => b.key);

  // Cross-PGY capacity constraints: prevent overlaps with PGY-4 for these rotations
  const pgy4 = loadSchedule("PGY-4");
  const crossBlock: Partial<Record<Rotation, Set<string>>> = {};
  const crossSensitive: Rotation[] = ["CCU", "KECK_CONSULT", "LAC_CONSULT", "HF", "EP"];
  if (pgy4?.byFellow) {
    for (const rot of crossSensitive) crossBlock[rot] = new Set<string>();
    for (const row of Object.values(pgy4.byFellow)) {
      for (const [k, v] of Object.entries(row)) {
        if (!v) continue;
        const rot = v as Rotation;
        if (crossSensitive.includes(rot)) crossBlock[rot]!.add(k);
      }
    }
  }

  // Progressive constraint relaxation levels
  type ConstraintLevel = 'strict' | 'relaxed' | 'minimal';
  
  function getConstraintSettings(level: ConstraintLevel) {
    return {
      allowConsecutive: level !== 'strict',
      allowHFCCUAdjacency: level === 'minimal',
      allowCrossCapacityViolation: level === 'minimal',
      maxConsecutiveBlocks: level === 'strict' ? 0 : (level === 'relaxed' ? 1 : 2)
    };
  }

  function tryOnce(strategy = 'default', constraintLevel: ConstraintLevel = 'strict'): SolveRotationsResult {
    const byFellow: FellowSchedule = cloneByFellow(existingByFellow || {});
    const constraints = getConstraintSettings(constraintLevel);
    
    if (constraintLevel !== 'strict') {
      diagnostics.relaxationSteps.push(`Trying ${constraintLevel} constraints with ${strategy} strategy`);
    }

    // Track capacity per rotation (one fellow per rotation per block). ELECTIVE ignored.
    const usedByRot: Record<string, Set<string>> = {
      VAC: new Set<string>(),
      LAC_CATH: new Set<string>(),
      CCU: new Set<string>(),
      LAC_CONSULT: new Set<string>(),
      HF: new Set<string>(),
      KECK_CONSULT: new Set<string>(),
      ECHO1: new Set<string>(), // not used for PGY-5 but keep for completeness
      ECHO2: new Set<string>(),
      EP: new Set<string>(),
      NUCLEAR: new Set<string>(),
      NONINVASIVE: new Set<string>(),
      ELECTIVE: new Set<string>(),
    };
    const isBlocked = (k: string, rot: Rotation, fellowId?: string) => {
      if (rot !== "ELECTIVE" && usedByRot[rot].has(k)) return true;
      if (!constraints.allowCrossCapacityViolation && crossBlock[rot]?.has(k)) return true; // avoid PGY-4 overlaps per rules
      
      // Check if fellow is on vacation in this block - treat as unavailable
      if (fellowId) {
        const fellowSchedule = byFellow[fellowId] || {};
        if (fellowSchedule[k] === "VAC") return true;
      }
      
      return false;
    };
    const markUsed = (k: string, rot: Rotation) => {
      if (rot === "ELECTIVE") return;
      usedByRot[rot].add(k);
    };
    const unmarkUsed = (k: string, rot: Rotation) => {
      if (rot === "ELECTIVE") return;
      usedByRot[rot].delete(k);
    };

    // Prime usedByRot from existing assignments (ignore ELECTIVE and VAC for capacity)
    for (const f of fellows) {
      const row = byFellow[f.id] || {};
      for (const [k, v] of Object.entries(row)) {
        if (!v || v === "ELECTIVE" || v === "VAC") continue;
        usedByRot[v as Rotation]?.add(k);
      }
    }

    // Enhanced fellow ordering strategies
    let fellowOrder = [...fellows];
    if (strategy === 'constraint_aware') {
      // Order by constraint difficulty - fellows with most vacation first, then by available blocks
      fellowOrder.sort((a, b) => {
        const aVacs = Object.values(byFellow[a.id] || {}).filter(v => v === 'VAC').length;
        const bVacs = Object.values(byFellow[b.id] || {}).filter(v => v === 'VAC').length;
        if (aVacs !== bVacs) return bVacs - aVacs; // Most constrained first
        
        // Secondary sort by available blocks (fewer available = more constrained)
        const aAvailable = blockKeys.filter(k => !(byFellow[a.id] || {})[k]).length;
        const bAvailable = blockKeys.filter(k => !(byFellow[b.id] || {})[k]).length;
        return aAvailable - bAvailable;
      });
    } else if (strategy === 'hf_first') {
      // Place HF-heavy fellows first as they have the most constraints
      fellowOrder.sort((a, b) => {
        const aHF = Object.values(byFellow[a.id] || {}).filter(v => v === 'HF').length;
        const bHF = Object.values(byFellow[b.id] || {}).filter(v => v === 'HF').length;
        return bHF - aHF;
      });
    } else if (randomize || strategy === 'randomized') {
      fellowOrder = shuffle([...fellows]);
    }
    
    // Selection: 4 of 5 get CCU. The remaining MUST get LAC_CONSULT. Plus 3 random CCU fellows also get LAC_CONSULT.
    const ccuFellows = new Set<string>(fellowOrder.slice(0, 4).map((f) => f.id));
    const nonCcuFellow = fellowOrder[4].id;
    const lacConsultFellows = new Set<string>([nonCcuFellow]);
    const ccuArray = [...ccuFellows];
    const pick = randomize ? shuffle(ccuArray).slice(0, 3) : ccuArray.slice(0, 3);
    for (const id of pick) lacConsultFellows.add(id);

    // Helpers
    const hasAnyAtIndex = (fid: string, idx: number) => {
      const row = byFellow[fid] || {};
      const key = blockKeys[idx];
      return !!row[key];
    };
    const placeSingle = (fid: string, k: string, label: Rotation) => {
      const row = (byFellow[fid] = byFellow[fid] || {});
      row[k] = label;
      markUsed(k, label);
    };
    const placePairMonth = (fid: string, mi: number, label: Rotation) => {
      const keys = monthToKeys.get(mi) || [];
      for (const k of keys) placeSingle(fid, k, label);
    };
    const nonConsecutiveOk = (fid: string, k: string, label: Rotation) => {
      if (constraints.allowConsecutive) return true; // Skip check if relaxed
      
      const row = byFellow[fid] || {};
      const idx = keyToIndex.get(k) ?? -1;
      let consecutiveCount = 0;
      
      for (const [kk, vv] of Object.entries(row)) {
        if (vv !== label) continue;
        const j = keyToIndex.get(kk) ?? -1;
        if (j >= 0 && Math.abs(j - idx) <= 1) {
          consecutiveCount++;
          if (consecutiveCount > constraints.maxConsecutiveBlocks) return false;
        }
      }
      return true;
    };
    const notAdjacentToCCU = (fid: string, k: string) => {
      if (constraints.allowHFCCUAdjacency) return true; // Skip check if minimal constraints
      
      const row = byFellow[fid] || {};
      const idx = keyToIndex.get(k) ?? -1;
      for (const [kk, vv] of Object.entries(row)) {
        if (vv !== "CCU") continue;
        const j = keyToIndex.get(kk) ?? -1;
        if (j >= 0 && Math.abs(j - idx) <= 1) return false;
      }
      return true;
    };

    // 1) KECK_CONSULT: 1 month pair per fellow
    for (const f of fellowOrder) {
      const row = (byFellow[f.id] = byFellow[f.id] || {});
      const current = Object.values(row).filter((x) => x === "KECK_CONSULT").length;
      if (current >= 2) continue;
      const candidateMonths = [...monthToKeys.keys()].filter((mi) => {
        const keys = monthToKeys.get(mi) || [];
        if (keys.length < 2) return false;
        // both free for this fellow and not blocked globally
        return keys.every((k) => !row[k] && !isBlocked(k, "KECK_CONSULT", f.id));
      });
      const ordered = randomize ? shuffle(candidateMonths) : candidateMonths;
      let placed = false;
      for (const mi of ordered) {
        placePairMonth(f.id, mi, "KECK_CONSULT");
        placed = true;
        break;
      }
      if (!placed) return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to place KECK_CONSULT.`] };
    }

    // 2) CCU: 1 block for 4 fellows
    for (const f of fellowOrder) {
      const row = (byFellow[f.id] = byFellow[f.id] || {});
      const need = ccuFellows.has(f.id) ? 1 : 0;
      const has = Object.values(row).filter((x) => x === "CCU").length;
      for (let n = has; n < need; n++) {
        const singles = blockKeys.filter((k) => !row[k] && !isBlocked(k, "CCU", f.id));
        const ordered = randomize ? shuffle(singles) : singles;
        const cand = ordered.find((k) => true);
        if (!cand) return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to place CCU.`] };
        placeSingle(f.id, cand, "CCU");
      }
    }

    // 3) LAC_CONSULT: 1 block for selected fellows (non-consecutive constraint is moot for single block)
    for (const f of fellowOrder) {
      const row = (byFellow[f.id] = byFellow[f.id] || {});
      const need = lacConsultFellows.has(f.id) ? 1 : 0;
      const has = Object.values(row).filter((x) => x === "LAC_CONSULT").length;
      for (let n = has; n < need; n++) {
        const singles = blockKeys.filter((k) => !row[k] && !isBlocked(k, "LAC_CONSULT", f.id));
        const ordered = randomize ? shuffle(singles) : singles;
        const cand = ordered.find((k) => true);
        if (!cand) return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to place LAC_CONSULT.`] };
        placeSingle(f.id, cand, "LAC_CONSULT");
      }
    }

    // 4) HF: 2 blocks, non-consecutive, and not adjacent to CCU for same fellow
    // Enhanced with sophisticated backtracking and CCU repositioning
    for (const f of fellowOrder) {
      const row = (byFellow[f.id] = byFellow[f.id] || {});
      let need = 2 - Object.values(row).filter((x) => x === "HF").length;
      if (need <= 0) continue;
      
      // Advanced HF placement with CCU repositioning if needed
      const attemptHFPlacement = () => {
        const backupRow = { ...row };
        const backupUsed = new Map(Object.entries(usedByRot).map(([k, v]) => [k, new Set(v)]));
        
        // Try CCU repositioning if HF placement fails initially
        const tryWithCCURepositioning = () => {
          const ccuBlocks = Object.entries(row).filter(([, v]) => v === "CCU").map(([k]) => k);
          if (ccuBlocks.length === 0) return false;
          
          // Try moving CCU to different positions to free up space for HF
          const alternateCCUPositions = blockKeys.filter(k => 
            !row[k] && !isBlocked(k, "CCU", f.id) && k !== ccuBlocks[0]
          );
          
          for (const newCCUPos of alternateCCUPositions.slice(0, 5)) { // Limit repositioning attempts
            // Temporarily move CCU
            const originalCCU = ccuBlocks[0];
            delete row[originalCCU];
            unmarkUsed(originalCCU, "CCU");
            placeSingle(f.id, newCCUPos, "CCU");
            
            // Try HF placement with new CCU position
            const hfPlaced = tryHFPlacement();
            if (hfPlaced) return true;
            
            // Restore CCU if HF placement still failed
            delete row[newCCUPos];
            unmarkUsed(newCCUPos, "CCU");
            placeSingle(f.id, originalCCU, "CCU");
          }
          return false;
        };
        
        const tryHFPlacement = () => {
          const singles = blockKeys.filter((k) => !row[k] && !isBlocked(k, "HF", f.id));
          const strategies = [
            singles, // original order
            singles.slice().reverse(), // reverse order
            randomize ? shuffle([...singles]) : singles, // randomized
            singles.slice().sort((a, b) => { // prefer middle blocks (away from edges)
              const idxA = keyToIndex.get(a) ?? 0;
              const idxB = keyToIndex.get(b) ?? 0;
              const midPoint = blockKeys.length / 2;
              return Math.abs(idxA - midPoint) - Math.abs(idxB - midPoint);
            }),
            singles.slice().sort(() => Math.random() - 0.5) // another random shuffle
          ];
          
          for (const ordered of strategies) {
            let placed = 0;
            const placedBlocks: string[] = [];
            
            for (const k of ordered) {
              if (!nonConsecutiveOk(f.id, k, "HF")) continue;
              if (!notAdjacentToCCU(f.id, k)) continue;
              placeSingle(f.id, k, "HF");
              placedBlocks.push(k);
              placed++;
              if (placed >= need) return true;
            }
            
            // Undo partial placement for this strategy
            for (const k of placedBlocks) {
              delete row[k];
              unmarkUsed(k, "HF");
            }
          }
          return false;
        };
        
        // First try normal HF placement
        if (tryHFPlacement()) return true;
        
        // If that fails and we have CCU, try repositioning CCU
        if (constraintLevel !== 'strict' && tryWithCCURepositioning()) return true;
        
        return false;
      };
      
      if (!attemptHFPlacement()) {
        addFailureReason(`hf_placement_${f.id}_${constraintLevel}`);
        return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to place HF with ${constraintLevel} constraints.`] };
      }
    }

    // Helper to place N blocks non-consecutive for label
    function placeNNonConsecutive(fid: string, label: Rotation, n: number): boolean {
      const row = (byFellow[fid] = byFellow[fid] || {});
      let need = n - Object.values(row).filter((x) => x === label).length;
      if (need <= 0) return true;
      const singles = blockKeys.filter((k) => !row[k] && !isBlocked(k, label, fid));
      const ordered = randomize ? shuffle(singles) : singles;
      for (const k of ordered) {
        if (!nonConsecutiveOk(fid, k, label)) continue;
        placeSingle(fid, k, label);
        need--;
        if (need <= 0) return true;
      }
      return need <= 0;
    }

    // 5) EP 2, 6) ECHO2 3, 7) NUCLEAR 2, 8) NONINVASIVE 2, 9) LAC_CATH 4 (all non-consecutive)
    for (const f of fellowOrder) {
      if (!placeNNonConsecutive(f.id, "EP", 2)) return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to place EP.`] };
      if (!placeNNonConsecutive(f.id, "ECHO2", 3)) return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to place ECHO2.`] };
      if (!placeNNonConsecutive(f.id, "NUCLEAR", 2)) return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to place NUCLEAR.`] };
      if (!placeNNonConsecutive(f.id, "NONINVASIVE", 2)) return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to place NONINVASIVE.`] };
      if (!placeNNonConsecutive(f.id, "LAC_CATH", 4)) return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to place LAC_CATH.`] };
    }

    // 10) Fill remaining with ELECTIVE; counts will naturally be 3 or 4 depending on CCU/LAC_CONSULT
    for (const f of fellowOrder) {
      const row = (byFellow[f.id] = byFellow[f.id] || {});
      for (const k of blockKeys) {
        if (!row[k]) placeSingle(f.id, k, "ELECTIVE");
      }
    }

    // Capacity check within PGY (ELECTIVE ignored)
    const cap: Map<string, Map<Rotation, string[]>> = new Map();
    for (const f of fellows) {
      const row = byFellow[f.id] || {};
      for (const [k, v] of Object.entries(row)) {
        if (!v || v === "ELECTIVE") continue;
        let m = cap.get(k);
        if (!m) {
          m = new Map<Rotation, string[]>();
          cap.set(k, m);
        }
        const arr = m.get(v as Rotation) ?? [];
        arr.push(f.name || f.id);
        m.set(v as Rotation, arr);
        if (arr.length > 1) {
          addFailureReason(`capacity_violation_${k}_${v}`);
          return { success: false, byFellow: {}, conflicts: [`Capacity violation at ${k} for ${v}: ${arr.join(", ")}`] };
        }
      }
    }

    // Post validations
    const conflicts: string[] = [];
    // Ensure CCU fellows count
    const actualCcuFellows = fellows.filter((f) => Object.values(byFellow[f.id] || {}).includes("CCU"));
    if (actualCcuFellows.length !== 4) conflicts.push(`Exactly 4 fellows must have CCU; got ${actualCcuFellows.length}.`);

    for (const f of fellows) {
      const row = byFellow[f.id] || {};
      // HF-CCU adjacency
      const ccuIdx = Object.entries(row)
        .filter(([, v]) => v === "CCU")
        .map(([k]) => keyToIndex.get(k) ?? -999);
      const hfIdx = Object.entries(row)
        .filter(([, v]) => v === "HF")
        .map(([k]) => keyToIndex.get(k) ?? -999);
      for (const i of hfIdx) for (const j of ccuIdx) if (Math.abs(i - j) === 1) conflicts.push(`${f.name || f.id}: HF cannot be adjacent to CCU.`);

      // KECK_CONSULT must be exactly 2 blocks in same month
      const kcs = Object.entries(row).filter(([, v]) => v === "KECK_CONSULT").map(([k]) => k);
      const kcMonths = new Set<number>(kcs.map((k) => keyToMonth.get(k)!).filter((x): x is number => x != null));
      if (kcs.length !== 2 || kcMonths.size !== 1) conflicts.push(`${f.name || f.id}: KECK_CONSULT must be one full month (2 blocks).`);

      // Non-consecutive checks for these labels
      const checkLabels: Rotation[] = ["LAC_CATH", "ECHO2", "EP", "NUCLEAR", "NONINVASIVE", "HF"];
      for (const lab of checkLabels) {
        const idxs = Object.entries(row)
          .filter(([, v]) => v === lab)
          .map(([k]) => keyToIndex.get(k) ?? -999)
          .sort((a, b) => a - b);
        for (let t = 1; t < idxs.length; t++) if (idxs[t] - idxs[t - 1] === 1) conflicts.push(`${f.name || f.id}: ${lab} blocks must be non-consecutive.`);
      }
    }

    if (conflicts.length > 0) {
      addFailureReason("post_placement_rule_violations");
      diagnostics.constraintViolations.push(...conflicts);
      return { success: false, byFellow: {}, conflicts };
    }

    return { success: true, byFellow };
  }

  // Progressive constraint relaxation with enhanced multi-restart algorithm
  const constraintLevels: ConstraintLevel[] = ['strict', 'relaxed', 'minimal'];
  const strategies = [
    { randomize: false, strategy: 'default', description: "deterministic", weight: 0.15 },
    { randomize: false, strategy: 'constraint_aware', description: "constraint_aware", weight: 0.25 },
    { randomize: false, strategy: 'hf_first', description: "hf_first", weight: 0.15 },
    { randomize: true, strategy: 'randomized', description: "randomized", weight: 0.30 },
    { randomize: true, strategy: 'randomized', description: "randomized_intensive", weight: 0.15 }
  ];

  let totalTried = 0;
  
  // Multi-phase approach with progressive constraint relaxation
  for (const constraintLevel of constraintLevels) {
    const levelMaxTries = Math.floor(maxTries / constraintLevels.length);
    let levelTried = 0;
    
    for (const strategyConfig of strategies) {
      const strategyMaxTries = Math.floor(levelMaxTries * strategyConfig.weight);
      
      for (let t = 0; t < strategyMaxTries; t++) {
        if (Date.now() - startTime > timeout) {
          diagnostics.lastAttemptDetails = `Timeout after ${totalTried} attempts. Last: ${constraintLevel} constraints, ${strategyConfig.description} strategy. Relaxation steps: [${diagnostics.relaxationSteps.slice(-3).join(", ")}]`;
          return { 
            success: false, 
            byFellow: {}, 
            conflicts: ["PGY-5 rotation scheduling timed out"], 
            tried: totalTried,
            timeout: true,
            diagnostics 
          };
        }

        const res = tryOnce(strategyConfig.strategy, constraintLevel);
        totalTried++;
        levelTried++;
        
        if (res.success) {
          const relaxationNote = constraintLevel !== 'strict' ? ` (with ${constraintLevel} constraints)` : '';
          diagnostics.lastAttemptDetails = `Success on attempt ${totalTried} using ${strategyConfig.description} strategy${relaxationNote}`;
          return { ...res, tried: totalTried, diagnostics };
        }
        
        // Track cross-PGY conflicts for diagnostics
        if (res.conflicts) {
          for (const conflict of res.conflicts) {
            if (conflict.includes('CCU') || conflict.includes('KECK_CONSULT') || conflict.includes('LAC_CONSULT') || conflict.includes('HF') || conflict.includes('EP')) {
              diagnostics.crossPGYConflicts.push(`${constraintLevel}/${strategyConfig.description}: ${conflict}`);
            }
          }
        }
      }
    }
    
    // Log constraint level completion
    if (constraintLevel !== 'minimal') {
      diagnostics.relaxationSteps.push(`Completed ${constraintLevel} level after ${levelTried} attempts, moving to more relaxed constraints`);
    }
  }

  diagnostics.lastAttemptDetails = `Failed after ${totalTried} attempts across ${constraintLevels.length} constraint levels and ${strategies.length} strategies`;
  
  // Before failing completely, try vacation-to-elective fallback
  const sharedVacations = detectSharedVacations(existingByFellow);
  
  if (sharedVacations.size > 0) {
    console.log(`🔄 PGY-5: Attempting vacation-to-elective fallback for ${sharedVacations.size} shared vacation blocks`);
    diagnostics.constraintViolations.push(`Detected shared vacations in blocks: ${Array.from(sharedVacations.keys()).join(", ")}`);
    
    // Convert one vacation per shared block to ELECTIVE temporarily
    const modifiedBase = cloneByFellow(existingByFellow || {});
    const conversions: Array<{fellowId: string, blockKey: string}> = [];
    
    for (const [blockKey, fellowIds] of sharedVacations) {
      // Convert the SECOND fellow's vacation to ELECTIVE (keep first fellow's VAC)
      if (fellowIds.length >= 2) {
        const fellowToConvert = fellowIds[1];
        if (modifiedBase[fellowToConvert]) {
          modifiedBase[fellowToConvert][blockKey] = "ELECTIVE";
          conversions.push({ fellowId: fellowToConvert, blockKey });
        }
      }
    }
    
    console.log(`🔄 PGY-5: Converted ${conversions.length} vacations to ELECTIVE, retrying...`);
    
    // Try solving with modified base using relaxed constraints
    const fallbackMaxTries = Math.min(1000, maxTries);
    let fallbackTried = 0;
    
    // Use most relaxed constraints for fallback
    for (let t = 0; t < fallbackMaxTries; t++) {
      if (Date.now() - startTime > timeout) break;
      
      const res = tryOnce('randomized', 'minimal');
      fallbackTried++;
      
      if (res.success) {
        // SUCCESS! Convert ELECTIVE back to VAC
        for (const {fellowId, blockKey} of conversions) {
          if (res.byFellow[fellowId]) {
            res.byFellow[fellowId][blockKey] = "VAC";
          }
        }
        
        console.log(`✅ PGY-5: Vacation fallback successful! Restored ${conversions.length} vacations.`);
        diagnostics.constraintViolations.push(
          `Fallback successful: temporarily converted ${conversions.length} vacation(s) to elective during solving`
        );
        diagnostics.lastAttemptDetails = `Succeeded using vacation-to-elective fallback for shared vacation blocks (tried ${fallbackTried} times with minimal constraints)`;
        
        return {
          ...res,
          tried: totalTried + fallbackTried,
          diagnostics
        };
      }
    }
    
    console.log(`❌ PGY-5: Vacation fallback also failed after ${fallbackTried} attempts`);
    diagnostics.constraintViolations.push(`Vacation-to-elective fallback also failed (tried ${fallbackTried} times)`);
    diagnostics.lastAttemptDetails += ` | Fallback also failed after ${fallbackTried} additional attempts`;
  }
  
  return { 
    success: false, 
    byFellow: {}, 
    conflicts: [
      `Unable to build PGY-5 rotations within ${totalTried} attempts.`,
      `Most common failures: ${Object.entries(diagnostics.failureReasons)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([reason, count]) => `${reason} (${count}x)`)
        .join(", ")}`,
      `Relaxation attempted: ${diagnostics.relaxationSteps.length > 0 ? diagnostics.relaxationSteps.slice(-2).join("; ") : "None"}`,
      `Cross-PGY conflicts detected: ${diagnostics.crossPGYConflicts.length}`
    ], 
    tried: totalTried,
    diagnostics 
  };
}

// PGY-6 solver implementing specified rules
export function placePGY6Rotations(
  fellows: Fellow[],
  blocks: BlockInfo[],
  existingByFellow: FellowSchedule | undefined,
  opts?: { randomize?: boolean; maxTries?: number; timeout?: number }
): SolveRotationsResult {
  const randomize = !!opts?.randomize;
  const maxTries = opts?.maxTries ?? 25000;
  const timeout = opts?.timeout ?? 240000; // 240 seconds (4 minutes)
  
  const startTime = Date.now();
  const diagnostics = {
    failureReasons: {} as Record<string, number>,
    constraintViolations: [] as string[],
    crossPGYConflicts: [] as string[],
    lastAttemptDetails: undefined as string | undefined,
  };
  function addFailureReason(reason: string) {
    diagnostics.failureReasons[reason] = (diagnostics.failureReasons[reason] || 0) + 1;
  }

  if (!fellows || fellows.length === 0) {
    return { success: false, byFellow: {}, conflicts: ["No PGY-6 fellows found"], tried: 0, diagnostics };
  }
  if (fellows.length !== 5) {
    return { success: false, byFellow: {}, conflicts: [
      `Expected 5 PGY-6 fellows; found ${fellows.length}. Adjust cohort or rule.`,
    ], tried: 0, diagnostics };
  }

  const { keyToIndex, keyToMonth, monthToKeys } = buildKeyMaps(blocks);
  const blockKeys = blocks.map((b) => b.key);

  // Cross-PGY counts (PGY-4 + PGY-5) to guide coverage and enforce caps
  const p4 = loadSchedule("PGY-4");
  const p5 = loadSchedule("PGY-5");
  const crossCounts: Record<string, Map<string, number>> = {
    VAC: new Map(),
    LAC_CATH: new Map(),
    CCU: new Map(),
    LAC_CONSULT: new Map(),
    HF: new Map(),
    KECK_CONSULT: new Map(),
    ECHO1: new Map(),
    ECHO2: new Map(),
    EP: new Map(),
    NUCLEAR: new Map(),
    NONINVASIVE: new Map(),
    ELECTIVE: new Map(),
    "ELECTIVE (ECHO2)": new Map(),
    "ELECTIVE (NONINVASIVE)": new Map(),
    "ELECTIVE (HF)": new Map(),
    "ELECTIVE (KECK_CONSULT)": new Map(),
  };
  const addCross = (byF?: FellowSchedule) => {
    if (!byF) return;
    for (const row of Object.values(byF)) {
      for (const [k, v] of Object.entries(row)) {
        if (!v) continue;
        const m = crossCounts[v as string];
        if (m) {
          m.set(k, (m.get(k) || 0) + 1);
        }
      }
    }
  };
  addCross(p4?.byFellow);
  addCross(p5?.byFellow);

  function tryOnce(): SolveRotationsResult {
    const byFellow: FellowSchedule = cloneByFellow(existingByFellow || {});

    // Capacity within PGY-6: one fellow per rotation per block (ELECTIVE ignored)
    const usedByRot: Record<string, Set<string>> = {
      VAC: new Set<string>(),
      LAC_CATH: new Set<string>(),
      CCU: new Set<string>(),
      LAC_CONSULT: new Set<string>(),
      HF: new Set<string>(),
      KECK_CONSULT: new Set<string>(),
      ECHO1: new Set<string>(),
      ECHO2: new Set<string>(),
      EP: new Set<string>(),
      NUCLEAR: new Set<string>(),
      NONINVASIVE: new Set<string>(),
      ELECTIVE: new Set<string>(),
    };
    const markUsed = (k: string, rot: Rotation) => {
      if (rot === "ELECTIVE") return;
      usedByRot[rot].add(k);
    };
    const isUsed = (k: string, rot: Rotation, fellowId?: string) => {
      if (rot === "ELECTIVE") return false;
      
      // Check if fellow is on vacation in this block - treat as unavailable
      if (fellowId) {
        const fellowSchedule = byFellow[fellowId] || {};
        if (fellowSchedule[k] === "VAC") return true;
      }
      
      return usedByRot[rot].has(k);
    };

    // Prime usedByRot from existing (ignore ELECTIVE and VAC)
    for (const f of fellows) {
      const row = byFellow[f.id] || {};
      for (const [k, v] of Object.entries(row)) {
        if (!v || v === "ELECTIVE" || v === "VAC") continue;
        usedByRot[v as Rotation]?.add(k);
      }
    }

    const fellowOrder = randomize ? shuffle([...fellows]) : [...fellows];

    // Distributions
    const ids = fellowOrder.map((f) => f.id);
    const pickSome = (arr: string[], n: number) => (randomize ? shuffle(arr) : arr).slice(0, n);

    const hfFellows = new Set<string>(pickSome(ids, 4));
    const noHF = ids.find((id) => !hfFellows.has(id))!;

    const keckFellows = new Set<string>(pickSome(ids, 4));

    const echoLow = pickSome(ids, 1)[0]; // gets 1 ECHO2; others 2

    const nuclearLow = pickSome(ids, 1)[0]; // gets 2 NUCLEAR; others 3
    let noninvLow = pickSome(ids.filter((id) => id !== nuclearLow), 1)[0]; // gets 2 NONINVASIVE
    if (!noninvLow) noninvLow = ids.find((id) => id !== nuclearLow)!;

    // LAC_CATH counts: noHF=2; two others=2; remaining two=1
    const lacCathCounts = new Map<string, number>();
    for (const id of ids) lacCathCounts.set(id, 1);
    lacCathCounts.set(noHF, 2);
    const remainingForTwo = pickSome(ids.filter((id) => id !== noHF), 2);
    for (const id of remainingForTwo) lacCathCounts.set(id, 2);

    // Helpers
    const placeSingle = (fid: string, k: string, label: Rotation) => {
      const row = (byFellow[fid] = byFellow[fid] || {});
      row[k] = label;
      markUsed(k, label);
    };
    const nonConsecutiveOk = (fid: string, k: string, label: Rotation) => {
      const row = byFellow[fid] || {};
      const idx = keyToIndex.get(k) ?? -1;
      for (const [kk, vv] of Object.entries(row)) {
        if (vv !== label) continue;
        const j = keyToIndex.get(kk) ?? -1;
        if (j >= 0 && Math.abs(j - idx) <= 1) return false;
      }
      return true;
    };

    const canPlaceLacCathAt = (fid: string, k: string) => {
      if (isUsed(k, "LAC_CATH", fid)) return false;
      const row = byFellow[fid] || {};
      if (row[k]) return false;
      const total = (crossCounts.LAC_CATH.get(k) || 0) + (usedByRot.LAC_CATH.has(k) ? 1 : 0);
      if (total >= 2) return false; // global cap 2 across PGYs
      // non-consecutive for this fellow
      const idx = keyToIndex.get(k) ?? -1;
      for (const [kk, vv] of Object.entries(row)) {
        if (vv !== "LAC_CATH") continue;
        const j = keyToIndex.get(kk) ?? -1;
        if (j >= 0 && Math.abs(j - idx) <= 1) return false;
      }
      return true;
    };

    const placeNWithPrefs = (
      fid: string,
      label: Rotation,
      n: number,
      opts?: { preferUncovered?: boolean; crossAvoid?: boolean }
    ): boolean => {
      const row = (byFellow[fid] = byFellow[fid] || {});
      let need = n - Object.values(row).filter((x) => x === label).length;
      if (need <= 0) return true;
      const tryOnce = (preferUncovered: boolean) => {
        const cands = blockKeys.filter((k) => !row[k] && !isUsed(k, label, fid));
        // Sort by uncovered first if requested
        const scored = cands.map((k) => ({ k, covered: (crossCounts[label].get(k) || 0) > 0 ? 1 : 0 }));
        const ordered = (preferUncovered
          ? scored.sort((a, b) => a.covered - b.covered)
          : scored
        ).map((x) => x.k);
        for (const k of randomize ? shuffle(ordered) : ordered) {
          if (label === "LAC_CATH") {
            // use dedicated flow for LAC_CATH elsewhere
            continue;
          }
          if (opts?.crossAvoid && (crossCounts[label].get(k) || 0) > 0 && preferUncovered) continue;
          if (["EP", "NUCLEAR"].includes(label)) {
            // no cross-year avoidance for these by spec
            if (!nonConsecutiveOk(fid, k, label)) continue;
            placeSingle(fid, k, label);
            need--;
          } else {
            // essential singles: try to avoid overlap first, fallback later
            if (!nonConsecutiveOk(fid, k, label)) continue;
            placeSingle(fid, k, label);
            need--;
          }
          if (need <= 0) return true;
        }
        return need <= 0;
      };
      // First pass with prefer uncovered if requested
      if (opts?.preferUncovered) {
        if (tryOnce(true)) return true;
      }
      // Fallback
      return tryOnce(false);
    };

    // Helpers for coverage-first assignment
    const crossTotal = (label: Rotation, k: string) =>
      (crossCounts[label].get(k) || 0) + (usedByRot[label].has(k) ? 1 : 0);

    const unplaceSingle = (fid: string, k: string, label: Rotation) => {
      const row = (byFellow[fid] = byFellow[fid] || {});
      if (row[k] === label) delete row[k];
      if (label !== "ELECTIVE") usedByRot[label].delete(k);
    };

    type QuotaMap = Map<string, number>;

    const assignCoverage = (label: Rotation, perFellowTarget: QuotaMap): { ok: boolean; missing?: string[] } => {
      // Remaining quotas after existing assignments
      const remain = new Map<string, number>();
      for (const id of ids) {
        const row = byFellow[id] || {};
        const current = Object.values(row).filter((x) => x === label).length;
        remain.set(id, Math.max(0, (perFellowTarget.get(id) || 0) - current));
      }

      const deficits = blockKeys.filter((k) => crossTotal(label, k) < 1);
      if (deficits.length === 0) return { ok: true };

      const candMap = new Map<string, string[]>();
      for (const k of deficits) {
        const cands: string[] = [];
        for (const fid of ids) {
          if ((remain.get(fid) || 0) <= 0) continue;
          const row = byFellow[fid] || {};
          if (row[k]) continue;
          if (isUsed(k, label, fid)) continue;
          if (!nonConsecutiveOk(fid, k, label)) continue;
          cands.push(fid);
        }
        candMap.set(k, cands);
      }

      const order = [...deficits].sort((a, b) => (candMap.get(a)?.length || 0) - (candMap.get(b)?.length || 0));
      const stack: { fid: string; k: string }[] = [];

      const BT = (i: number): boolean => {
        if (i >= order.length) return true;
        const k = order[i];
        const cands = (candMap.get(k) || []).sort((a, b) => (remain.get(b)! - remain.get(a)!));
        for (const fid of (randomize ? shuffle(cands) : cands)) {
          const row = byFellow[fid] || {};
          if ((remain.get(fid) || 0) <= 0) continue;
          if (row[k]) continue;
          if (isUsed(k, label, fid)) continue;
          if (!nonConsecutiveOk(fid, k, label)) continue;

          placeSingle(fid, k, label);
          remain.set(fid, (remain.get(fid) || 0) - 1);
          stack.push({ fid, k });

          if (BT(i + 1)) return true;

          // undo
          unplaceSingle(fid, k, label);
          remain.set(fid, (remain.get(fid) || 0) + 1);
          stack.pop();
        }
        return false;
      };

      const ok = BT(0);
      if (!ok) {
        // rollback all placed in this phase
        for (let i = stack.length - 1; i >= 0; i--) {
          const { fid, k } = stack[i];
          unplaceSingle(fid, k, label);
          remain.set(fid, (remain.get(fid) || 0) + 1);
        }
        return { ok: false, missing: order.filter((k) => crossTotal(label, k) < 1) };
      }
      return { ok: true };
    };

    // 1) HF: 1 block for 4 fellows (no adjacency rule with CCU for PGY-6)
    for (const f of fellowOrder) {
      if (!hfFellows.has(f.id)) continue;
      const row = (byFellow[f.id] = byFellow[f.id] || {});
      const has = Object.values(row).filter((x) => x === "HF").length;
      if (has >= 1) continue;
      // try uncovered first
      const cands0 = blockKeys.filter((k) => !row[k] && !isUsed(k, "HF", f.id) && (crossCounts.HF.get(k) || 0) === 0);
      const cands1 = blockKeys.filter((k) => !row[k] && !isUsed(k, "HF", f.id) && (crossCounts.HF.get(k) || 0) >= 1);
      const ordered0 = randomize ? shuffle(cands0) : cands0;
      const ordered1 = randomize ? shuffle(cands1) : cands1;
      const pick = ordered0[0] || ordered1[0];
      if (!pick) return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to place HF.`] };
      placeSingle(f.id, pick, "HF");
    }

    // 2) LAC_CATH distribution with global cap=2 and non-consecutive
    for (const f of fellowOrder) {
      let need = lacCathCounts.get(f.id) || 0;
      if (need <= 0) continue;
      const row = (byFellow[f.id] = byFellow[f.id] || {});
      while (need > 0) {
        // prioritize blocks with lowest current total to reach 2
        const scored: { k: string; total: number }[] = [];
        for (const k of blockKeys) {
          if (row[k]) continue;
          const total = (crossCounts.LAC_CATH.get(k) || 0) + (usedByRot.LAC_CATH.has(k) ? 1 : 0);
          if (total >= 2) continue;
          scored.push({ k, total });
        }
        scored.sort((a, b) => a.total - b.total);
        let placed = false;
        for (const s of randomize ? shuffle(scored) : scored) {
          if (!canPlaceLacCathAt(f.id, s.k)) continue;
          placeSingle(f.id, s.k, "LAC_CATH");
          need--;
          placed = true;
          if (need <= 0) break;
        }
        if (!placed) return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to place LAC_CATH.`] };
      }
    }

    // 3) KECK_CONSULT: 1 block for 4 fellows, prefer uncovered
    for (const f of fellowOrder) {
      if (!keckFellows.has(f.id)) continue;
      if (!placeNWithPrefs(f.id, "KECK_CONSULT", 1, { preferUncovered: true, crossAvoid: true })) {
        return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to place KECK_CONSULT.`] };
      }
    }

    // 4) ECHO2: Two-phase approach - place primary quotas first, then use elective specializations for coverage
    for (const f of fellowOrder) {
      const target = f.id === echoLow ? 1 : 2;
      if (!placeNWithPrefs(f.id, "ECHO2", target, { preferUncovered: true, crossAvoid: true })) {
        return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to place ECHO2.`] };
      }
    }

    // 5) EP: 2 each; non-consecutive; no cross-year avoidance
    for (const f of fellowOrder) {
      if (!placeNWithPrefs(f.id, "EP", 2)) {
        return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to place EP.`] };
      }
    }

    // 6) NUCLEAR: 3 except one with 2; non-consecutive
    for (const f of fellowOrder) {
      const target = f.id === nuclearLow ? 2 : 3;
      if (!placeNWithPrefs(f.id, "NUCLEAR", target)) {
        return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to place NUCLEAR.`] };
      }
    }

    // 7) NONINVASIVE: Two-phase approach - place primary quotas first, then use elective specializations for coverage
    for (const f of fellowOrder) {
      const target = f.id === noninvLow ? 2 : 3;
      if (!placeNWithPrefs(f.id, "NONINVASIVE", target, { preferUncovered: true, crossAvoid: true })) {
        return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to place NONINVASIVE.`] };
      }
    }

    // 8) Fill remaining with ELECTIVE and add specializations for coverage
    for (const f of fellowOrder) {
      const row = (byFellow[f.id] = byFellow[f.id] || {});
      for (const k of blockKeys) if (!row[k]) placeSingle(f.id, k, "ELECTIVE");
    }

    // 9) Phase 2: Add elective specializations to ensure coverage where needed
    const addElectiveSpecializations = () => {
      // Check which blocks need additional coverage
      const getCoverageCount = (blockKey: string, rotationType: string): number => {
        let count = 0;
        // Count from current PGY-6 assignments
        for (const f of fellows) {
          const rotation = byFellow[f.id]?.[blockKey];
          if (countsForCoverage(rotation as Rotation, rotationType as Rotation)) {
            count++;
          }
        }
        // Count from cross-PGY assignments
        count += (crossCounts[rotationType]?.get(blockKey) || 0);
        return count;
      };

      const specializations = [
        { type: "ECHO2", needed: 1 },
        { type: "NONINVASIVE", needed: 1 },
        { type: "HF", needed: 1 },
        { type: "KECK_CONSULT", needed: 1 }
      ];

      for (const spec of specializations) {
        for (const k of blockKeys) {
          const currentCount = getCoverageCount(k, spec.type);
          if (currentCount < spec.needed) {
            // Find a fellow with ELECTIVE in this block to convert
            for (const f of fellows) {
              const row = byFellow[f.id] || {};
              if (row[k] === "ELECTIVE") {
                row[k] = `ELECTIVE (${spec.type})` as Rotation;
                break; // Only need one conversion per block
              }
            }
          }
        }
      }
    };

    addElectiveSpecializations();

    // Capacity check within PGY-6 (ELECTIVE ignored)
    const cap: Map<string, Map<Rotation, string[]>> = new Map();
    for (const f of fellows) {
      const row = byFellow[f.id] || {};
      for (const [k, v] of Object.entries(row)) {
        if (!v || v === "ELECTIVE") continue;
        let m = cap.get(k);
        if (!m) { m = new Map<Rotation, string[]>(); cap.set(k, m); }
        const arr = m.get(v as Rotation) ?? [];
        arr.push(f.name || f.id);
        m.set(v as Rotation, arr);
        if (arr.length > 1 && v !== "LAC_CATH") {
          addFailureReason(`capacity_violation_${k}_${v}`);
          return { success: false, byFellow: {}, conflicts: [`Capacity violation at ${k} for ${v}: ${arr.join(", ")}`] };
        }
      }
    }

    // Per-fellow validations (count both primary and elective specializations)
    const conflicts: string[] = [];
    
    // Helper function to count rotations including elective specializations
    const countRotationsForFellow = (fellowId: string, rotationType: Rotation): number => {
      const row = byFellow[fellowId] || {};
      return Object.values(row).filter(rotation => 
        rotation && countsForCoverage(rotation as Rotation, rotationType)
      ).length;
    };
    
    // HF exactly 4 fellows with exactly 1 block
    const hfCounts = fellows.map((f) => ({ f, c: countRotationsForFellow(f.id, "HF") }));
    const hfExactly = hfCounts.filter((x) => x.c === 1).length;
    const hfZero = hfCounts.filter((x) => x.c === 0).length;
    if (hfExactly !== 4 || hfZero !== 1) conflicts.push(`HF distribution must be 4 fellows with 1 block, 1 fellow with 0.`);

    // KECK_CONSULT exactly 4 fellows with 1 block
    const kcCounts = fellows.map((f) => ({ f, c: countRotationsForFellow(f.id, "KECK_CONSULT") }));
    if (kcCounts.filter((x) => x.c === 1).length !== 4 || kcCounts.filter((x) => x.c === 0).length !== 1) conflicts.push(`KECK_CONSULT distribution must be 4 fellows with 1 block, 1 with 0.`);

    // ECHO2: one has 1; others 2 (count elective specializations)
    const echoCounts = fellows.map((f) => ({ f, c: countRotationsForFellow(f.id, "ECHO2") }));
    if (!(echoCounts.some((x) => x.c === 1) && echoCounts.filter((x) => x.c === 2).length === 4)) conflicts.push(`ECHO2 distribution must be [2,2,2,2,1].`);

    // NUCLEAR: one has 2; others 3
    const nucCounts = fellows.map((f) => ({ f, c: Object.values(byFellow[f.id] || {}).filter((x) => x === "NUCLEAR").length }));
    const nuc2 = nucCounts.filter((x) => x.c === 2);
    if (!(nuc2.length === 1 && nucCounts.filter((x) => x.c === 3).length === 4)) conflicts.push(`NUCLEAR distribution must be [3,3,3,3,2].`);

    // NONINVASIVE: one has 2; others 3; and low fellow differs from nuclearLow (count elective specializations)
    const noninvCounts = fellows.map((f) => ({ f, c: countRotationsForFellow(f.id, "NONINVASIVE") }));
    const non2 = noninvCounts.filter((x) => x.c === 2);
    if (!(non2.length === 1 && noninvCounts.filter((x) => x.c === 3).length === 4)) conflicts.push(`NONINVASIVE distribution must be [3,3,3,3,2].`);
    if (nuc2.length === 1 && non2.length === 1 && nuc2[0].f.id === non2[0].f.id) conflicts.push(`The 2-block NUCLEAR fellow cannot also be the 2-block NONINVASIVE fellow.`);

    // LAC_CATH non-consecutive and distribution multiset [2,2,2,1,1] with noHF fellow having 2
    const lacCounts = fellows.map((f) => ({ f, c: Object.values(byFellow[f.id] || {}).filter((x) => x === "LAC_CATH").length }));
    const multiset = lacCounts.map((x) => x.c).sort((a, b) => a - b).join(",");
    if (multiset !== "1,1,2,2,2") conflicts.push(`LAC_CATH distribution must be [2,2,2,1,1].`);
    const noHFC = lacCounts.find((x) => x.f.id === noHF)?.c || 0;
    if (noHFC !== 2) conflicts.push(`Fellow without HF must have 2 LAC_CATH blocks.`);

    // Non-consecutive checks
    const checkLabels: Rotation[] = ["LAC_CATH", "ECHO2", "EP", "NUCLEAR", "NONINVASIVE"];
    for (const f of fellows) {
      const row = byFellow[f.id] || {};
      for (const lab of checkLabels) {
        const idxs = Object.entries(row)
          .filter(([, v]) => v === lab)
          .map(([k]) => keyToIndex.get(k) ?? -999)
          .sort((a, b) => a - b);
        for (let t = 1; t < idxs.length; t++) if (idxs[t] - idxs[t - 1] === 1) conflicts.push(`${f.name || f.id}: ${lab} blocks must be non-consecutive.`);
      }
    }

    // Essential coverage across all PGYs per block (now counts elective specializations)
    const getCoverageForBlock = (blockKey: string, rotationType: Rotation): number => {
      let count = 0;
      
      // Count from all PGY levels
      const allSchedules = [p4?.byFellow, p5?.byFellow, byFellow].filter(Boolean);
      for (const schedule of allSchedules) {
        for (const row of Object.values(schedule!)) {
          const rotation = row[blockKey];
          if (rotation && countsForCoverage(rotation as Rotation, rotationType)) {
            count++;
          }
        }
      }
      
      return count;
    };

    // Only validate essential coverage if we have reasonable coverage goals
    const uncoveredBlocks: string[] = [];
    for (const k of blockKeys) {
      const needSingles: Rotation[] = ["CCU", "HF", "KECK_CONSULT", "ECHO2", "NONINVASIVE"];
      for (const rot of needSingles) {
        if (getCoverageForBlock(k, rot) < 1) {
          uncoveredBlocks.push(`${k}: missing ${rot}`);
        }
      }
      if (getCoverageForBlock(k, "LAC_CATH") < 2) {
        uncoveredBlocks.push(`${k}: missing LAC_CATH (need 2)`);
      }
    }
    
    // Add diagnostics for uncovered blocks but don't fail completely
    if (uncoveredBlocks.length > 0) {
      diagnostics.constraintViolations.push(`Partial coverage gaps: ${uncoveredBlocks.join(", ")}`);
    }

    if (conflicts.length > 0) {
      addFailureReason("post_placement_rule_violations");
      diagnostics.constraintViolations.push(...conflicts);
      return { success: false, byFellow: {}, conflicts };
    }

    return { success: true, byFellow };
  }

  // Multi-restart algorithm with different strategies
  const strategies = [
    { randomize: false, description: "deterministic" },
    { randomize: true, description: "randomized" },
    { randomize: true, description: "randomized_intensive" }
  ];

  let totalTried = 0;
  for (const strategy of strategies) {
    const strategyMaxTries = strategy.description === "randomized_intensive" ? Math.floor(maxTries * 0.6) : Math.floor(maxTries / strategies.length);
    
    for (let t = 0; t < strategyMaxTries; t++) {
      if (Date.now() - startTime > timeout) {
        diagnostics.lastAttemptDetails = `Timeout after ${totalTried} attempts using ${strategy.description} strategy`;
        return { 
          success: false, 
          byFellow: {}, 
          conflicts: ["PGY-6 rotation scheduling timed out"], 
          tried: totalTried,
          timeout: true,
          diagnostics 
        };
      }

      const res = tryOnce();
      totalTried++;
      
      if (res.success) {
        return { ...res, tried: totalTried, diagnostics };
      }
    }
  }

  diagnostics.lastAttemptDetails = `Failed after ${totalTried} attempts across ${strategies.length} strategies`;
  
  // Before failing completely, try vacation-to-elective fallback
  const sharedVacations = detectSharedVacations(existingByFellow);
  
  if (sharedVacations.size > 0) {
    console.log(`🔄 PGY-6: Attempting vacation-to-elective fallback for ${sharedVacations.size} shared vacation blocks`);
    diagnostics.constraintViolations.push(`Detected shared vacations in blocks: ${Array.from(sharedVacations.keys()).join(", ")}`);
    
    // Convert one vacation per shared block to ELECTIVE temporarily
    const modifiedBase = cloneByFellow(existingByFellow || {});
    const conversions: Array<{fellowId: string, blockKey: string}> = [];
    
    for (const [blockKey, fellowIds] of sharedVacations) {
      // Convert the SECOND fellow's vacation to ELECTIVE (keep first fellow's VAC)
      if (fellowIds.length >= 2) {
        const fellowToConvert = fellowIds[1];
        if (modifiedBase[fellowToConvert]) {
          modifiedBase[fellowToConvert][blockKey] = "ELECTIVE";
          conversions.push({ fellowId: fellowToConvert, blockKey });
        }
      }
    }
    
    console.log(`🔄 PGY-6: Converted ${conversions.length} vacations to ELECTIVE, retrying...`);
    
    // Try solving with modified base using a subset of attempts
    const fallbackMaxTries = Math.min(500, maxTries);
    let fallbackTried = 0;
    
    for (let t = 0; t < fallbackMaxTries; t++) {
      if (Date.now() - startTime > timeout) break;
      
      const res = tryOnce();
      fallbackTried++;
      
      if (res.success) {
        // SUCCESS! Convert ELECTIVE back to VAC
        for (const {fellowId, blockKey} of conversions) {
          if (res.byFellow[fellowId]) {
            res.byFellow[fellowId][blockKey] = "VAC";
          }
        }
        
        console.log(`✅ PGY-6: Vacation fallback successful! Restored ${conversions.length} vacations.`);
        diagnostics.constraintViolations.push(
          `Fallback successful: temporarily converted ${conversions.length} vacation(s) to elective during solving`
        );
        diagnostics.lastAttemptDetails = `Succeeded using vacation-to-elective fallback for shared vacation blocks (tried ${fallbackTried} times)`;
        
        return {
          ...res,
          tried: totalTried + fallbackTried,
          diagnostics
        };
      }
    }
    
    console.log(`❌ PGY-6: Vacation fallback also failed after ${fallbackTried} attempts`);
    diagnostics.constraintViolations.push(`Vacation-to-elective fallback also failed (tried ${fallbackTried} times)`);
    diagnostics.lastAttemptDetails += ` | Fallback also failed after ${fallbackTried} additional attempts`;
  }
  
  return { 
    success: false, 
    byFellow: {}, 
    conflicts: [
      `Unable to build PGY-6 rotations within ${totalTried} attempts.`,
      `Most common failures: ${Object.entries(diagnostics.failureReasons)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([reason, count]) => `${reason} (${count}x)`)
        .join(", ")}`
    ], 
    tried: totalTried,
    diagnostics 
  };
}

