import { differenceInCalendarDays, addDays, isBefore, isAfter, isEqual, parseISO, format } from "date-fns";
import { monthAbbrForIndex } from "@/lib/block-utils";
import { computeAcademicYearHolidays } from "@/lib/holidays";
import { loadSchedule, loadSetup, type Fellow, type PGY, type StoredSchedule, type SetupState } from "@/lib/schedule-engine";
import { loadSettings } from "@/lib/settings-engine";

type CallSchedule = {
  version: 1;
  yearStart: string; // ISO date (YYYY-MM-DD)
  days: Record<string, string>; // date ISO -> fellowId
  countsByFellow: Record<string, number>;
};

const CALL_SCHEDULE_STORAGE_KEY = "cfsa_calls_v1" as const;

function toISODate(d: Date) {
  return format(d, "yyyy-MM-dd");
}

function july1ToJune30Window(yearStartISO: string): { start: Date; end: Date; days: Date[] } {
  const start = parseISO(yearStartISO);
  const end = addDays(new Date(start.getFullYear() + 1, 5, 30), 0); // June 30 of next year
  // Ensure end date is exactly June 30 of next year
  const days: Date[] = [];
  let cur = start;
  while (!isAfter(cur, end)) {
    days.push(cur);
    cur = addDays(cur, 1);
  }
  return { start, end, days };
}

function isHoliday(dateISO: string, setup: SetupState): boolean {
  const holidays = setup.holidays?.length ? setup.holidays : computeAcademicYearHolidays(setup.yearStart);
  return holidays.some((h) => h.date === dateISO);
}

function isWeekendDate(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6; // Sun or Sat
}

function afterPGY4Start(d: Date, startDate: Date): boolean {
  return isAfter(d, addDays(startDate, -1)); // on or after start date
}

function dateToBlockKey(d: Date, yearStartISO: string): string {
  // Use actual calendar month for block key so it matches generateAcademicYearBlocks
  const abbr = monthAbbrForIndex(d.getMonth());
  const half = d.getDate() <= 15 ? 1 : 2;
  return `${abbr}${half}`;
}

function getRotationOnDate(fellow: Fellow, date: Date, schedByPGY: Record<PGY, StoredSchedule | null>, yearStartISO: string): string | undefined {
  const sched = schedByPGY[fellow.pgy];
  if (!sched || !sched.byFellow) return undefined;
  const row = sched.byFellow[fellow.id] || {};
  const key = dateToBlockKey(date, yearStartISO);
  return row[key];
}

function withinCallLimit(fellow: Fellow, counts: Record<string, number>, maxCalls: Record<PGY, number>): boolean {
  const max = maxCalls[fellow.pgy];
  return (counts[fellow.id] ?? 0) < max;
}

function hasSpacingOK(fellow: Fellow, lastAssigned: Record<string, string | undefined>, date: Date, minSpacing: number): boolean {
  const lastISO = lastAssigned[fellow.id];
  if (!lastISO) return true;
  const lastDate = parseISO(lastISO);
  return differenceInCalendarDays(date, lastDate) >= minSpacing;
}

function isFriday(d: Date): boolean {
  return d.getDay() === 5;
}

function getEquityCategory(date: Date, setup: SetupState): "weekday" | "wkndHol" {
  const dow = date.getDay();
  const iso = toISODate(date);
  const holiday = isHoliday(iso, setup);
  const weekend = isWeekendDate(date);
  
  // Friday holidays count as wkndHol for equity (bug fix)
  if (dow === 5 && holiday) return "wkndHol";
  if (dow === 5) return "weekday"; // Regular Fridays count as weekdays
  
  return weekend || holiday ? "wkndHol" : "weekday";
}

function okNoConsecutiveSaturday(
  fellow: Fellow,
  date: Date,
  lastSaturday: Record<string, string | undefined>,
  noConsecutiveSaturdays: boolean
): boolean {
  if (!noConsecutiveSaturdays) return true; // Rule disabled
  if (date.getDay() !== 6) return true; // Only care about Saturdays
  const prevSatISO = toISODate(addDays(date, -7));
  return lastSaturday[fellow.id] !== prevSatISO;
}

