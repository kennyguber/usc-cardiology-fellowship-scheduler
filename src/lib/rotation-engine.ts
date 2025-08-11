import { type BlockInfo } from "@/lib/block-utils";
import { type Fellow, type FellowSchedule } from "@/lib/schedule-engine";

export type Rotation =
  | "VAC"
  | "LAC_CATH"
  | "CCU"
  | "LAC_CONSULT"
  | "HF"
  | "KECK_CONSULT"
  | "ECHO1"
  | "EP"
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
  opts?: { randomize?: boolean; maxTries?: number }
): SolveRotationsResult {
  const randomize = !!opts?.randomize;
  const maxTries = opts?.maxTries ?? 40;

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
      EP: new Set<string>(),
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

    // Step A: Reseat vacations out of first five keys if present
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
        // heuristic: prefer Jul-Dec to leave Jan-Jun cleaner for HF
        const julDec = candidateMonths.filter((mi) => mi <= 5);
        const janJun = candidateMonths.filter((mi) => mi >= 6);
        const ordered = randomize ? [...shuffle(julDec), ...shuffle(janJun)] : [...julDec, ...janJun];
        for (const mi of ordered) {
          placePair(f.id, mi, "CCU");
          ccuMonths.add(mi);
          needCCU -= 2;
          if (needCCU <= 0) break;
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

      // HF: 2 half-blocks, Jan-Jun only, not adjacent month to any CCU month
      const ccuMonthList = [...ccuMonths];
      const hfMonthsPlaced = new Set<number>();
      let needHF = 2 - (Object.values(row).filter((x) => x === "HF").length || 0);
      if (needHF > 0) {
        const candidates: { mi: number; k: string }[] = [];
        for (const mi of [...monthToKeys.keys()]) {
          if (!withinJanToJun(mi)) continue;
          // Not adjacent to any CCU month
          let ok = true;
          for (const cm of ccuMonthList) if (isAdjacentMonth(mi, cm)) ok = false;
          if (!ok) continue;
          const keys = monthToKeys.get(mi) || [];
            for (const k of keys) {
              if (!isBlocked(k, "HF") && !row[k]) candidates.push({ mi, k });
            }
        }
        const ordered = randomize ? shuffle(candidates) : candidates;
        for (const c of ordered) {
          if (hfMonthsPlaced.has(c.mi)) continue; // avoid two in same month
          placeSingle(f.id, c.k, "HF");
          hfMonthsPlaced.add(c.mi);
          needHF -= 1;
          if (needHF <= 0) break;
        }
        if (needHF > 0) {
          return { success: false, byFellow: {}, conflicts: [`${f.name || f.id}: unable to place HF.`] };
        }
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

    return { success: true, byFellow };
  }

  for (let t = 0; t < maxTries; t++) {
    const res = tryOnce();
    if (res.success) return res;
  }
  return { success: false, byFellow: {}, conflicts: ["Unable to build PGY-4 rotations within max attempts."] };
}
