import { differenceInCalendarDays, addDays, parseISO, format, isAfter } from "date-fns";
import { computeAcademicYearHolidays } from "@/lib/holidays";
import { loadSchedule, loadSetup, type Fellow, type PGY, type StoredSchedule, type SetupState } from "@/lib/schedule-engine";
import { loadCallSchedule, type CallSchedule } from "@/lib/call-engine";

export type HFSchedule = {
  version: 1;
  yearStart: string; // ISO date (YYYY-MM-DD)
  weekends: Record<string, string>; // weekend start date ISO -> fellowId
  countsByFellow: Record<string, number>;
};

const HF_SCHEDULE_STORAGE_KEY = "cfsa_hf_v1" as const;

// HF Coverage quotas by PGY level
const HF_QUOTAS: Record<PGY, number> = {
  "PGY-4": 2, // Only during HF rotation
  "PGY-5": 6, // 1 during HF + 5 distributed
  "PGY-6": 3, // 1 during HF + 2 distributed
};

function toISODate(d: Date) {
  return format(d, "yyyy-MM-dd");
}

function isWeekendDate(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6; // Sun or Sat
}

function getWeekendStart(d: Date): Date {
  // Return the Saturday that starts the weekend containing this date
  const day = d.getDay();
  if (day === 6) return d; // Already Saturday
  if (day === 0) return addDays(d, -1); // Sunday -> previous Saturday
  // Weekday -> next Saturday
  return addDays(d, 6 - day);
}

function dateToBlockKey(d: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const abbr = months[d.getMonth()];
  const half = d.getDate() <= 15 ? 1 : 2;
  return `${abbr}${half}`;
}

function getRotationOnDate(fellow: Fellow, date: Date, schedByPGY: Record<PGY, StoredSchedule | null>): string | undefined {
  const sched = schedByPGY[fellow.pgy];
  if (!sched || !sched.byFellow) return undefined;
  const row = sched.byFellow[fellow.id] || {};
  const key = dateToBlockKey(date);
  return row[key];
}

function isHoliday(dateISO: string, setup: SetupState): boolean {
  const holidays = setup.holidays?.length ? setup.holidays : computeAcademicYearHolidays(setup.yearStart);
  return holidays.some((h) => h.date === dateISO);
}

function getHolidayBlock(startDate: Date, setup: SetupState): Date[] {
  // Determine if this is part of a holiday block and return all dates in the block
  const startISO = toISODate(startDate);
  
  if (!isHoliday(startISO, setup)) {
    // Check if it's a weekend that needs coverage
    if (isWeekendDate(startDate)) {
      return [startDate, addDays(startDate, 1)]; // Sat-Sun
    }
    return [startDate];
  }

  const holidays = setup.holidays?.length ? setup.holidays : computeAcademicYearHolidays(setup.yearStart);
  const holiday = holidays.find(h => h.date === startISO);
  
  // Handle special holiday blocks
  if (holiday?.name === "Thanksgiving") {
    // Thu-Sun block
    return [startDate, addDays(startDate, 1), addDays(startDate, 2), addDays(startDate, 3)];
  }
  
  // For Monday holidays, cover Sat-Mon
  const dow = startDate.getDay();
  if (dow === 1) { // Monday
    return [addDays(startDate, -2), addDays(startDate, -1), startDate];
  }
  
  // For Friday holidays, cover Fri-Sun
  if (dow === 5) { // Friday
    return [startDate, addDays(startDate, 1), addDays(startDate, 2)];
  }
  
  // Single day holiday
  return [startDate];
}

