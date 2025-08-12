import { differenceInCalendarDays, addDays, isBefore, isAfter, isEqual, parseISO, format } from "date-fns";
import { monthAbbrForIndex } from "@/lib/block-utils";
import { computeAcademicYearHolidays } from "@/lib/holidays";
import { loadSchedule, loadSetup, type Fellow, type PGY, type StoredSchedule, type SetupState } from "@/lib/schedule-engine";

export type CallSchedule = {
  version: 1;
  yearStart: string; // ISO date (YYYY-MM-DD)
  days: Record<string, string>; // date ISO -> fellowId
  countsByFellow: Record<string, number>;
};

export const CALL_SCHEDULE_STORAGE_KEY = "cfsa_calls_v1" as const;

const MAX_CALLS: Record<PGY, number> = {
  "PGY-4": 47,
  "PGY-5": 16,
  "PGY-6": 11,
};

const MIN_SPACING_DAYS = 4; // strict 4-day min for ALL PGYs

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

function afterAug15(d: Date, yearStartISO: string): boolean {
  const start = parseISO(yearStartISO);
  const aug15 = new Date(start.getFullYear(), 7, 15); // Aug is month 7
  return isAfter(d, addDays(aug15, -1)); // on or after Aug 15
}

function dateToBlockKey(d: Date, yearStartISO: string): string {
  const start = parseISO(yearStartISO);
  const monthsDiff = (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth());
  const rel = ((monthsDiff % 12) + 12) % 12; // 0..11
  const abbr = monthAbbrForIndex(rel);
  const day = d.getDate();
  const half = day <= 15 ? 1 : 2;
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
  const max = MAX_CALLS[fellow.pgy];
  return (counts[fellow.id] ?? 0) < max;
}

function hasSpacingOK(fellow: Fellow, lastAssigned: Record<string, string | undefined>, date: Date): boolean {
  const lastISO = lastAssigned[fellow.id];
  if (!lastISO) return true;
  const lastDate = parseISO(lastISO);
  return differenceInCalendarDays(date, lastDate) >= MIN_SPACING_DAYS;
}

function eligiblePoolByPGY(date: Date, setup: SetupState, schedByPGY: Record<PGY, StoredSchedule | null>) {
  const afterAug = afterAug15(date, setup.yearStart);
  const isWeekend = isWeekendDate(date);
  const iso = toISODate(date);
  const holiday = isHoliday(iso, setup);

  const pools: Record<PGY, Fellow[]> = { "PGY-4": [], "PGY-5": [], "PGY-6": [] };
  for (const f of setup.fellows) {
    // Time period eligibility
    if (f.pgy === "PGY-4" && !afterAug) continue; // PGY-4 completely ineligible before Aug 15
    // Rotation exclusions
    const rot = getRotationOnDate(f, date, schedByPGY, setup.yearStart);
    if (rot === "VAC" || rot === "HF") continue;
    pools[f.pgy].push(f);
  }

  // Determine PGY priority list
  let priority: PGY[] = ["PGY-5", "PGY-4", "PGY-6"]; // default fallback order
  if (isWeekend || holiday) {
    // Weekend/holiday logic
    if (afterAug) {
      priority = ["PGY-4", "PGY-5", "PGY-6"]; // PGY-4 weekend priority after Aug 15
    } else {
      priority = ["PGY-5", "PGY-6"]; // Pre-Aug15 weekends: only 5 and 6 eligible
    }
  } else {
    // Weekdays
    const dow = date.getDay(); // 1=Mon ... 5=Fri
    if (afterAug) {
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
      // Pre-Aug15 weekdays: Thursday=PGY-6 preference, others=PGY-5; PGY-4 excluded entirely already
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

export type BuildCallResult = {
  schedule: CallSchedule;
  success: boolean;
  uncovered?: string[];
};

export function buildPrimaryCallSchedule(): BuildCallResult {
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

  function tryAssign(date: Date): boolean {
    const iso = toISODate(date);
    const { pools, priority } = eligiblePoolByPGY(date, setup, schedByPGY);

    // Iterate PGY preference order
    for (const pgy of priority) {
      const candidates = pools[pgy]
        .filter((f) => withinCallLimit(f, counts))
        .filter((f) => hasSpacingOK(f, lastByFellow, date));

      if (candidates.length === 0) continue;

      const picked = pickWeighted(candidates, (f) => 1 / ((counts[f.id] ?? 0) + 1));
      if (picked) {
        assignments[iso] = picked.id;
        lastByFellow[picked.id] = iso;
        counts[picked.id] = (counts[picked.id] ?? 0) + 1;
        return true;
      }
    }

    // As a secondary attempt, pool across all eligible fellows ignoring PGY preference (but keeping all rules)
    const allCandidates = [...pools["PGY-4"], ...pools["PGY-5"], ...pools["PGY-6"]]
      .filter((f) => withinCallLimit(f, counts))
      .filter((f) => hasSpacingOK(f, lastByFellow, date));

    if (allCandidates.length) {
      const picked = pickWeighted(allCandidates, (f) => 1 / ((counts[f.id] ?? 0) + 1));
      if (picked) {
        assignments[iso] = picked.id;
        lastByFellow[picked.id] = iso;
        counts[picked.id] = (counts[picked.id] ?? 0) + 1;
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
        const candidates = groups
          .filter((f) => withinCallLimit(f, counts))
          .filter((f) => hasSpacingOK(f, lastByFellow, date))
          .sort((a, b) => (counts[a.id] ?? 0) - (counts[b.id] ?? 0));

        for (const f of candidates) {
          // place
          assignments[iso] = f.id;
          const prevLast = lastByFellow[f.id];
          lastByFellow[f.id] = iso;
          counts[f.id] = (counts[f.id] ?? 0) + 1;

          if (backtrack(i + 1)) return true;

          // undo
          counts[f.id] = (counts[f.id] ?? 1) - 1;
          if (prevLast) lastByFellow[f.id] = prevLast; else delete lastByFellow[f.id];
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

export function loadCallSchedule(): CallSchedule | null {
  try {
    const raw = localStorage.getItem(CALL_SCHEDULE_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CallSchedule;
  } catch {
    return null;
  }
}

export function saveCallSchedule(schedule: CallSchedule) {
  try {
    localStorage.setItem(CALL_SCHEDULE_STORAGE_KEY, JSON.stringify(schedule));
  } catch {
    // ignore
  }
}