function eligiblePoolByPGY(
  date: Date, 
  setup: SetupState, 
  schedByPGY: Record<PGY, StoredSchedule | null>,
  pgy4StartDate: Date,
  excludeRotations: string[],
  excludeEPOnDays: number[],
  weekdayPriority: Record<number, PGY[]>,
  weekendPriority: PGY[]
) {
  const afterPGY4Eligible = afterPGY4Start(date, pgy4StartDate);
  const isWeekend = isWeekendDate(date);
  const iso = toISODate(date);
  const holiday = isHoliday(iso, setup);

  const pools: Record<PGY, Fellow[]> = { "PGY-4": [], "PGY-5": [], "PGY-6": [] };
  for (const f of setup.fellows) {
    // Time period eligibility
    if (f.pgy === "PGY-4" && !afterPGY4Eligible) continue; // PGY-4 ineligible before start date
    // Rotation exclusions
    const rot = getRotationOnDate(f, date, schedByPGY, setup.yearStart);
    if (rot && excludeRotations.includes(rot)) continue;
    // Exclude EP rotation on configured days
    const dow = date.getDay(); // 0=Sun ... 6=Sat
    if (rot === "EP" && excludeEPOnDays.includes(dow)) continue;
    pools[f.pgy].push(f);
  }

  // Determine PGY priority list
  let priority: PGY[] = ["PGY-5", "PGY-4", "PGY-6"]; // default fallback order
  if (isWeekend || holiday) {
    priority = weekendPriority;
    // Filter pools to only include eligible PGYs
    const eligiblePGYs = new Set(priority);
    for (const pgy of ["PGY-4", "PGY-5", "PGY-6"] as PGY[]) {
      if (!eligiblePGYs.has(pgy)) {
        pools[pgy] = [];
      }
    }
  } else {
    // Weekdays
    const dow = date.getDay(); // 0=Sun, 1=Mon ... 6=Sat
    priority = weekdayPriority[dow] || ["PGY-5", "PGY-4", "PGY-6"];
  }

  return { pools, priority, isWeekend: isWeekend || holiday };
}

