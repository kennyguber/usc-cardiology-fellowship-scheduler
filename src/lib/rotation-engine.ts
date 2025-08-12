import { type BlockInfo } from "@/lib/block-utils";
import { type Fellow, type FellowSchedule, loadSchedule } from "@/lib/schedule-engine";

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
  | "ELECTIVE";

export type SolveRotationsResult = {
  byFellow: FellowSchedule;
  success: boolean;
  conflicts?: string[];
  tried?: number;
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

export function placePGY4Rotations(
  fellows: Fellow[],
  blocks: BlockInfo[],
  existingByFellow: FellowSchedule | undefined,
  opts?: { randomize?: boolean; maxTries?: number; lockVacations?: boolean }
): SolveRotationsResult {
  const randomize = !!opts?.randomize;
  const maxTries = opts?.maxTries ?? 40;
  const lockVacations = opts?.lockVacations ?? true;

  if (!fellows || fellows.length === 0) {
    return { success: false, byFellow: {}, conflicts: ["No PGY-4 fellows found"], tried: 0 };
  }
  if (fellows.length !== 5) {
    return {
      success: false,
      byFellow: {},
      conflicts: [
        `Expected 5 PGY-4 fellows for early LAC_CATH mapping; found ${fellows.length}. Adjust cohort or rule.`,
      ],
      tried: 0,
    };
  }

  const { keyToIndex, keyToMonth, monthToKeys } = buildKeyMaps(blocks);
  const blockKeys = blocks.map((b) => b.key);
  const firstFive = FIRST_FIVE_KEYS.filter((k) => keyToIndex.has(k));

  function tryOnce(): SolveRotationsResult {
    const byFellow: FellowSchedule = cloneByFellow(existingByFellow || {});
    // Track capacity per rotation (one fellow per rotation per block). ELECTIVE has no capacity limit.
    const usedByRot: Record<Rotation, Set<string>> = {
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
    const isBlocked = (k: string, rot: Rotation) => (rot === "ELECTIVE" ? false : usedByRot[rot].has(k));
    const markUsed = (k: string, rot: Rotation) => {
      if (rot === "ELECTIVE") return; // no capacity restriction for electives
      usedByRot[rot].add(k);
    };
    const unmarkUsed = (k: string, rot: Rotation) => {
      if (rot === "ELECTIVE") return;
      usedByRot[rot].delete(k);
    };
    // Prime from existing assignments for these fellows (ignore ELECTIVE so others can share the block)
    for (const f of fellows) {
      const row = byFellow[f.id] || {};
      for (const [k, v] of Object.entries(row)) {
        if (!v) continue;
        if (v === "ELECTIVE") continue;
        usedByRot[v as Rotation]?.add(k);
      }
    }

    // Step A: Respect existing vacations unless explicitly unlocked
    if (!lockVacations) {
      // Reseat vacations out of first five keys if present
      for (const f of fellows) {
        const row = (byFellow[f.id] = byFellow[f.id] || {});
        const vacs = Object.entries(row)
          .filter(([, v]) => v === "VAC")
          .map(([k]) => k);
        const vacsInFirst = vacs.filter((k) => firstFive.includes(k as any));
        if (vacsInFirst.length === 0) continue;

        // Helper: can place a vacation at candidate key?
        const otherVac = vacs.find((k) => !vacsInFirst.includes(k));
        const canPlaceVacAt = (cand: string) => {
          if (isBlocked(cand, "VAC")) return false;
          if (row[cand]) return false;
          // spacing with the other vacation
          if (otherVac) {
            const ia = keyToIndex.get(otherVac) ?? -1;
            const ib = keyToIndex.get(cand) ?? -1;
            if (ia < 0 || ib < 0) return false;
            if (Math.abs(ib - ia) < 6) return false;
          }
          return true;
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
        if (isBlocked(k, "LAC_CATH")) continue;
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
      return keys.every((k) => !isBlocked(k, label) && !(byFellow[fid] && byFellow[fid][k]));
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
              if (!isBlocked(k, "LAC_CATH") && !row[k]) singles.push({ k, mi });
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
          for (const k of keys) if (!isBlocked(k, "ECHO1") && !row[k]) singles.push({ k, mi });
        }
        const ordered = randomize ? shuffle(singles) : singles;
        for (const s of ordered) {
          placeSingle(f.id, s.k, "ECHO1");
          echoMonths.add(s.mi);
          needECHO -= 1;
          if (needECHO <= 0) break;
        }
        if (needECHO > 0) {
          return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to place ECHO1.`] };
        }
      }

      // EP: 1 half-block anywhere
      let needEP = 1 - (Object.values(row).filter((x) => x === "EP").length || 0);
      if (needEP > 0) {
        const singles: string[] = [];
        for (const k of blockKeys) if (!isBlocked(k, "EP") && !row[k]) singles.push(k);
        const ordered = randomize ? shuffle(singles) : singles;
        if (ordered[0]) {
          placeSingle(f.id, ordered[0], "EP");
          needEP -= 1;
        }
        if (needEP > 0) {
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
      return { success: false, byFellow: {}, conflicts: ruleConflicts };
    }

    return { success: true, byFellow };
  }

  for (let t = 0; t < maxTries; t++) {
    const res = tryOnce();
    if (res.success) return res;
  }
  return { success: false, byFellow: {}, conflicts: ["Unable to build PGY-4 rotations within max attempts."] };
}

// PGY-5 solver implementing specified rules
export function placePGY5Rotations(
  fellows: Fellow[],
  blocks: BlockInfo[],
  existingByFellow: FellowSchedule | undefined,
  opts?: { randomize?: boolean; maxTries?: number }
): SolveRotationsResult {
  const randomize = !!opts?.randomize;
  const maxTries = opts?.maxTries ?? 40;
  if (!fellows || fellows.length === 0) {
    return { success: false, byFellow: {}, conflicts: ["No PGY-5 fellows found"], tried: 0 };
  }
  if (fellows.length !== 5) {
    return { success: false, byFellow: {}, conflicts: [
      `Expected 5 PGY-5 fellows; found ${fellows.length}. Adjust cohort or rule.`,
    ], tried: 0 };
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

  function tryOnce(): SolveRotationsResult {
    const byFellow: FellowSchedule = cloneByFellow(existingByFellow || {});

    // Track capacity per rotation (one fellow per rotation per block). ELECTIVE ignored.
    const usedByRot: Record<Rotation, Set<string>> = {
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
    const isBlocked = (k: string, rot: Rotation) => {
      if (rot !== "ELECTIVE" && usedByRot[rot].has(k)) return true;
      if (crossBlock[rot]?.has(k)) return true; // avoid PGY-4 overlaps per rules
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

    // Prime usedByRot from existing assignments (ignore ELECTIVE for capacity)
    for (const f of fellows) {
      const row = byFellow[f.id] || {};
      for (const [k, v] of Object.entries(row)) {
        if (!v || v === "ELECTIVE") continue;
        usedByRot[v as Rotation]?.add(k);
      }
    }

    // Selection: 4 of 5 get CCU. The remaining MUST get LAC_CONSULT. Plus 3 random CCU fellows also get LAC_CONSULT.
    const fellowOrder = randomize ? shuffle([...fellows]) : [...fellows];
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
      const row = byFellow[fid] || {};
      const idx = keyToIndex.get(k) ?? -1;
      for (const [kk, vv] of Object.entries(row)) {
        if (vv !== label) continue;
        const j = keyToIndex.get(kk) ?? -1;
        if (j >= 0 && Math.abs(j - idx) <= 1) return false;
      }
      return true;
    };
    const notAdjacentToCCU = (fid: string, k: string) => {
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
        return keys.every((k) => !row[k] && !isBlocked(k, "KECK_CONSULT"));
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
        const singles = blockKeys.filter((k) => !row[k] && !isBlocked(k, "CCU"));
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
        const singles = blockKeys.filter((k) => !row[k] && !isBlocked(k, "LAC_CONSULT"));
        const ordered = randomize ? shuffle(singles) : singles;
        const cand = ordered.find((k) => true);
        if (!cand) return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to place LAC_CONSULT.`] };
        placeSingle(f.id, cand, "LAC_CONSULT");
      }
    }

    // 4) HF: 2 blocks, non-consecutive, and not adjacent to CCU for same fellow
    for (const f of fellowOrder) {
      const row = (byFellow[f.id] = byFellow[f.id] || {});
      let need = 2 - Object.values(row).filter((x) => x === "HF").length;
      if (need <= 0) continue;
      const singles = blockKeys.filter((k) => !row[k] && !isBlocked(k, "HF"));
      const ordered = randomize ? shuffle(singles) : singles;
      for (const k of ordered) {
        if (!nonConsecutiveOk(f.id, k, "HF")) continue;
        if (!notAdjacentToCCU(f.id, k)) continue;
        placeSingle(f.id, k, "HF");
        need--;
        if (need <= 0) break;
      }
      if (need > 0) return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to place HF.`] };
    }

    // Helper to place N blocks non-consecutive for label
    function placeNNonConsecutive(fid: string, label: Rotation, n: number): boolean {
      const row = (byFellow[fid] = byFellow[fid] || {});
      let need = n - Object.values(row).filter((x) => x === label).length;
      if (need <= 0) return true;
      const singles = blockKeys.filter((k) => !row[k] && !isBlocked(k, label));
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

    if (conflicts.length > 0) return { success: false, byFellow: {}, conflicts };

    return { success: true, byFellow };
  }

  for (let t = 0; t < maxTries; t++) {
    const res = tryOnce();
    if (res.success) return res;
  }
  return { success: false, byFellow: {}, conflicts: ["Unable to build PGY-5 rotations within max attempts."] };
}

// PGY-6 solver implementing specified rules
export function placePGY6Rotations(
  fellows: Fellow[],
  blocks: BlockInfo[],
  existingByFellow: FellowSchedule | undefined,
  opts?: { randomize?: boolean; maxTries?: number }
): SolveRotationsResult {
  const randomize = !!opts?.randomize;
  const maxTries = opts?.maxTries ?? 120;
  if (!fellows || fellows.length === 0) {
    return { success: false, byFellow: {}, conflicts: ["No PGY-6 fellows found"], tried: 0 };
  }
  if (fellows.length !== 5) {
    return { success: false, byFellow: {}, conflicts: [
      `Expected 5 PGY-6 fellows; found ${fellows.length}. Adjust cohort or rule.`,
    ], tried: 0 };
  }

  const { keyToIndex, keyToMonth, monthToKeys } = buildKeyMaps(blocks);
  const blockKeys = blocks.map((b) => b.key);

  // Cross-PGY counts (PGY-4 + PGY-5) to guide coverage and enforce caps
  const p4 = loadSchedule("PGY-4");
  const p5 = loadSchedule("PGY-5");
  const crossCounts: Record<Rotation, Map<string, number>> = {
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
  };
  const addCross = (byF?: FellowSchedule) => {
    if (!byF) return;
    for (const row of Object.values(byF)) {
      for (const [k, v] of Object.entries(row)) {
        if (!v) continue;
        const m = crossCounts[v as Rotation];
        m.set(k, (m.get(k) || 0) + 1);
      }
    }
  };
  addCross(p4?.byFellow);
  addCross(p5?.byFellow);

  function tryOnce(): SolveRotationsResult {
    const byFellow: FellowSchedule = cloneByFellow(existingByFellow || {});

    // Capacity within PGY-6: one fellow per rotation per block (ELECTIVE ignored)
    const usedByRot: Record<Rotation, Set<string>> = {
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
    const isUsed = (k: string, rot: Rotation) => rot !== "ELECTIVE" && usedByRot[rot].has(k);

    // Prime usedByRot from existing (ignore ELECTIVE)
    for (const f of fellows) {
      const row = byFellow[f.id] || {};
      for (const [k, v] of Object.entries(row)) {
        if (!v || v === "ELECTIVE") continue;
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
      if (isUsed(k, "LAC_CATH")) return false;
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
        const cands = blockKeys.filter((k) => !row[k] && !isUsed(k, label));
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
          if (isUsed(k, label)) continue;
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
          if (isUsed(k, label)) continue;
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
      const cands0 = blockKeys.filter((k) => !row[k] && !isUsed(k, "HF") && (crossCounts.HF.get(k) || 0) === 0);
      const cands1 = blockKeys.filter((k) => !row[k] && !isUsed(k, "HF") && (crossCounts.HF.get(k) || 0) >= 1);
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

    // 4) ECHO2: coverage-first: ensure at least one per block across PGYs, then fill remaining quotas
    {
      const target: Map<string, number> = new Map();
      for (const id of ids) target.set(id, id === echoLow ? 1 : 2);
      const cov = assignCoverage("ECHO2", target);
      if (!cov.ok) {
        return { success: false, byFellow: {}, conflicts: [
          `Coverage solver failed for ECHO2; missing at: ${cov.missing?.join(", ")}`,
        ] };
      }
      // fill remaining to meet per-fellow targets
      for (const f of fellowOrder) {
        const t = target.get(f.id)!;
        if (!placeNWithPrefs(f.id, "ECHO2", t)) {
          return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to complete ECHO2 quota.`] };
        }
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

    // 7) NONINVASIVE: coverage-first: ensure at least one per block, then fill remaining quotas
    {
      const target: Map<string, number> = new Map();
      for (const id of ids) target.set(id, id === noninvLow ? 2 : 3);
      const cov = assignCoverage("NONINVASIVE", target);
      if (!cov.ok) {
        return { success: false, byFellow: {}, conflicts: [
          `Coverage solver failed for NONINVASIVE; missing at: ${cov.missing?.join(", ")}`,
        ] };
      }
      for (const f of fellowOrder) {
        const t = target.get(f.id)!;
        if (!placeNWithPrefs(f.id, "NONINVASIVE", t)) {
          return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to complete NONINVASIVE quota.`] };
        }
      }
    }

    // 8) Fill remaining with ELECTIVE
    for (const f of fellowOrder) {
      const row = (byFellow[f.id] = byFellow[f.id] || {});
      for (const k of blockKeys) if (!row[k]) placeSingle(f.id, k, "ELECTIVE");
    }

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
          return { success: false, byFellow: {}, conflicts: [`Capacity violation at ${k} for ${v}: ${arr.join(", ")}`] };
        }
      }
    }

    // Per-fellow validations
    const conflicts: string[] = [];
    // HF exactly 4 fellows with exactly 1 block
    const hfCounts = fellows.map((f) => ({ f, c: Object.values(byFellow[f.id] || {}).filter((x) => x === "HF").length }));
    const hfExactly = hfCounts.filter((x) => x.c === 1).length;
    const hfZero = hfCounts.filter((x) => x.c === 0).length;
    if (hfExactly !== 4 || hfZero !== 1) conflicts.push(`HF distribution must be 4 fellows with 1 block, 1 fellow with 0.`);

    // KECK_CONSULT exactly 4 fellows with 1 block
    const kcCounts = fellows.map((f) => ({ f, c: Object.values(byFellow[f.id] || {}).filter((x) => x === "KECK_CONSULT").length }));
    if (kcCounts.filter((x) => x.c === 1).length !== 4 || kcCounts.filter((x) => x.c === 0).length !== 1) conflicts.push(`KECK_CONSULT distribution must be 4 fellows with 1 block, 1 with 0.`);

    // ECHO2: one has 1; others 2
    const echoCounts = fellows.map((f) => ({ f, c: Object.values(byFellow[f.id] || {}).filter((x) => x === "ECHO2").length }));
    if (!(echoCounts.some((x) => x.c === 1) && echoCounts.filter((x) => x.c === 2).length === 4)) conflicts.push(`ECHO2 distribution must be [2,2,2,2,1].`);

    // NUCLEAR: one has 2; others 3
    const nucCounts = fellows.map((f) => ({ f, c: Object.values(byFellow[f.id] || {}).filter((x) => x === "NUCLEAR").length }));
    const nuc2 = nucCounts.filter((x) => x.c === 2);
    if (!(nuc2.length === 1 && nucCounts.filter((x) => x.c === 3).length === 4)) conflicts.push(`NUCLEAR distribution must be [3,3,3,3,2].`);

    // NONINVASIVE: one has 2; others 3; and low fellow differs from nuclearLow
    const noninvCounts = fellows.map((f) => ({ f, c: Object.values(byFellow[f.id] || {}).filter((x) => x === "NONINVASIVE").length }));
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

    // Essential coverage across all PGYs per block
    const combined: Map<string, Map<Rotation, number>> = new Map();
    const addComb = (byF?: FellowSchedule) => {
      if (!byF) return;
      for (const row of Object.values(byF)) {
        for (const [k, v] of Object.entries(row)) {
          if (!v) continue;
          let m = combined.get(k);
          if (!m) { m = new Map<Rotation, number>(); combined.set(k, m); }
          m.set(v as Rotation, (m.get(v as Rotation) || 0) + 1);
        }
      }
    };
    addComb(p4?.byFellow);
    addComb(p5?.byFellow);
    addComb(byFellow);

    for (const k of blockKeys) {
      const m = combined.get(k) || new Map<Rotation, number>();
      const needSingles: Rotation[] = ["CCU", "HF", "KECK_CONSULT", "ECHO2", "NONINVASIVE"];
      for (const rot of needSingles) {
        if ((m.get(rot) || 0) < 1) conflicts.push(`${k}: essential coverage missing for ${rot}.`);
      }
      if ((m.get("LAC_CATH") || 0) < 2) conflicts.push(`${k}: essential coverage missing for LAC_CATH (need 2).`);
    }

    if (conflicts.length > 0) return { success: false, byFellow: {}, conflicts };

    return { success: true, byFellow };
  }

  for (let t = 0; t < maxTries; t++) {
    const res = tryOnce();
    if (res.success) return res;
  }
  return { success: false, byFellow: {}, conflicts: ["Unable to build PGY-6 rotations within max attempts."] };
}

