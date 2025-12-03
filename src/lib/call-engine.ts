import { differenceInCalendarDays, addDays, isBefore, isAfter, isEqual, parseISO, format } from "date-fns";
import { monthAbbrForIndex } from "@/lib/block-utils";
import { computeAcademicYearHolidays } from "@/lib/holidays";
import { loadSchedule, loadSetup, type Fellow, type PGY, type StoredSchedule, type SetupState } from "@/lib/schedule-engine";
import { loadSettings, type SchedulerSettings } from "./settings-engine";
import { getPrimaryRotation } from "@/lib/rotation-engine";

type CallSchedule = {
  version: 1;
  yearStart: string; // ISO date (YYYY-MM-DD)
  days: Record<string, string>; // date ISO -> fellowId
  countsByFellow: Record<string, number>;
};

type CallCoverageMetadata = {
  uncovered: string[];
  success: boolean;
};

const CALL_SCHEDULE_STORAGE_KEY = "cfsa_calls_v1" as const;
const CALL_COVERAGE_METADATA_KEY = "cfsa_calls_coverage_v1" as const;

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

// Check if a date is on or after the PGY-4 primary call start date (from settings)
function afterPGY4StartDate(d: Date, yearStartISO: string): boolean {
  const settings = loadSettings();
  const start = parseISO(yearStartISO);
  
  // Parse MM-DD format from settings (e.g., "08-15")
  const [month, day] = settings.primaryCall.pgy4StartDate.split('-').map(Number);
  const pgy4Start = new Date(start.getFullYear(), month - 1, day); // month is 0-indexed
  
  return isAfter(d, addDays(pgy4Start, -1)); // on or after the start date
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

function withinCallLimit(fellow: Fellow, counts: Record<string, number>): boolean {
  const settings = loadSettings();
  const max = settings.primaryCall.maxCalls[fellow.pgy];
  return (counts[fellow.id] ?? 0) < max;  // Use < to prevent exceeding limit
}

function hasSpacingOK(fellow: Fellow, lastAssigned: Record<string, string | undefined>, date: Date): boolean {
  const lastISO = lastAssigned[fellow.id];
  if (!lastISO) return true;
  const lastDate = parseISO(lastISO);
  const settings = loadSettings();
  return differenceInCalendarDays(date, lastDate) >= settings.primaryCall.minSpacingDays;
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
  lastSaturday: Record<string, string | undefined>
): boolean {
  const settings = loadSettings();
  
  // If the rule is disabled, allow consecutive Saturdays
  if (!settings.primaryCall.noConsecutiveSaturdays) {
    return true;
  }
  
  // Original logic when rule is enabled
  if (date.getDay() !== 6) return true; // Only care about Saturdays
  const prevSatISO = toISODate(addDays(date, -7));
  return lastSaturday[fellow.id] !== prevSatISO;
}

function isChristmasEveOrNewYearsEve(date: Date): boolean {
  const month = date.getMonth(); // 0-indexed (11 = December, 0 = January)
  const day = date.getDate();
  
  // Christmas Eve: December 24th
  if (month === 11 && day === 24) return true;
  
  // New Year's Eve: December 31st
  if (month === 11 && day === 31) return true;
  
  return false;
}

/**
 * Check if a fellow would be eligible for a specialty clinic on the next day
 * Used to prevent assigning primary call the day before their specialty clinic
 */
function hasSpecialtyClinicNextDay(
  fellow: Fellow,
  currentDate: Date,
  setup: SetupState,
  schedByPGY: Record<PGY, StoredSchedule | null>
): boolean {
  const settings = loadSettings();
  const nextDate = addDays(currentDate, 1);
  const nextDayOfWeek = nextDate.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const nextDateISO = toISODate(nextDate);
  
  // Skip if next day is a holiday (no clinics)
  if (isHoliday(nextDateISO, setup)) {
    return false;
  }
  
  // Get fellow's rotation on the next day
  const rotation = getRotationOnDate(fellow, nextDate, schedByPGY, setup.yearStart);
  if (!rotation) return false;
  
  const primaryRotation = getPrimaryRotation(rotation as any);
  
  // Check each specialty clinic type
  const specialtyConfigs = [
    { config: settings.clinics.specialClinics.heartFailure, type: 'HF' },
    { config: settings.clinics.specialClinics.achd, type: 'ACHD' },
    { config: settings.clinics.specialClinics.device, type: 'Device' },
    { config: settings.clinics.specialClinics.ep, type: 'EP' }
  ];
  
  for (const { config } of specialtyConfigs) {
    // Check if this specialty clinic runs on the next day
    if (config.dayOfWeek !== nextDayOfWeek) continue;
    
    // Check week of month (if the next day falls in the specified weeks)
    const weekOfMonth = Math.ceil(nextDate.getDate() / 7);
    if (!config.weekOfMonth.includes(weekOfMonth)) continue;
    
    // Check if fellow is eligible (correct rotation and PGY)
    const isEligibleRotation = config.eligibleRotations.includes(primaryRotation);
    const isEligiblePGY = config.eligiblePGYs.includes(fellow.pgy);
    
    if (isEligibleRotation && isEligiblePGY) {
      return true; // Fellow has a specialty clinic tomorrow
    }
  }
  
  return false;
}

function eligiblePoolByPGY(date: Date, setup: SetupState, schedByPGY: Record<PGY, StoredSchedule | null>) {
  const afterPGY4Start = afterPGY4StartDate(date, setup.yearStart);
  const isWeekend = isWeekendDate(date);
  const iso = toISODate(date);
  const holiday = isHoliday(iso, setup);
  const settings = loadSettings();

  const pools: Record<PGY, Fellow[]> = { "PGY-4": [], "PGY-5": [], "PGY-6": [] };
  for (const f of setup.fellows) {
    // Time period eligibility
    if (f.pgy === "PGY-4" && !afterPGY4Start) continue; // PGY-4 completely ineligible before start date
    
    // NEW RULE: Exclude PGY-6 from Christmas Eve and New Year's Eve if setting enabled
    if (f.pgy === "PGY-6" && settings.primaryCall.noPGY6OnHolidayEves && isChristmasEveOrNewYearsEve(date)) {
      continue; // Skip this PGY-6 fellow
    }
    
    // NEW RULE: Exclude fellows who have specialty clinic the next day
    if (hasSpecialtyClinicNextDay(f, date, setup, schedByPGY)) {
      continue;
    }
    
    // Rotation exclusions from settings
    const rot = getRotationOnDate(f, date, schedByPGY, setup.yearStart);
    if (settings.primaryCall.excludeRotations.includes(rot)) continue;
    // Exclude EP rotation on specific days if configured
    const dow = date.getDay(); // 0=Sun ... 6=Sat
    if (rot === "EP" && settings.primaryCall.excludeEPOnDays.includes(dow)) continue;
    pools[f.pgy].push(f);
  }

  // Determine PGY priority list
  let priority: PGY[] = ["PGY-5", "PGY-4", "PGY-6"]; // default fallback order
  if (isWeekend || holiday) {
    // Exclude PGY-6 from weekend/holiday primary calls entirely
    pools["PGY-6"] = [];
    if (afterPGY4Start) {
      // CRITICAL: After PGY-4 start date, weekends/holidays are EXCLUSIVELY PGY-4
      // No PGY-5 fallback allowed
      priority = ["PGY-4"];
    } else {
      priority = ["PGY-5"]; // Pre-start date: only PGY-5 eligible on weekends/holidays
    }
  } else {
    // Weekdays
    const dow = date.getDay(); // 1=Mon ... 5=Fri
    if (afterPGY4Start) {
      switch (dow) {
        case 1: // Monday
          priority = ["PGY-5", "PGY-4", "PGY-6"]; break;
        case 2: // Tuesday
          priority = ["PGY-5", "PGY-4", "PGY-6"]; break;
        case 3: // Wednesday
          priority = ["PGY-4", "PGY-5", "PGY-6"]; break;
        case 4: // Thursday
          priority = ["PGY-6", "PGY-4", "PGY-5"]; break;
        case 5: // Friday
          priority = ["PGY-4", "PGY-5", "PGY-6"]; break;
        default:
          priority = ["PGY-5", "PGY-4", "PGY-6"]; // should not hit (Mon-Fri only)
      }
    } else {
      // Pre-start date weekdays: Thursday=PGY-6 preference, others=PGY-5; PGY-4 excluded entirely already
      const dow = date.getDay();
      if (dow === 4) priority = ["PGY-6", "PGY-5"]; else priority = ["PGY-5", "PGY-6"];
    }
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
    const { pools, priority } = eligiblePoolByPGY(date, setup, schedByPGY);
    const cat = getEquityCategory(date, setup);

    // Iterate PGY preference order
    for (const pgy of priority) {
      const candidates = pools[pgy]
        .filter((f) => withinCallLimit(f, counts))
        .filter((f) => hasSpacingOK(f, lastByFellow, date))
        .filter((f) => okNoConsecutiveSaturday(f, date, lastSaturdayByFellow));

      if (candidates.length === 0) continue;

      const picked = pickWeighted(candidates, (f) => {
        // Special PGY-4 weekend/holiday equity optimization after start date
        if (pgy === "PGY-4" && cat === "wkndHol" && afterPGY4StartDate(date, setup.yearStart)) {
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
    // CRITICAL: Skip fallback for weekends/holidays after PGY-4 start - these MUST be PGY-4 only
    const isWeekendOrHoliday = cat === "wkndHol";
    const afterPGY4Start = afterPGY4StartDate(date, setup.yearStart);
    
    if (isWeekendOrHoliday && afterPGY4Start) {
      // No fallback allowed - weekend/holiday must be PGY-4 exclusive after start date
      return false;
    }

    const allCandidates = [...pools["PGY-4"], ...pools["PGY-5"], ...pools["PGY-6"]]
      .filter((f) => withinCallLimit(f, counts))
      .filter((f) => hasSpacingOK(f, lastByFellow, date))
      .filter((f) => okNoConsecutiveSaturday(f, date, lastSaturdayByFellow));

    if (allCandidates.length) {
      const picked = pickWeighted(allCandidates, (f) => {
        // Apply PGY-4 weekend/holiday equity optimization in fallback too
        if (f.pgy === "PGY-4" && cat === "wkndHol" && afterPGY4StartDate(date, setup.yearStart)) {
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
        const { pools, priority } = eligiblePoolByPGY(date, setup, schedByPGY);
        const groups: Fellow[] = [
          ...priority.flatMap((p) => pools[p]),
        ];
        const cat = getEquityCategory(date, setup);
        const candidates = groups
          .filter((f) => withinCallLimit(f, counts))
          .filter((f) => hasSpacingOK(f, lastByFellow, date))
          .filter((f) => okNoConsecutiveSaturday(f, date, lastSaturdayByFellow))
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
 * Lightweight spacing check for equity swaps - uses cached settings
 */
function hasSpacingOKCached(
  fellowId: string,
  date: Date,
  schedule: CallSchedule,
  minSpacingDays: number
): boolean {
  const dateISO = toISODate(date);
  const entries = Object.entries(schedule.days);
  
  // Check spacing before and after the target date
  for (const [iso, fid] of entries) {
    if (fid !== fellowId || iso === dateISO) continue;
    const otherDate = parseISO(iso);
    const diff = Math.abs(differenceInCalendarDays(date, otherDate));
    if (diff < minSpacingDays) return false;
  }
  return true;
}

/**
 * Lightweight consecutive Saturday check for equity swaps - uses cached settings
 */
function okNoConsecutiveSaturdayCached(
  fellowId: string,
  date: Date,
  schedule: CallSchedule,
  noConsecutiveSaturdays: boolean
): boolean {
  if (!noConsecutiveSaturdays) return true;
  if (date.getDay() !== 6) return true; // Only care about Saturdays
  
  const prevSatISO = toISODate(addDays(date, -7));
  const nextSatISO = toISODate(addDays(date, 7));
  
  // Check if fellow is assigned to adjacent Saturdays
  if (schedule.days[prevSatISO] === fellowId) return false;
  if (schedule.days[nextSatISO] === fellowId) return false;
  
  return true;
}

/**
 * Lightweight swap validation for equity optimization - skips rotation/limit checks
 * Since both fellows are already assigned, we only need to validate spacing and Saturday rules
 */
function isValidEquitySwap(
  schedule: CallSchedule,
  dateAISO: string,
  dateBISO: string,
  minSpacingDays: number,
  noConsecutiveSaturdays: boolean,
  setup: SetupState,
  schedByPGY: Record<PGY, StoredSchedule | null>,
  settings: SchedulerSettings
): boolean {
  const fidA = schedule.days[dateAISO];
  const fidB = schedule.days[dateBISO];
  if (!fidA || !fidB || fidA === fidB) return false;

  const dateA = parseISO(dateAISO);
  const dateB = parseISO(dateBISO);

  // Get fellow objects for vacation check
  const fellowA = setup.fellows.find(f => f.id === fidA);
  const fellowB = setup.fellows.find(f => f.id === fidB);
  if (!fellowA || !fellowB) return false;

  // Safety check: Only allow swaps between PGY-4 fellows
  if (fellowA.pgy !== "PGY-4" || fellowB.pgy !== "PGY-4") return false;

  // CRITICAL: Check if Fellow A would be on vacation/excluded rotation on dateB
  const rotationAOnDateB = getRotationOnDate(fellowA, dateB, schedByPGY, setup.yearStart);
  if (settings.primaryCall.excludeRotations.includes(rotationAOnDateB)) return false;

  // CRITICAL: Check if Fellow B would be on vacation/excluded rotation on dateA
  const rotationBOnDateA = getRotationOnDate(fellowB, dateA, schedByPGY, setup.yearStart);
  if (settings.primaryCall.excludeRotations.includes(rotationBOnDateA)) return false;

  // Create a temporary schedule with the swap applied for validation
  const tempSchedule: CallSchedule = {
    ...schedule,
    days: {
      ...schedule.days,
      [dateAISO]: fidB,
      [dateBISO]: fidA,
    },
    countsByFellow: schedule.countsByFellow, // Unchanged for swaps
  };

  // Validate spacing for fellow A at new position (dateB)
  if (!hasSpacingOKCached(fidA, dateB, tempSchedule, minSpacingDays)) return false;
  
  // Validate spacing for fellow B at new position (dateA)
  if (!hasSpacingOKCached(fidB, dateA, tempSchedule, minSpacingDays)) return false;

  // Validate consecutive Saturday rule for fellow A at new position
  if (!okNoConsecutiveSaturdayCached(fidA, dateB, tempSchedule, noConsecutiveSaturdays)) return false;
  
  // Validate consecutive Saturday rule for fellow B at new position
  if (!okNoConsecutiveSaturdayCached(fidB, dateA, tempSchedule, noConsecutiveSaturdays)) return false;

  return true;
}

/**
 * Lightweight swap application for equity optimization
 */
function applyEquitySwap(
  schedule: CallSchedule,
  dateAISO: string,
  dateBISO: string
): CallSchedule {
  const fidA = schedule.days[dateAISO]!;
  const fidB = schedule.days[dateBISO]!;
  
  return {
    ...schedule,
    days: {
      ...schedule.days,
      [dateAISO]: fidB,
      [dateBISO]: fidA,
    },
    // countsByFellow unchanged - it's a swap
  };
}

/**
 * Optimize PGY-4 weekend/holiday equity by performing rule-compliant swaps
 * OPTIMIZED: Caches all data at start and uses lightweight validation
 */
function optimizePGY4WkndHolEquity(schedule: CallSchedule): { 
  schedule: CallSchedule; 
  swapsApplied: number; 
  pgy4Stats: Array<{ id: string; name: string; wkndHolCount: number }> 
} {
  // === STEP 1: Cache all data at start ===
  const setup = loadSetup();
  if (!setup) return { schedule, swapsApplied: 0, pgy4Stats: [] };
  
  const settings = loadSettings();
  const minSpacingDays = settings.primaryCall.minSpacingDays;
  const noConsecutiveSaturdays = settings.primaryCall.noConsecutiveSaturdays;

  // Load block schedules for vacation checking
  const schedByPGY: Record<PGY, StoredSchedule | null> = {
    "PGY-4": loadSchedule("PGY-4"),
    "PGY-5": loadSchedule("PGY-5"),
    "PGY-6": loadSchedule("PGY-6"),
  };

  const pgy4Fellows = setup.fellows.filter(f => f.pgy === "PGY-4");
  const pgy4FellowIds = new Set(pgy4Fellows.map(f => f.id));
  
  let workingSchedule = { 
    ...schedule, 
    days: { ...schedule.days }, 
    countsByFellow: { ...schedule.countsByFellow } 
  };
  let swapsApplied = 0;

  // === STEP 2: Pre-compute equity categories for all dates ===
  const equityCache = new Map<string, "weekday" | "wkndHol">();
  for (const dateISO of Object.keys(schedule.days)) {
    const date = parseISO(dateISO);
    equityCache.set(dateISO, getEquityCategory(date, setup));
  }

  // Helper to calculate PGY-4 weekend/holiday counts using cached equity categories
  function calculatePGY4WkndHolCounts(sched: CallSchedule): Record<string, number> {
    const counts: Record<string, number> = {};
    pgy4Fellows.forEach(f => counts[f.id] = 0);

    for (const [dateISO, fellowId] of Object.entries(sched.days)) {
      if (!fellowId || !pgy4FellowIds.has(fellowId)) continue;
      if (equityCache.get(dateISO) === "wkndHol") {
        counts[fellowId] = (counts[fellowId] ?? 0) + 1;
      }
    }
    return counts;
  }

  // === STEP 3: Perform optimization rounds ===
  for (let round = 0; round < 5; round++) {
    const wkndHolCounts = calculatePGY4WkndHolCounts(workingSchedule);
    const countValues = Object.values(wkndHolCounts);
    if (countValues.length === 0) break;
    
    const minCount = Math.min(...countValues);
    const maxCount = Math.max(...countValues);
    
    if (maxCount - minCount <= 1) break; // Good enough equity

    // === STEP 4: Pre-compute fellow assignment lists for this round ===
    const fellowWkndHolDates = new Map<string, string[]>();
    const fellowWeekdayDates = new Map<string, string[]>();
    
    for (const f of pgy4Fellows) {
      fellowWkndHolDates.set(f.id, []);
      fellowWeekdayDates.set(f.id, []);
    }

    for (const [dateISO, fellowId] of Object.entries(workingSchedule.days)) {
      if (!fellowId || !pgy4FellowIds.has(fellowId)) continue;
      const cat = equityCache.get(dateISO);
      if (cat === "wkndHol") {
        fellowWkndHolDates.get(fellowId)!.push(dateISO);
      } else {
        fellowWeekdayDates.get(fellowId)!.push(dateISO);
      }
    }

    // Find beneficial swaps
    const overloadedFellows = pgy4Fellows.filter(f => wkndHolCounts[f.id] > minCount + 1);
    const underloadedFellows = pgy4Fellows.filter(f => wkndHolCounts[f.id] === minCount);

    let swapFound = false;
    
    for (const overloaded of overloadedFellows) {
      if (swapFound) break;
      
      const overloadedWkndHolDates = fellowWkndHolDates.get(overloaded.id) || [];

      for (const underloaded of underloadedFellows) {
        if (swapFound) break;
        
        const underloadedWeekdayDates = fellowWeekdayDates.get(underloaded.id) || [];

        // Try swapping weekend/holiday from overloaded with weekday from underloaded
        for (const wkndHolDate of overloadedWkndHolDates) {
          if (swapFound) break;
          for (const weekdayDate of underloadedWeekdayDates) {
            // Use lightweight validation
            if (isValidEquitySwap(workingSchedule, wkndHolDate, weekdayDate, minSpacingDays, noConsecutiveSaturdays, setup, schedByPGY, settings)) {
              workingSchedule = applyEquitySwap(workingSchedule, wkndHolDate, weekdayDate);
              swapsApplied++;
              swapFound = true;
              break;
            }
          }
        }
      }
    }

    if (!swapFound) break; // No more beneficial swaps possible
  }

  // Calculate final stats
  const finalCounts = calculatePGY4WkndHolCounts(workingSchedule);
  // Enforce call limits after optimization to clean up any pre-existing violations
  const recalculated = recalculateCallCounts(workingSchedule);
  const { schedule: enforcedSchedule } = enforceCallLimits(recalculated);

  const pgy4Stats = pgy4Fellows.map(f => ({
    id: f.id,
    name: f.name,
    wkndHolCount: finalCounts[f.id] ?? 0
  })).sort((a, b) => a.name.localeCompare(b.name));

  return { schedule: enforcedSchedule, swapsApplied, pgy4Stats };
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

function saveCoverageMetadata(metadata: CallCoverageMetadata) {
  try {
    localStorage.setItem(CALL_COVERAGE_METADATA_KEY, JSON.stringify(metadata));
  } catch {}
}

function loadCoverageMetadata(): CallCoverageMetadata | null {
  try {
    const raw = localStorage.getItem(CALL_COVERAGE_METADATA_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CallCoverageMetadata;
  } catch {
    return null;
  }
}

function clearCoverageMetadata() {
  try {
    localStorage.removeItem(CALL_COVERAGE_METADATA_KEY);
  } catch {}
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
  if (!setup) return { ok: false, reasons: ["Setup not completed"] };
  const schedByPGY: Record<PGY, StoredSchedule | null> = {
    "PGY-4": loadSchedule("PGY-4"),
    "PGY-5": loadSchedule("PGY-5"),
    "PGY-6": loadSchedule("PGY-6"),
  };
  const date = parseISO(dateISO);
  const fellow = setup.fellows.find((f) => f.id === fellowId);
  if (!fellow) return { ok: false, reasons: ["Unknown fellow"] };

  const { pools } = eligiblePoolByPGY(date, setup, schedByPGY);
  const eligibleBase = pools[fellow.pgy].some((f) => f.id === fellowId);
  const reasons: string[] = [];
  if (!eligibleBase) reasons.push("Rotation or time-window ineligible for this date");

  const { counts, lastByFellow, lastSaturdayByFellow } = computeStateForDate(schedule, dateISO);
  
  // Load settings once for all validation checks
  const settings = loadSettings();
  
  if (!withinCallLimit(fellow, counts)) {
    reasons.push(`Exceeds annual call cap for ${fellow.pgy} (${settings.primaryCall.maxCalls[fellow.pgy]} calls)`);
  }

  // Spacing validation
  const minSpacing = settings.primaryCall.minSpacingDays;

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

  // Consecutive Saturday rule in both directions - only if setting is enabled
  if (settings.primaryCall.noConsecutiveSaturdays) {
    if (!okNoConsecutiveSaturday(fellow, date, lastSaturdayByFellow)) {
      reasons.push("Cannot take consecutive Saturdays");
    }
    if (date.getDay() === 6) {
      const nextSatISO = toISODate(addDays(date, 7));
      if (schedule.days[nextSatISO] === fellowId) {
        reasons.push("Cannot take consecutive Saturdays");
      }
    }
  }
  
  // Check PGY-6 holiday eve exclusion
  if (fellow.pgy === "PGY-6" && settings.primaryCall.noPGY6OnHolidayEves && isChristmasEveOrNewYearsEve(date)) {
    reasons.push("PGY-6 excluded from Christmas Eve and New Year's Eve calls");
  }
  
  // Check if fellow has specialty clinic next day
  if (hasSpecialtyClinicNextDay(fellow, date, setup, schedByPGY)) {
    reasons.push("Has specialty clinic scheduled for tomorrow");
  }

  return { ok: reasons.length === 0, reasons: reasons.length ? reasons : undefined };
}

// Combined eligibility calculation for optimal performance
function listAllPrimaryFellowsWithEligibility(
  dateISO: string, 
  schedule: CallSchedule,
  cachedSchedules?: Record<PGY, StoredSchedule | null>
): {
  eligible: { id: string; name: string; pgy: PGY }[];
  ineligible: { id: string; name: string; pgy: PGY; reasons: string[] }[];
} {
  const setup = loadSetup();
  if (!setup) return { eligible: [], ineligible: [] };
  
  // Use cached schedules if provided, otherwise load them
  const schedByPGY = cachedSchedules || {
    "PGY-4": loadSchedule("PGY-4"),
    "PGY-5": loadSchedule("PGY-5"),
    "PGY-6": loadSchedule("PGY-6"),
  };

  const eligible: { id: string; name: string; pgy: PGY }[] = [];
  const ineligible: { id: string; name: string; pgy: PGY; reasons: string[] }[] = [];

  // Single pass through all fellows
  for (const fellow of setup.fellows) {
    const validation = validatePrimaryAssignment(schedule, dateISO, fellow.id);
    
    if (validation.ok) {
      eligible.push({ id: fellow.id, name: fellow.name, pgy: fellow.pgy });
    } else {
      ineligible.push({
        id: fellow.id,
        name: fellow.name,
        pgy: fellow.pgy,
        reasons: validation.reasons ?? []
      });
    }
  }

  return {
    eligible: eligible.sort((a, b) => a.name.localeCompare(b.name)),
    ineligible: ineligible.sort((a, b) => a.name.localeCompare(b.name))
  };
}

function listEligiblePrimaryFellows(
  dateISO: string, 
  schedule: CallSchedule,
  cachedSchedules?: Record<PGY, StoredSchedule | null>
): { id: string; name: string; pgy: PGY }[] {
  return listAllPrimaryFellowsWithEligibility(dateISO, schedule, cachedSchedules).eligible;
}

function listIneligiblePrimaryFellows(
  dateISO: string, 
  schedule: CallSchedule,
  cachedSchedules?: Record<PGY, StoredSchedule | null>
): { id: string; name: string; pgy: PGY; reasons: string[] }[] {
  return listAllPrimaryFellowsWithEligibility(dateISO, schedule, cachedSchedules).ineligible;
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

/**
 * Audit the call schedule to detect discrepancies and limit violations
 */
function auditCallSchedule(schedule: CallSchedule | null): {
  fellows: Array<{
    id: string;
    name: string;
    pgy: PGY;
    actualCalls: number;
    recordedCalls: number;
    maxCalls: number;
    discrepancy: number;
    exceedsLimit: boolean;
  }>;
  totalDiscrepancies: number;
  totalViolations: number;
} {
  const setup = loadSetup();
  const settings = loadSettings();
  
  if (!schedule || !setup) {
    return { fellows: [], totalDiscrepancies: 0, totalViolations: 0 };
  }

  // Count actual assignments from schedule.days
  const actualCounts: Record<string, number> = {};
  for (const fellowId of Object.values(schedule.days)) {
    if (fellowId) {
      actualCounts[fellowId] = (actualCounts[fellowId] ?? 0) + 1;
    }
  }

  // Build audit report for each fellow
  const fellows = setup.fellows.map((fellow) => {
    const actualCalls = actualCounts[fellow.id] ?? 0;
    const recordedCalls = schedule.countsByFellow[fellow.id] ?? 0;
    const maxCalls = settings.primaryCall.maxCalls[fellow.pgy];
    const discrepancy = actualCalls - recordedCalls;
    const exceedsLimit = actualCalls > maxCalls;

    return {
      id: fellow.id,
      name: fellow.name,
      pgy: fellow.pgy,
      actualCalls,
      recordedCalls,
      maxCalls,
      discrepancy,
      exceedsLimit,
    };
  });

  const totalDiscrepancies = fellows.filter((f) => f.discrepancy !== 0).length;
  const totalViolations = fellows.filter((f) => f.exceedsLimit).length;

  return { fellows, totalDiscrepancies, totalViolations };
}

/**
 * Fix count discrepancies by recalculating countsByFellow from actual assignments
 */
function recalculateCallCounts(schedule: CallSchedule): CallSchedule {
  const counts: Record<string, number> = {};
  
  for (const fellowId of Object.values(schedule.days)) {
    if (fellowId) {
      counts[fellowId] = (counts[fellowId] ?? 0) + 1;
    }
  }

  return {
    ...schedule,
    countsByFellow: counts,
  };
}

/**
 * Enforce call limits by removing assignments that exceed maximums
 * Returns a fixed schedule and list of changes made
 */
function enforceCallLimits(schedule: CallSchedule): {
  schedule: CallSchedule;
  removedAssignments: Array<{ dateISO: string; fellowId: string; reason: string }>;
} {
  const setup = loadSetup();
  const settings = loadSettings();
  
  if (!setup) {
    return { schedule, removedAssignments: [] };
  }

  const audit = auditCallSchedule(schedule);
  const removedAssignments: Array<{ dateISO: string; fellowId: string; reason: string }> = [];
  
  // If no violations, return as-is
  if (audit.totalViolations === 0) {
    return { schedule, removedAssignments };
  }

  // For each fellow exceeding limits, remove their most recent assignments
  const fixedSchedule: CallSchedule = {
    ...schedule,
    days: { ...schedule.days },
    countsByFellow: { ...schedule.countsByFellow },
  };

  for (const fellowAudit of audit.fellows) {
    if (!fellowAudit.exceedsLimit) continue;

    const fellow = setup.fellows.find((f) => f.id === fellowAudit.id);
    if (!fellow) continue;

    const excess = fellowAudit.actualCalls - fellowAudit.maxCalls;
    
    // Find all assignments for this fellow, sorted by date (most recent first)
    const assignments = Object.entries(fixedSchedule.days)
      .filter(([_, fid]) => fid === fellowAudit.id)
      .sort((a, b) => b[0].localeCompare(a[0])); // Reverse chronological

    // Remove the most recent excess assignments
    let removed = 0;
    for (const [dateISO] of assignments) {
      if (removed >= excess) break;
      
      delete fixedSchedule.days[dateISO];
      fixedSchedule.countsByFellow[fellowAudit.id] = Math.max(
        0,
        (fixedSchedule.countsByFellow[fellowAudit.id] ?? 1) - 1
      );
      
      removedAssignments.push({
        dateISO,
        fellowId: fellowAudit.id,
        reason: `Exceeded max calls (${fellowAudit.actualCalls}/${fellowAudit.maxCalls})`,
      });
      
      removed++;
    }
  }

  return { schedule: fixedSchedule, removedAssignments };
}

export {
  type CallSchedule,
  type CallCoverageMetadata,
  type BuildCallResult,
  type SwapSuggestion,
  CALL_SCHEDULE_STORAGE_KEY,
  buildPrimaryCallSchedule,
  loadCallSchedule,
  saveCallSchedule,
  saveCoverageMetadata,
  loadCoverageMetadata,
  clearCoverageMetadata,
  validatePrimaryAssignment,
  listEligiblePrimaryFellows,
  listIneligiblePrimaryFellows,
  listAllPrimaryFellowsWithEligibility,
  applyManualPrimaryAssignment,
  isValidPrimarySwap,
  applyPrimarySwap,
  listPrimarySwapSuggestions,
  applyDragAndDrop,
  optimizePGY4WkndHolEquity,
  auditCallSchedule,
  recalculateCallCounts,
  enforceCallLimits,
};