function isEligibleForHF(
  fellow: Fellow,
  weekendStart: Date,
  setup: SetupState,
  schedByPGY: Record<PGY, StoredSchedule | null>,
  primarySchedule: CallSchedule | null,
  hfCounts: Record<string, number>,
  lastHFAssignment: Record<string, string | undefined>
): { eligible: boolean; reason?: string } {
  
  // PGY-4 only eligible during HF rotation
  if (fellow.pgy === "PGY-4") {
    const rotation = getRotationOnDate(fellow, weekendStart, schedByPGY);
    if (rotation !== "HF") {
      return { eligible: false, reason: "PGY-4 only eligible during HF rotation" };
    }
  } else {
    // PGY-5 and PGY-6 are eligible except on vacation
    const rotation = getRotationOnDate(fellow, weekendStart, schedByPGY);
    if (rotation === "VAC") {
      return { eligible: false, reason: "Cannot assign during vacation" };
    }
  }
  
  // Check if at quota limit
  const currentCount = hfCounts[fellow.id] || 0;
  const quota = HF_QUOTAS[fellow.pgy];
  if (currentCount >= quota) {
    return { eligible: false, reason: `Already at quota (${currentCount}/${quota})` };
  }
  
  // Check for primary call conflicts (Friday before or Monday after)
  if (primarySchedule) {
    const fridayBefore = addDays(weekendStart, -1);
    const mondayAfter = addDays(weekendStart, 2);
    
    const fridayISO = toISODate(fridayBefore);
    const mondayISO = toISODate(mondayAfter);
    
    if (primarySchedule.days[fridayISO] === fellow.id || primarySchedule.days[mondayISO] === fellow.id) {
      return { eligible: false, reason: "Primary call conflict (Friday before or Monday after)" };
    }
    
    // Also check weekend days for primary call
    const satISO = toISODate(weekendStart);
    const sunISO = toISODate(addDays(weekendStart, 1));
    if (primarySchedule.days[satISO] === fellow.id || primarySchedule.days[sunISO] === fellow.id) {
      return { eligible: false, reason: "Has primary call on weekend" };
    }
  }
  
  // Check 14-day spacing between HF assignments
  const lastISO = lastHFAssignment[fellow.id];
  if (lastISO) {
    const lastDate = parseISO(lastISO);
    const daysBetween = differenceInCalendarDays(weekendStart, lastDate);
    if (daysBetween < 14) {
      return { eligible: false, reason: `Too soon after last HF assignment (${daysBetween} days, need 14)` };
    }
  }
  
  return { eligible: true };
}

function getAllWeekends(yearStartISO: string): Date[] {
  const start = parseISO(yearStartISO);
  const end = new Date(start.getFullYear() + 1, 5, 30); // June 30 next year
  const weekends: Date[] = [];
  
  let current = start;
  while (current <= end) {
    if (isWeekendDate(current)) {
      const weekendStart = getWeekendStart(current);
      const weekendStartISO = toISODate(weekendStart);
      
      // Only add unique weekend starts
      if (!weekends.find(w => toISODate(w) === weekendStartISO)) {
        weekends.push(weekendStart);
      }
    }
    current = addDays(current, 1);
  }
  
  return weekends.sort((a, b) => a.getTime() - b.getTime());
}

function getHolidayWeekends(setup: SetupState): Date[] {
  const holidays = setup.holidays?.length ? setup.holidays : computeAcademicYearHolidays(setup.yearStart);
  const holidayWeekends: Date[] = [];
  
  for (const holiday of holidays) {
    const date = parseISO(holiday.date);
    const holidayBlock = getHolidayBlock(date, setup);
    
    // Find the weekend start for this holiday block
    for (const blockDate of holidayBlock) {
      if (isWeekendDate(blockDate)) {
        const weekendStart = getWeekendStart(blockDate);
        const weekendStartISO = toISODate(weekendStart);
        
        if (!holidayWeekends.find(w => toISODate(w) === weekendStartISO)) {
          holidayWeekends.push(weekendStart);
        }
        break; // Only need one weekend start per holiday block
      }
    }
  }
  
  return holidayWeekends.sort((a, b) => a.getTime() - b.getTime());
}