function pickWeighted<T>(items: T[], getWeight: (t: T) => number): T | undefined {
  const weights = items.map(getWeight);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return undefined;
  let r = Math.random() * sum;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

type BuildCallResult = {
  schedule: CallSchedule;
  success: boolean;
  uncovered?: string[];
};

function buildPrimaryCallSchedule(opts?: { priorPrimarySeeds?: Record<string, string> }): BuildCallResult {
  const setup = loadSetup();
  const settings = loadSettings();
  
  if (!setup) {
    return {
      schedule: { version: 1, yearStart: toISODate(new Date()), days: {}, countsByFellow: {} },
      success: false,
      uncovered: ["Setup not completed"],
    };
  }

  const schedByPGY: Record<PGY, StoredSchedule | null> = {
    "PGY-4": loadSchedule("PGY-4"),
    "PGY-5": loadSchedule("PGY-5"),
    "PGY-6": loadSchedule("PGY-6"),
  };
  
  // Load settings
  const maxCalls = settings.primaryCall.maxCalls;
  const minSpacing = settings.primaryCall.minSpacingDays;
  const pgy4StartDate = parseISO(settings.primaryCall.pgy4StartDate);
  const excludeRotations = settings.primaryCall.excludeRotations;
  const excludeEPOnDays = settings.primaryCall.excludeEPOnDays;
  const weekdayPriority = settings.primaryCall.weekdayPriority;
  const weekendPriority = settings.primaryCall.weekendPriority;
  const noConsecutiveSaturdays = settings.primaryCall.noConsecutiveSaturdays;

  const { days } = july1ToJune30Window(setup.yearStart);
  const assignments: Record<string, string> = {};
  const lastByFellow: Record<string, string | undefined> = {};
  const counts: Record<string, number> = {};
  const weekdayCatCounts: Record<string, number> = {};
  const wkndHolCatCounts: Record<string, number> = {};
  const lastSaturdayByFellow: Record<string, string | undefined> = {};
  // Seed last assignment dates from priorPrimarySeeds (do not count toward totals)
  const seeds = opts?.priorPrimarySeeds || {};
  for (const [isoSeed, fid] of Object.entries(seeds)) {
    // Only consider seeds strictly before the academic year start
    if (isoSeed < setup.yearStart && fid) {
      const prev = lastByFellow[fid];
      if (!prev || prev < isoSeed) lastByFellow[fid] = isoSeed;
    }
  }

  function tryAssign(date: Date): boolean {
    const iso = toISODate(date);
    const { pools, priority } = eligiblePoolByPGY(date, setup, schedByPGY, pgy4StartDate, excludeRotations, excludeEPOnDays, weekdayPriority, weekendPriority);
    const cat = getEquityCategory(date, setup);

    // Iterate PGY preference order
    for (const pgy of priority) {
      const candidates = pools[pgy]
        .filter((f) => withinCallLimit(f, counts, maxCalls))
        .filter((f) => hasSpacingOK(f, lastByFellow, date, minSpacing))
        .filter((f) => okNoConsecutiveSaturday(f, date, lastSaturdayByFellow, noConsecutiveSaturdays));

      if (candidates.length === 0) continue;

      const picked = pickWeighted(candidates, (f) => {
        // Special PGY-4 weekend/holiday equity optimization after start date
        if (pgy === "PGY-4" && cat === "wkndHol" && afterPGY4Start(date, pgy4StartDate)) {
          const wkndHolCount = wkndHolCatCounts[f.id] ?? 0;
          // Strongly prefer fellows with lowest weekend/holiday count
          return 1 / (wkndHolCount * 10 + 1);
        }
        
        const catCounts = cat === "wkndHol" ? wkndHolCatCounts : weekdayCatCounts;
        return 1 / ((catCounts[f.id] ?? 0) + 1);
      });
      if (picked) {
        assignments[iso] = picked.id;
        lastByFellow[picked.id] = iso;
        counts[picked.id] = (counts[picked.id] ?? 0) + 1;
        if (date.getDay() === 6) lastSaturdayByFellow[picked.id] = iso;
        if (cat === "wkndHol") {
          wkndHolCatCounts[picked.id] = (wkndHolCatCounts[picked.id] ?? 0) + 1;
        } else {
          weekdayCatCounts[picked.id] = (weekdayCatCounts[picked.id] ?? 0) + 1;
        }
        return true;
      }
    }

    // As a secondary attempt, pool across all eligible fellows ignoring PGY preference (but keeping all rules)
    const allCandidates = [...pools["PGY-4"], ...pools["PGY-5"], ...pools["PGY-6"]]
      .filter((f) => withinCallLimit(f, counts, maxCalls))
      .filter((f) => hasSpacingOK(f, lastByFellow, date, minSpacing))
      .filter((f) => okNoConsecutiveSaturday(f, date, lastSaturdayByFellow, noConsecutiveSaturdays));

    if (allCandidates.length) {
      const picked = pickWeighted(allCandidates, (f) => {
        // Apply PGY-4 weekend/holiday equity optimization in fallback too
        if (f.pgy === "PGY-4" && cat === "wkndHol" && afterPGY4Start(date, pgy4StartDate)) {
          const wkndHolCount = wkndHolCatCounts[f.id] ?? 0;
          return 1 / (wkndHolCount * 10 + 1);
        }
        
        const catCounts = cat === "wkndHol" ? wkndHolCatCounts : weekdayCatCounts;
        return 1 / ((catCounts[f.id] ?? 0) + 1);
      });
      if (picked) {
        assignments[iso] = picked.id;
        lastByFellow[picked.id] = iso;
        counts[picked.id] = (counts[picked.id] ?? 0) + 1;
        if (date.getDay() === 6) lastSaturdayByFellow[picked.id] = iso;
        if (cat === "wkndHol") {
          wkndHolCatCounts[picked.id] = (wkndHolCatCounts[picked.id] ?? 0) + 1;
        } else {
          weekdayCatCounts[picked.id] = (weekdayCatCounts[picked.id] ?? 0) + 1;
        }
        return true;
      }
    }

    return false;
  }

  // Build schedule greedily first
  const failures: string[] = [];
  for (const d of days) {
    const ok = tryAssign(d);
    if (!ok) failures.push(toISODate(d));
  }

  // If failures exist, attempt a small sliding-window repair keeping strict constraints
  if (failures.length) {
    const idxByISO = new Map<string, number>(days.map((d, i) => [toISODate(d), i] as const));

    function windowRepair(startIdx: number, endIdx: number): boolean {
      // Backtracking over [startIdx, endIdx]
      const isos = days.slice(startIdx, endIdx + 1).map(toISODate);
      // Snapshot current state to rollback if needed
      const snapshotAssignments = { ...assignments };
      const snapshotLast = { ...lastByFellow };
      const snapshotCounts = { ...counts };

      // Clear window assignments
      for (const iso of isos) {
        const fid = assignments[iso];
        if (fid) {
          snapshotCounts[fid] = (snapshotCounts[fid] ?? 1) - 1;
        }
        delete assignments[iso];
      }

      function backtrack(i: number): boolean {
        if (i >= isos.length) return true;
        const iso = isos[i];
        const date = parseISO(iso);
        const { pools, priority } = eligiblePoolByPGY(date, setup, schedByPGY, pgy4StartDate, excludeRotations, excludeEPOnDays, weekdayPriority, weekendPriority);
        const groups: Fellow[] = [
          ...priority.flatMap((p) => pools[p]),
        ];
        const cat = getEquityCategory(date, setup);
        const candidates = groups
          .filter((f) => withinCallLimit(f, counts, maxCalls))
          .filter((f) => hasSpacingOK(f, lastByFellow, date, minSpacing))
          .filter((f) => okNoConsecutiveSaturday(f, date, lastSaturdayByFellow, noConsecutiveSaturdays))
          .sort((a, b) => {
            const ac = cat === "wkndHol" ? (wkndHolCatCounts[a.id] ?? 0) : (weekdayCatCounts[a.id] ?? 0);
            const bc = cat === "wkndHol" ? (wkndHolCatCounts[b.id] ?? 0) : (weekdayCatCounts[b.id] ?? 0);
            return ac - bc;
          });

        for (const f of candidates) {
          // place
          assignments[iso] = f.id;
          const prevLast = lastByFellow[f.id];
          lastByFellow[f.id] = iso;
          counts[f.id] = (counts[f.id] ?? 0) + 1;
          const prevSat = lastSaturdayByFellow[f.id];
          if (date.getDay() === 6) lastSaturdayByFellow[f.id] = iso;
          if (cat === "wkndHol") {
            wkndHolCatCounts[f.id] = (wkndHolCatCounts[f.id] ?? 0) + 1;
          } else {
            weekdayCatCounts[f.id] = (weekdayCatCounts[f.id] ?? 0) + 1;
          }

          if (backtrack(i + 1)) return true;

          // undo
          counts[f.id] = (counts[f.id] ?? 1) - 1;
          if (prevLast) lastByFellow[f.id] = prevLast; else delete lastByFellow[f.id];
          if (cat === "wkndHol") {
            wkndHolCatCounts[f.id] = (wkndHolCatCounts[f.id] ?? 1) - 1;
          } else {
            weekdayCatCounts[f.id] = (weekdayCatCounts[f.id] ?? 1) - 1;
          }
          if (prevSat) lastSaturdayByFellow[f.id] = prevSat; else delete lastSaturdayByFellow[f.id];
          delete assignments[iso];
        }
        return false;
      }

      const ok = backtrack(0);
      if (!ok) {
        // rollback
        Object.assign(assignments, snapshotAssignments);
        Object.assign(lastByFellow, snapshotLast);
        Object.assign(counts, snapshotCounts);
      }
      return ok;
    }

    for (const iso of failures) {
      const idx = idxByISO.get(iso)!;
      const start = Math.max(0, idx - 5);
      const end = Math.min(days.length - 1, idx + 5);
      const ok = windowRepair(start, end);
      if (!ok) {
        // still uncovered
      }
    }
  }

  // Final uncovered after repair
  const uncovered: string[] = [];
  for (const d of days) {
    const iso = toISODate(d);
    if (!assignments[iso]) uncovered.push(iso);
  }

  const schedule: CallSchedule = {
    version: 1,
    yearStart: setup.yearStart,
    days: assignments,
    countsByFellow: counts,
  };

  return { schedule, success: uncovered.length === 0, uncovered };
}

/**
 * Optimize PGY-4 weekend/holiday equity by performing rule-compliant swaps
 */
function optimizePGY4WkndHolEquity(schedule: CallSchedule): { 
  schedule: CallSchedule; 
  swapsApplied: number; 
  pgy4Stats: Array<{ id: string; name: string; wkndHolCount: number }> 
} {
  const setup = loadSetup();
  if (!setup) return { schedule, swapsApplied: 0, pgy4Stats: [] };

  const pgy4Fellows = setup.fellows.filter(f => f.pgy === "PGY-4");
  let workingSchedule = { ...schedule, days: { ...schedule.days }, countsByFellow: { ...schedule.countsByFellow } };
  let swapsApplied = 0;

  // Calculate current PGY-4 weekend/holiday counts
  function calculatePGY4WkndHolCounts(sched: CallSchedule) {
    const counts: Record<string, number> = {};
    pgy4Fellows.forEach(f => counts[f.id] = 0);

    for (const [dateISO, fellowId] of Object.entries(sched.days)) {
      if (!fellowId || !pgy4Fellows.find(f => f.id === fellowId)) continue;
      const date = parseISO(dateISO);
      const cat = getEquityCategory(date, setup);
      if (cat === "wkndHol") {
        counts[fellowId] = (counts[fellowId] ?? 0) + 1;
      }
    }
    return counts;
  }

  // Perform optimization rounds
  for (let round = 0; round < 5; round++) {
    const wkndHolCounts = calculatePGY4WkndHolCounts(workingSchedule);
    const minCount = Math.min(...Object.values(wkndHolCounts));
    const maxCount = Math.max(...Object.values(wkndHolCounts));
    
    if (maxCount - minCount <= 1) break; // Good enough equity

    // Find beneficial swaps
    const overloadedFellows = pgy4Fellows.filter(f => wkndHolCounts[f.id] > minCount + 1);
    const underloadedFellows = pgy4Fellows.filter(f => wkndHolCounts[f.id] === minCount);

    let swapFound = false;
    
    for (const overloaded of overloadedFellows) {
      if (swapFound) break;
      
      // Find their weekend/holiday assignments
      const overloadedWkndHolDates = Object.entries(workingSchedule.days)
        .filter(([dateISO, fellowId]) => {
          if (fellowId !== overloaded.id) return false;
          const date = parseISO(dateISO);
          return getEquityCategory(date, setup) === "wkndHol";
        })
        .map(([dateISO]) => dateISO);

      for (const underloaded of underloadedFellows) {
        if (swapFound) break;
        
        // Find their weekday assignments
        const underloadedWeekdayDates = Object.entries(workingSchedule.days)
          .filter(([dateISO, fellowId]) => {
            if (fellowId !== underloaded.id) return false;
            const date = parseISO(dateISO);
            return getEquityCategory(date, setup) === "weekday";
          })
          .map(([dateISO]) => dateISO);

        // Try swapping weekend/holiday from overloaded with weekday from underloaded
        for (const wkndHolDate of overloadedWkndHolDates) {
          if (swapFound) break;
          for (const weekdayDate of underloadedWeekdayDates) {
            const swapResult = isValidPrimarySwap(workingSchedule, wkndHolDate, weekdayDate);
            if (swapResult.ok) {
              const appliedSwap = applyPrimarySwap(workingSchedule, wkndHolDate, weekdayDate);
              if (appliedSwap.ok && appliedSwap.schedule) {
                workingSchedule = appliedSwap.schedule;
                swapsApplied++;
                swapFound = true;
                break;
              }
            }
          }
        }
      }
    }

    if (!swapFound) break; // No more beneficial swaps possible
  }

  // Calculate final stats
  const finalCounts = calculatePGY4WkndHolCounts(workingSchedule);
  const pgy4Stats = pgy4Fellows.map(f => ({
    id: f.id,
    name: f.name,
    wkndHolCount: finalCounts[f.id] ?? 0
  })).sort((a, b) => a.name.localeCompare(b.name));

  return { schedule: workingSchedule, swapsApplied, pgy4Stats };
}

function loadCallSchedule(): CallSchedule | null {
  try {
    const raw = localStorage.getItem(CALL_SCHEDULE_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CallSchedule;
  } catch {
    return null;
  }
}

function saveCallSchedule(schedule: CallSchedule) {
  try {
    localStorage.setItem(CALL_SCHEDULE_STORAGE_KEY, JSON.stringify(schedule));
  } catch {
    // ignore
  }
}

// Manual edit helpers for primary call assignments
// Compute dynamic state (last assignment before date, last Saturday, adjusted counts)
function computeStateForDate(schedule: CallSchedule, dateISO: string) {
  const counts: Record<string, number> = { ...schedule.countsByFellow };
  const lastByFellow: Record<string, string | undefined> = {};
  const lastSaturdayByFellow: Record<string, string | undefined> = {};
  const entries = Object.entries(schedule.days).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const target = parseISO(dateISO);
  const curAssigned = schedule.days[dateISO];
  if (curAssigned) counts[curAssigned] = Math.max(0, (counts[curAssigned] ?? 1) - 1);
  for (const [iso, fid] of entries) {
    if (!fid) continue;
    const d = parseISO(iso);
    if (isAfter(d, target) || isEqual(d, target)) continue; // only before the target date
    lastByFellow[fid] = iso;
    if (d.getDay() === 6) lastSaturdayByFellow[fid] = iso;
  }
  return { counts, lastByFellow, lastSaturdayByFellow };
}

function validatePrimaryAssignment(schedule: CallSchedule, dateISO: string, fellowId: string): { ok: boolean; reasons?: string[] } {
  const setup = loadSetup();
  const settings = loadSettings();
  if (!setup) return { ok: false, reasons: ["Setup not completed"] };
  const schedByPGY: Record<PGY, StoredSchedule | null> = {
    "PGY-4": loadSchedule("PGY-4"),
    "PGY-5": loadSchedule("PGY-5"),
    "PGY-6": loadSchedule("PGY-6"),
  };
  const date = parseISO(dateISO);
  const fellow = setup.fellows.find((f) => f.id === fellowId);
  if (!fellow) return { ok: false, reasons: ["Unknown fellow"] };

  const maxCalls = settings.primaryCall.maxCalls;
  const minSpacing = settings.primaryCall.minSpacingDays;
  const pgy4StartDate = parseISO(settings.primaryCall.pgy4StartDate);
  const excludeRotations = settings.primaryCall.excludeRotations;
  const excludeEPOnDays = settings.primaryCall.excludeEPOnDays;
  const weekdayPriority = settings.primaryCall.weekdayPriority;
  const weekendPriority = settings.primaryCall.weekendPriority;
  const noConsecutiveSaturdays = settings.primaryCall.noConsecutiveSaturdays;

  const { pools } = eligiblePoolByPGY(date, setup, schedByPGY, pgy4StartDate, excludeRotations, excludeEPOnDays, weekdayPriority, weekendPriority);
  const eligibleBase = pools[fellow.pgy].some((f) => f.id === fellowId);
  const reasons: string[] = [];
  if (!eligibleBase) reasons.push("Rotation or time-window ineligible for this date");

  const { counts, lastByFellow, lastSaturdayByFellow } = computeStateForDate(schedule, dateISO);
  if (!withinCallLimit(fellow, counts, maxCalls)) reasons.push("Exceeds annual call cap for this PGY");

  // Enforce bidirectional spacing (both previous and next assignments for this fellow)
  const entries = Object.entries(schedule.days)
    .filter(([_, fid]) => fid === fellowId)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  let prevISO: string | undefined;
  let nextISO: string | undefined;
  for (const [iso] of entries) {
    if (iso < dateISO) prevISO = iso;
    if (iso > dateISO) { nextISO = iso; break; }
  }

  if (prevISO) {
    const prevDate = parseISO(prevISO);
    if (differenceInCalendarDays(date, prevDate) < minSpacing) {
      reasons.push(`Must be at least ${minSpacing} days from previous call (${prevISO})`);
    }
  } else {
    // Fallback to computed last state if available (covers cases where current date is being reassigned)
    const lastISO = lastByFellow[fellow.id];
    if (lastISO) {
      const lastDate = parseISO(lastISO);
      if (differenceInCalendarDays(date, lastDate) < minSpacing) {
        reasons.push(`Must be at least ${minSpacing} days from previous call (${lastISO})`);
      }
    }
  }

  if (nextISO) {
    const nextDate = parseISO(nextISO);
    if (differenceInCalendarDays(nextDate, date) < minSpacing) {
      reasons.push(`Must be at least ${minSpacing} days before next call (${nextISO})`);
    }
  }

  // Consecutive Saturday rule in both directions
  if (!okNoConsecutiveSaturday(fellow, date, lastSaturdayByFellow, noConsecutiveSaturdays)) {
    reasons.push("Cannot take consecutive Saturdays");
  }
  if (date.getDay() === 6) {
    const nextSatISO = toISODate(addDays(date, 7));
    if (schedule.days[nextSatISO] === fellowId) {
      reasons.push("Cannot take consecutive Saturdays");
    }
  }

  return { ok: reasons.length === 0, reasons: reasons.length ? reasons : undefined };
}

function listEligiblePrimaryFellows(dateISO: string, schedule: CallSchedule): { id: string; name: string; pgy: PGY }[] {
  const setup = loadSetup();
  const settings = loadSettings();
  if (!setup) return [];
  const schedByPGY: Record<PGY, StoredSchedule | null> = {
    "PGY-4": loadSchedule("PGY-4"),
    "PGY-5": loadSchedule("PGY-5"),
    "PGY-6": loadSchedule("PGY-6"),
  };
  const date = parseISO(dateISO);
  const pgy4StartDate = parseISO(settings.primaryCall.pgy4StartDate);
  const excludeRotations = settings.primaryCall.excludeRotations;
  const excludeEPOnDays = settings.primaryCall.excludeEPOnDays;
  const weekdayPriority = settings.primaryCall.weekdayPriority;
  const weekendPriority = settings.primaryCall.weekendPriority;
  const { pools } = eligiblePoolByPGY(date, setup, schedByPGY, pgy4StartDate, excludeRotations, excludeEPOnDays, weekdayPriority, weekendPriority);
  const all = [...pools["PGY-4"], ...pools["PGY-5"], ...pools["PGY-6"]];
  const eligible = all.filter((f) => validatePrimaryAssignment(schedule, dateISO, f.id).ok);
  return eligible
    .map((f) => ({ id: f.id, name: f.name, pgy: f.pgy }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function listIneligiblePrimaryFellows(dateISO: string, schedule: CallSchedule): { id: string; name: string; pgy: PGY; reasons: string[] }[] {
  const setup = loadSetup();
  if (!setup) return [];
  const items = setup.fellows.map((f) => {
    const res = validatePrimaryAssignment(schedule, dateISO, f.id);
    return { id: f.id, name: f.name, pgy: f.pgy, reasons: res.ok ? [] : (res.reasons ?? []) };
  });
  return items.filter((i) => i.reasons.length > 0).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Create a preview schedule with atomic changes applied
 */
function previewScheduleChange(
  schedule: CallSchedule,
  changes: Array<{ dateISO: string; fellowId: string | null }>
): CallSchedule {
  const preview: CallSchedule = {
    ...schedule,
    days: { ...schedule.days },
    countsByFellow: { ...schedule.countsByFellow },
  };

  // Apply all changes atomically
  for (const { dateISO, fellowId } of changes) {
    const prev = preview.days[dateISO];
    
    if (fellowId === null) {
      // Clear assignment
      if (prev) {
        delete preview.days[dateISO];
        preview.countsByFellow[prev] = Math.max(0, (preview.countsByFellow[prev] ?? 1) - 1);
      }
    } else {
      // Set assignment
      preview.days[dateISO] = fellowId;
      if (prev && prev !== fellowId) {
        preview.countsByFellow[prev] = Math.max(0, (preview.countsByFellow[prev] ?? 1) - 1);
      }
      if (!prev || prev !== fellowId) {
        preview.countsByFellow[fellowId] = (preview.countsByFellow[fellowId] ?? 0) + 1;
      }
    }
  }

  return preview;
}

/**
 * Validate a set of schedule changes using atomic preview
 */
function validateScheduleChange(
  schedule: CallSchedule,
  changes: Array<{ dateISO: string; fellowId: string | null }>
): { ok: boolean; reasons?: string[] } {
  const preview = previewScheduleChange(schedule, changes);
  const reasons: string[] = [];

  // Validate each affected fellow in the final state
  const affectedFellows = new Set<string>();
  for (const { fellowId } of changes) {
    if (fellowId) affectedFellows.add(fellowId);
  }

  for (const fellowId of affectedFellows) {
    // Get all assignments for this fellow in the preview
    const fellowAssignments = Object.entries(preview.days)
      .filter(([_, fid]) => fid === fellowId)
      .map(([dateISO]) => dateISO)
      .sort();

    // Validate each assignment in the context of the complete preview
    for (const dateISO of fellowAssignments) {
      const validation = validatePrimaryAssignment(preview, dateISO, fellowId);
      if (!validation.ok && validation.reasons) {
        reasons.push(...validation.reasons.map(r => `${dateISO}: ${r}`));
      }
    }
  }

  return { ok: reasons.length === 0, reasons: reasons.length ? reasons : undefined };
}

function applyManualPrimaryAssignment(
  schedule: CallSchedule,
  dateISO: string,
  fellowId: string | null
): { ok: boolean; schedule?: CallSchedule; reasons?: string[] } {
  // Clearing is always allowed
  if (fellowId === null) {
    const prev = schedule.days[dateISO];
    const next: CallSchedule = {
      ...schedule,
      days: { ...schedule.days },
      countsByFellow: { ...schedule.countsByFellow },
    };
    if (prev) {
      delete next.days[dateISO];
      next.countsByFellow[prev] = Math.max(0, (next.countsByFellow[prev] ?? 1) - 1);
    } else {
      delete next.days[dateISO];
    }
    return { ok: true, schedule: next };
  }

  const val = validatePrimaryAssignment(schedule, dateISO, fellowId);
  if (!val.ok) return { ok: false, reasons: val.reasons };

  const prev = schedule.days[dateISO];
  const next: CallSchedule = {
    ...schedule,
    days: { ...schedule.days, [dateISO]: fellowId },
    countsByFellow: { ...schedule.countsByFellow },
  };
  if (prev && prev !== fellowId) next.countsByFellow[prev] = Math.max(0, (next.countsByFellow[prev] ?? 1) - 1);
  if (!prev || prev !== fellowId) next.countsByFellow[fellowId] = (next.countsByFellow[fellowId] ?? 0) + 1;

  return { ok: true, schedule: next };
}

type SwapSuggestion = {
  date: string;
  fellowAId: string;
  fellowBId: string;
  score: number;
  notes?: string[];
};

function isValidPrimarySwap(
  schedule: CallSchedule,
  dateAISO: string,
  dateBISO: string
): { ok: boolean; reasons?: string[] } {
  const fidA = schedule.days[dateAISO];
  const fidB = schedule.days[dateBISO];
  if (!fidA || !fidB) return { ok: false, reasons: ["Both dates must be assigned to swap"] };
  if (fidA === fidB) return { ok: false, reasons: ["Same fellow on both dates — swap has no effect"] };

  // Use atomic preview validation to avoid sequential assignment issues
  const changes = [
    { dateISO: dateAISO, fellowId: fidB },
    { dateISO: dateBISO, fellowId: fidA }
  ];

  return validateScheduleChange(schedule, changes);
}

function applyPrimarySwap(
  schedule: CallSchedule,
  dateAISO: string,
  dateBISO: string
): { ok: boolean; schedule?: CallSchedule; reasons?: string[] } {
  const val = isValidPrimarySwap(schedule, dateAISO, dateBISO);
  if (!val.ok) return val;
  
  const fidA = schedule.days[dateAISO]!;
  const fidB = schedule.days[dateBISO]!;
  
  // Apply atomic swap using preview logic
  const changes = [
    { dateISO: dateAISO, fellowId: fidB },
    { dateISO: dateBISO, fellowId: fidA }
  ];
  
  const swappedSchedule = previewScheduleChange(schedule, changes);
  return { ok: true, schedule: swappedSchedule };
}

function listPrimarySwapSuggestions(
  schedule: CallSchedule,
  dateISO: string,
  limit = 10
): SwapSuggestion[] {
  const fidA = schedule.days[dateISO];
  if (!fidA) return [];
  const setup = loadSetup();
  if (!setup) return [];
  const dateA = parseISO(dateISO);
  const catA = getEquityCategory(dateA, setup);

  // Restrict suggestions to PGY-4 when the current date is Friday, weekend, or holiday
  const restrictToPGY4 = isFriday(dateA) || catA === "wkndHol";
  const pgyById = new Map(setup.fellows.map((f) => [f.id, f.pgy] as const));
  if (restrictToPGY4 && pgyById.get(fidA) !== "PGY-4") {
    // If the current assignment isn't PGY-4, no valid PGY-4-to-PGY-4 swaps exist for this rule
    return [];
  }

  const res: SwapSuggestion[] = [];
  for (const [isoB, fidB] of Object.entries(schedule.days)) {
    if (!fidB) continue;
    if (isoB === dateISO) continue;
    if (fidB === fidA) continue; // exclude same-fellow swaps
    if (restrictToPGY4 && pgyById.get(fidB) !== "PGY-4") continue; // enforce PGY-4-only swaps

    const catB = getEquityCategory(parseISO(isoB), setup);
    const notes: string[] = [];
    if (catA !== catB) notes.push("different equity category");
    const check = isValidPrimarySwap(schedule, dateISO, isoB);
    if (!check.ok) continue;
    const diffDays = Math.abs(differenceInCalendarDays(parseISO(isoB), dateA));
    const score = (catA === catB ? 100 : 0) + Math.max(0, 50 - Math.min(50, diffDays));
    res.push({ date: isoB, fellowAId: fidA, fellowBId: fidB, score, notes: notes.length ? notes : undefined });
  }
  res.sort((a, b) => b.score - a.score);
  return res.slice(0, limit);
}

/**
 * Handle drag-and-drop operations (move or swap) for primary call assignments
 */
function applyDragAndDrop(
  schedule: CallSchedule,
  sourceISO: string,
  targetISO: string
): { success: boolean; schedule?: CallSchedule; error?: string } {
  const sourceFellowId = schedule.days[sourceISO];
  const targetFellowId = schedule.days[targetISO];

  if (!sourceFellowId) {
    return { success: false, error: "No assignment to move from source date" };
  }

  if (!targetFellowId) {
    // Move operation: use atomic preview validation
    const changes = [
      { dateISO: sourceISO, fellowId: null },
      { dateISO: targetISO, fellowId: sourceFellowId }
    ];

    const validation = validateScheduleChange(schedule, changes);
    if (!validation.ok) {
      return { success: false, error: validation.reasons?.join(", ") || "Move failed validation" };
    }

    const finalSchedule = previewScheduleChange(schedule, changes);
    return { success: true, schedule: finalSchedule };
  } else {
    // Swap operation
    const swapResult = applyPrimarySwap(schedule, sourceISO, targetISO);
    if (!swapResult.ok) {
      return { success: false, error: swapResult.reasons?.join(", ") || "Swap failed" };
    }
    return { success: true, schedule: swapResult.schedule };
  }
}

export {
  type CallSchedule,
  type BuildCallResult,
  type SwapSuggestion,
  CALL_SCHEDULE_STORAGE_KEY,
  buildPrimaryCallSchedule,
  loadCallSchedule,
  saveCallSchedule,
  validatePrimaryAssignment,
  listEligiblePrimaryFellows,
  listIneligiblePrimaryFellows,
  applyManualPrimaryAssignment,
  isValidPrimarySwap,
  applyPrimarySwap,
  listPrimarySwapSuggestions,
  applyDragAndDrop,
  optimizePGY4WkndHolEquity,
};