export function buildHFSchedule(): { 
  schedule: HFSchedule; 
  uncovered: string[]; 
  success: boolean 
} {
  const setup = loadSetup();
  if (!setup) {
    return { 
      schedule: { version: 1, yearStart: "", weekends: {}, countsByFellow: {} }, 
      uncovered: [], 
      success: false 
    };
  }

  const fellows = setup.fellows || [];
  const primarySchedule = loadCallSchedule();
  
  // Load existing block schedules
  const schedByPGY: Record<PGY, StoredSchedule | null> = {
    "PGY-4": loadSchedule("PGY-4"),
    "PGY-5": loadSchedule("PGY-5"), 
    "PGY-6": loadSchedule("PGY-6"),
  };

  const schedule: HFSchedule = {
    version: 1,
    yearStart: setup.yearStart,
    weekends: {},
    countsByFellow: {},
  };

  // Initialize counts
  for (const fellow of fellows) {
    schedule.countsByFellow[fellow.id] = 0;
  }

  const allWeekends = getAllWeekends(setup.yearStart);
  const holidayWeekends = getHolidayWeekends(setup);
  const uncovered: string[] = [];
  const lastHFAssignment: Record<string, string | undefined> = {};

  // Phase 1: Assign HF rotation weekends (first weekend of each fellow's HF rotation)
  for (const fellow of fellows) {
    const sched = schedByPGY[fellow.pgy];
    if (!sched?.byFellow?.[fellow.id]) continue;
    
    const fellowBlocks = sched.byFellow[fellow.id];
    const hfBlocks = Object.entries(fellowBlocks).filter(([_, rotation]) => rotation === "HF");
    
    if (hfBlocks.length > 0) {
      // Find first weekend during HF rotation
      for (const weekend of allWeekends) {
        const rotation = getRotationOnDate(fellow, weekend, schedByPGY);
        if (rotation === "HF") {
          const weekendISO = toISODate(weekend);
          const isHolidayWeekend = holidayWeekends.some(hw => toISODate(hw) === weekendISO);
          
          // Prefer non-holiday weekends for rotation assignments
          if (!isHolidayWeekend && !schedule.weekends[weekendISO]) {
            schedule.weekends[weekendISO] = fellow.id;
            schedule.countsByFellow[fellow.id]++;
            lastHFAssignment[fellow.id] = weekendISO;
            break;
          }
        }
      }
    }
  }

  // Phase 2: Assign remaining weekends
  for (const weekend of allWeekends) {
    const weekendISO = toISODate(weekend);
    
    if (schedule.weekends[weekendISO]) continue; // Already assigned
    
    // Find eligible fellows
    const eligible: Fellow[] = [];
    for (const fellow of fellows) {
      const check = isEligibleForHF(
        fellow, 
        weekend, 
        setup, 
        schedByPGY, 
        primarySchedule, 
        schedule.countsByFellow, 
        lastHFAssignment
      );
      if (check.eligible) {
        eligible.push(fellow);
      }
    }
    
    if (eligible.length === 0) {
      uncovered.push(weekendISO);
      continue;
    }
    
    // Prioritize by quota utilization (assign to fellow with lowest percentage of quota used)
    eligible.sort((a, b) => {
      const aPercent = (schedule.countsByFellow[a.id] || 0) / HF_QUOTAS[a.pgy];
      const bPercent = (schedule.countsByFellow[b.id] || 0) / HF_QUOTAS[b.pgy];
      return aPercent - bPercent;
    });
    
    const selectedFellow = eligible[0];
    schedule.weekends[weekendISO] = selectedFellow.id;
    schedule.countsByFellow[selectedFellow.id]++;
    lastHFAssignment[selectedFellow.id] = weekendISO;
  }

  return {
    schedule,
    uncovered,
    success: uncovered.length === 0,
  };
}

export function loadHFSchedule(): HFSchedule | null {
  try {
    const raw = localStorage.getItem(HF_SCHEDULE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveHFSchedule(schedule: HFSchedule): void {
  try {
    localStorage.setItem(HF_SCHEDULE_STORAGE_KEY, JSON.stringify(schedule));
  } catch {}
}

export function clearHFSchedule(): void {
  try {
    localStorage.removeItem(HF_SCHEDULE_STORAGE_KEY);
  } catch {}
}