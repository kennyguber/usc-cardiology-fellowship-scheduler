import { differenceInCalendarDays, addDays, parseISO, format, isAfter } from "date-fns";
import { computeAcademicYearHolidays } from "@/lib/holidays";
import { loadSchedule, loadSetup, type Fellow, type PGY, type StoredSchedule, type SetupState } from "@/lib/schedule-engine";
import { loadCallSchedule, type CallSchedule } from "@/lib/call-engine";
import { loadSettings, type SchedulerSettings } from "@/lib/settings-engine";

export type HFSchedule = {
  version: 2;
  yearStart: string; // ISO date (YYYY-MM-DD)
  weekends: Record<string, string>; // weekend start date ISO -> fellowId
  holidays: Record<string, string[]>; // holiday block start ISO -> [fellowId, ...dates in block]
  countsByFellow: Record<string, number>; // weekend counts
  holidayCountsByFellow: Record<string, number>; // holiday day counts
  dayOverrides?: Record<string, string | null>; // individual day ISO -> fellowId (null = clear assignment)
};

const HF_SCHEDULE_STORAGE_KEY = "cfsa_hf_v2" as const;

// DEPRECATED: These are fallback values only. Actual quotas come from settings.hfCoverage.weekendQuotas
const HF_QUOTAS: Record<PGY, number> = {
  "PGY-4": 2,
  "PGY-5": 7,
  "PGY-6": 2,
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
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const abbr = months[d.getMonth()];
  const half = d.getDate() <= 15 ? 1 : 2;
  return `${abbr}${half}`;
}

function getHFRotationWeekends(fellow: Fellow, schedByPGY: Record<PGY, StoredSchedule | null>, yearStartISO: string): Date[] {
  const sched = schedByPGY[fellow.pgy];
  if (!sched?.byFellow?.[fellow.id]) return [];
  
  const fellowBlocks = sched.byFellow[fellow.id];
  const hfBlocks = Object.entries(fellowBlocks).filter(([_, rotation]) => rotation === "HF");
  
  if (hfBlocks.length === 0) return [];
  
  // Parse academic year start to get proper year calculation
  const academicYearStart = parseISO(yearStartISO);
  const rotationWeekends: Date[] = [];
  
  for (const [blockKey, _] of hfBlocks) {
    // Parse block key like "JUL1" or "JUL2"
    const monthName = blockKey.slice(0, 3);
    const half = parseInt(blockKey.slice(3));
    const monthIndex = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].indexOf(monthName);
    
    if (monthIndex === -1) continue;
    
    // Calculate proper year for this block based on academic year start
    const academicYearStartMonth = academicYearStart.getMonth();
    const academicYearStartYear = academicYearStart.getFullYear();
    
    let blockYear: number;
    if (monthIndex >= academicYearStartMonth) {
      // Same academic year
      blockYear = academicYearStartYear;
    } else {
      // Next calendar year
      blockYear = academicYearStartYear + 1;
    }
    
    if (half === 1) {
      // First half: 1st to 15th
      const start = new Date(blockYear, monthIndex, 1);
      const end = new Date(blockYear, monthIndex, 15);
      
      // Find weekends in this range
      let current = start;
      while (current <= end) {
        if (isWeekendDate(current)) {
          const weekendStart = getWeekendStart(current);
          if (weekendStart >= start && weekendStart <= end) {
            rotationWeekends.push(new Date(weekendStart));
          }
        }
        current = addDays(current, 1);
      }
    } else {
      // Second half: 16th to end of month
      const start = new Date(blockYear, monthIndex, 16);
      const end = new Date(blockYear, monthIndex + 1, 0); // Last day of month
      
      // Find weekends in this range
      let current = start;
      while (current <= end) {
        if (isWeekendDate(current)) {
          const weekendStart = getWeekendStart(current);
          if (weekendStart >= start && weekendStart <= end) {
            rotationWeekends.push(new Date(weekendStart));
          }
        }
        current = addDays(current, 1);
      }
    }
  }
  
  return rotationWeekends.sort((a, b) => a.getTime() - b.getTime());
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

function isHolidayWeekend(weekend: Date, allHolidayBlocks: { startDate: Date; dates: Date[]; isJuly4Weekend: boolean }[]): boolean {
  // Check if this weekend (Saturday-Sunday) overlaps with any holiday block
  const satISO = toISODate(weekend);
  const sunISO = toISODate(addDays(weekend, 1));
  
  return allHolidayBlocks.some(block => {
    const blockDateISOs = block.dates.map(d => toISODate(d));
    // Weekend is a holiday weekend if either Saturday or Sunday is in a holiday block
    return blockDateISOs.includes(satISO) || blockDateISOs.includes(sunISO);
  });
}

// Helper function to check if a weekend is consecutive with the previous assignment
function isConsecutiveWithPreviousWeekend(
  weekendStart: Date,
  lastWeekendAssignment: Record<string, string | undefined>,
  fellowId: string
): boolean {
  const lastAssignmentISO = lastWeekendAssignment[fellowId];
  if (!lastAssignmentISO) return false;
  
  const lastAssignmentDate = parseISO(lastAssignmentISO);
  const daysBetween = differenceInCalendarDays(weekendStart, lastAssignmentDate);
  
  // Consecutive weekends are exactly 7 days apart
  return daysBetween === 7;
}

// Robust function to check for consecutive weekends using effective assignments
function checkConsecutiveWeekends(
  weekendStart: Date,
  fellowId: string,
  schedule: HFSchedule
): { eligible: boolean; reason?: string } {
  const prevWeekend = new Date(weekendStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const nextWeekend = new Date(weekendStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  
  // Check previous weekend
  const prevSaturday = prevWeekend;
  const prevSunday = addDays(prevWeekend, 1);
  const prevSatISO = toISODate(prevSaturday);
  const prevSunISO = toISODate(prevSunday);
  
  const prevSatAssignment = getEffectiveHFAssignment(prevSatISO, schedule);
  const prevSunAssignment = getEffectiveHFAssignment(prevSunISO, schedule);
  
  if (prevSatAssignment === fellowId || prevSunAssignment === fellowId) {
    return { eligible: false, reason: "Would create consecutive weekends (fellow assigned to previous weekend)" };
  }
  
  // Check next weekend
  const nextSaturday = nextWeekend;
  const nextSunday = addDays(nextWeekend, 1);
  const nextSatISO = toISODate(nextSaturday);
  const nextSunISO = toISODate(nextSunday);
  
  const nextSatAssignment = getEffectiveHFAssignment(nextSatISO, schedule);
  const nextSunAssignment = getEffectiveHFAssignment(nextSunISO, schedule);
  
  if (nextSatAssignment === fellowId || nextSunAssignment === fellowId) {
    return { eligible: false, reason: "Would create consecutive weekends (fellow assigned to following weekend)" };
  }
  
  return { eligible: true };
}

function isEligibleForHF(
  fellow: Fellow,
  weekendStart: Date,
  setup: SetupState,
  schedByPGY: Record<PGY, StoredSchedule | null>,
  primarySchedule: CallSchedule | null,
  hfCounts: Record<string, number>,
  lastWeekendAssignment: Record<string, string | undefined>,
  lastHolidayAssignment: Record<string, string | undefined>,
  allHolidayBlocks: { startDate: Date; dates: Date[]; isJuly4Weekend: boolean }[],
  schedule: HFSchedule,
  hfSettings: SchedulerSettings["hfCoverage"],
  options: {
    isMandatory?: boolean;
    isHolidayWeekendOption?: boolean;
    allowPGY6HolidayForThisBlock?: boolean;
    ignoreSpacingAgainstHoliday?: boolean;
    relaxQuota?: boolean;
    relaxSpacing?: boolean;
  } = {}
): { eligible: boolean; reason?: string } {
  
  const { 
    isMandatory = false, 
    isHolidayWeekendOption = false, 
    allowPGY6HolidayForThisBlock = false,
    ignoreSpacingAgainstHoliday = false,
    relaxQuota = false,
    relaxSpacing = false
  } = options;

  // Determine if this weekend is actually a holiday weekend
  const actuallyIsHolidayWeekend = isHolidayWeekendOption || isHolidayWeekend(weekendStart, allHolidayBlocks);
  
  // PGY-6 rules: Check settings for rotation restriction
  if (fellow.pgy === "PGY-6") {
    if (actuallyIsHolidayWeekend) {
      // For holiday weekends, only allow if explicitly permitted for this block
      if (!allowPGY6HolidayForThisBlock) {
        return { eligible: false, reason: "PGY-6 not eligible for this holiday weekend" };
      }
    } else if (hfSettings.pgy6OnlyDuringRotation) {
      // For non-holiday weekends, check if restriction is enabled
      const rotation = getRotationOnDate(fellow, weekendStart, schedByPGY);
      if (rotation !== "HF") {
        return { eligible: false, reason: "PGY-6 not on HF rotation" };
      }
    }
  }
  
  // PGY-4 rotation restriction (configurable)
  if (fellow.pgy === "PGY-4" && hfSettings.pgy4OnlyDuringRotation) {
    const rotation = getRotationOnDate(fellow, weekendStart, schedByPGY);
    if (rotation !== "HF") {
      return { eligible: false, reason: "PGY-4 only eligible during HF rotation" };
    }
  }
  
  // HARDCODED RULE: No fellow on vacation can work HF coverage (applies to all PGYs)
  const rotation = getRotationOnDate(fellow, weekendStart, schedByPGY);
  if (rotation === "VAC") {
    return { eligible: false, reason: "Cannot assign during vacation" };
  }
  
  // Check if at quota limit (use settings quotas)
  if (!isMandatory) {
    const currentCount = hfCounts[fellow.id] || 0;
    const quota = hfSettings.weekendQuotas[fellow.pgy];
    
    // Hard cap for PGY-5 - never allow more than their configured quota
    if (fellow.pgy === "PGY-5" && currentCount >= quota) {
      return { eligible: false, reason: `PGY-5 hard cap reached (${currentCount}/${quota})` };
    }
    
    // For other PGYs, allow quota relaxation if specified
    if (fellow.pgy !== "PGY-5" && !relaxQuota && currentCount >= quota) {
      return { eligible: false, reason: `Already at quota (${currentCount}/${quota})` };
    }
  }
  
  // HARDCODED RULE: Primary call conflicts are always mandatory
  if (primarySchedule) {
    // Cannot work HF weekend if they have primary call on Friday before
    const fridayBefore = addDays(weekendStart, -1);
    const fridayISO = toISODate(fridayBefore);
    
    if (primarySchedule.days[fridayISO] === fellow.id) {
      return { eligible: false, reason: "Primary call conflict (Friday before)" };
    }
    
    // Cannot work HF coverage if they have primary call on the weekend itself
    const satISO = toISODate(weekendStart);
    const sunISO = toISODate(addDays(weekendStart, 1));
    if (primarySchedule.days[satISO] === fellow.id || primarySchedule.days[sunISO] === fellow.id) {
      return { eligible: false, reason: "Has primary call on weekend" };
    }
  }
  
  // Check for consecutive weekends (configurable)
  if (hfSettings.noConsecutiveWeekends) {
    const consecutiveCheck = checkConsecutiveWeekends(weekendStart, fellow.id, schedule);
    if (!consecutiveCheck.eligible) {
      return consecutiveCheck;
    }
  }
  
  // Check minimum spacing between HF assignments (configurable, can be relaxed in emergency pass)
  if (!relaxSpacing && hfSettings.minSpacingDays > 0) {
    // For mandatory assignments, only check spacing against weekend assignments, not holiday assignments
    const relevantLastISO = isMandatory && ignoreSpacingAgainstHoliday 
      ? lastWeekendAssignment[fellow.id] 
      : lastWeekendAssignment[fellow.id];
      
    if (relevantLastISO) {
      const lastDate = parseISO(relevantLastISO);
      const daysBetween = differenceInCalendarDays(weekendStart, lastDate);
      if (daysBetween < hfSettings.minSpacingDays) {
        return { eligible: false, reason: `Too soon after last HF assignment (${daysBetween} days, need ${hfSettings.minSpacingDays})` };
      }
    }
  }
  
  return { eligible: true };
}

function isEligibleForHolidayHF(
  fellow: Fellow,
  holidayBlock: { startDate: Date; dates: Date[]; isJuly4Weekend: boolean },
  setup: SetupState,
  schedByPGY: Record<PGY, StoredSchedule | null>,
  primarySchedule: CallSchedule | null,
  lastHFAssignment: Record<string, string | undefined>,
  hfSettings: SchedulerSettings["hfCoverage"],
  pgy5Available: boolean = true
): { eligible: boolean; reason?: string } {
  
  // Check if this PGY level is eligible for holiday coverage (configurable)
  if (!hfSettings.holidayEligibility.includes(fellow.pgy)) {
    return { eligible: false, reason: `${fellow.pgy} not eligible for holiday coverage per settings` };
  }
  
  // HARDCODED RULE: No fellow on vacation can work holiday coverage
  const rotation = getRotationOnDate(fellow, holidayBlock.startDate, schedByPGY);
  if (rotation === "VAC") {
    return { eligible: false, reason: "Cannot assign during vacation" };
  }
  
  // Check for primary call conflicts on any day in the holiday block
  if (primarySchedule) {
    for (const blockDate of holidayBlock.dates) {
      const dateISO = toISODate(blockDate);
      if (primarySchedule.days[dateISO] === fellow.id) {
        return { eligible: false, reason: "Primary call conflict during holiday block" };
      }
    }
    
    // Check for Friday conflicts before weekend days in the holiday block
    for (const blockDate of holidayBlock.dates) {
      // If this date is a Saturday, check the Friday before
      if (blockDate.getDay() === 6) { // Saturday
        const fridayBefore = addDays(blockDate, -1);
        const fridayISO = toISODate(fridayBefore);
        
        if (primarySchedule.days[fridayISO] === fellow.id) {
          return { eligible: false, reason: "Primary call conflict (Friday before holiday weekend)" };
        }
      }
    }
  }
  
  // Check minimum spacing between HF assignments (configurable)
  if (hfSettings.minSpacingDays > 0) {
    const lastISO = lastHFAssignment[fellow.id];
    if (lastISO) {
      const lastDate = parseISO(lastISO);
      const daysBetween = differenceInCalendarDays(holidayBlock.startDate, lastDate);
      if (daysBetween < hfSettings.minSpacingDays) {
        return { eligible: false, reason: `Too soon after last HF assignment (${daysBetween} days, need ${hfSettings.minSpacingDays})` };
      }
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

function getAllHolidayBlocks(setup: SetupState): { startDate: Date; dates: Date[]; isJuly4Weekend: boolean }[] {
  const holidays = setup.holidays?.length ? setup.holidays : computeAcademicYearHolidays(setup.yearStart);
  const holidayBlocks: { startDate: Date; dates: Date[]; isJuly4Weekend: boolean }[] = [];
  const processedHolidays = new Set<string>();
  
  for (const holiday of holidays) {
    if (processedHolidays.has(holiday.date)) continue;
    
    const date = parseISO(holiday.date);
    const holidayBlock = getHolidayBlock(date, setup);
    const startDate = holidayBlock[0];
    const startISO = toISODate(startDate);
    
    // Check if this is July 4th weekend
    const isJuly4Weekend = holiday.name === "Independence Day" && 
      holidayBlock.some(d => isWeekendDate(d));
    
    holidayBlocks.push({
      startDate,
      dates: holidayBlock,
      isJuly4Weekend
    });
    
    // Mark all dates in this block as processed
    holidayBlock.forEach(d => processedHolidays.add(toISODate(d)));
  }
  
  return holidayBlocks.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
}

export function buildHFSchedule(options: {
  seed?: number;
  randomize?: boolean;
  attempts?: number;
} = {}): { 
  schedule: HFSchedule; 
  uncovered: string[]; 
  uncoveredHolidays: string[];
  success: boolean;
  mandatoryMissed: string[];
} {
  const { seed = Date.now(), randomize = false, attempts = 1 } = options;
  
  // Load user settings
  const settings = loadSettings();
  const hfSettings = settings.hfCoverage;
  
  // Simple seeded random number generator
  let rngSeed = seed;
  const rng = () => {
    rngSeed = (rngSeed * 9301 + 49297) % 233280;
    return rngSeed / 233280;
  };

  const shuffle = <T>(array: T[]): T[] => {
    if (!randomize) return array;
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };

  const setup = loadSetup();
  if (!setup) {
    return { 
      schedule: { 
        version: 2, 
        yearStart: "", 
        weekends: {}, 
        holidays: {},
        countsByFellow: {},
        holidayCountsByFellow: {}
      }, 
      uncovered: [], 
      uncoveredHolidays: [],
      success: false,
      mandatoryMissed: []
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
    version: 2,
    yearStart: setup.yearStart,
    weekends: {},
    holidays: {},
    countsByFellow: {},
    holidayCountsByFellow: {},
  };

  // Initialize counts
  for (const fellow of fellows) {
    schedule.countsByFellow[fellow.id] = 0;
    schedule.holidayCountsByFellow[fellow.id] = 0;
  }

  const allWeekends = getAllWeekends(setup.yearStart);
  const allHolidayBlocks = getAllHolidayBlocks(setup);
  const uncovered: string[] = [];
  const uncoveredHolidays: string[] = [];
  const mandatoryMissed: string[] = [];
  const lastWeekendAssignment: Record<string, string | undefined> = {};

  // Phase 0: Assign holiday blocks using fair distribution
  for (const holidayBlock of shuffle([...allHolidayBlocks])) {
    const blockDates = getHolidayBlock(holidayBlock.startDate, setup);
    
    // Find eligible fellows for this holiday block
    const eligible: Fellow[] = [];
    for (const fellow of fellows) {
      const check = isEligibleForHolidayHF(
        fellow,
        holidayBlock,
        setup,
        schedByPGY,
        primarySchedule,
        lastWeekendAssignment,
        hfSettings
      );
      if (check.eligible) {
        eligible.push(fellow);
      }
    }
    
    if (eligible.length === 0) {
      // No one eligible, mark as uncovered
      const blockStartISO = toISODate(holidayBlock.startDate);
      uncoveredHolidays.push(blockStartISO);
      continue;
    }
    
    // Fair distribution: prioritize lowest holiday count, then overall count
    eligible.sort((a, b) => {
      const aHolidayCount = schedule.holidayCountsByFellow[a.id] || 0;
      const bHolidayCount = schedule.holidayCountsByFellow[b.id] || 0;
      
      // Primary sort: lowest holiday count
      if (aHolidayCount !== bHolidayCount) {
        return aHolidayCount - bHolidayCount;
      }
      
      // Secondary sort: lowest overall count
      const aCount = schedule.countsByFellow[a.id] || 0;
      const bCount = schedule.countsByFellow[b.id] || 0;
      if (aCount !== bCount) {
        return aCount - bCount;
      }
      
      // Tertiary sort: name for consistency
      return a.name.localeCompare(b.name);
    });
    
    const selectedFellow = eligible[0];
    
    // Assign the entire holiday block
    const blockDatesAsStrings = blockDates.map(d => toISODate(d));
    const blockStartISO = toISODate(holidayBlock.startDate);
    schedule.holidays[blockStartISO] = [selectedFellow.id, ...blockDatesAsStrings];
    
    for (const date of blockDates) {
      schedule.holidayCountsByFellow[selectedFellow.id]++;
      
      // If this date is a weekend, also mark it in weekends
      if (date.getDay() === 0 || date.getDay() === 6) {
        const weekendStart = getWeekendStart(date);
        const weekendISO = toISODate(weekendStart);
        if (!schedule.weekends[weekendISO]) {
          schedule.weekends[weekendISO] = selectedFellow.id;
          schedule.countsByFellow[selectedFellow.id]++;
          lastWeekendAssignment[selectedFellow.id] = weekendISO;
        }
      }
    }
  }

  // Phase 1: Mandatory HF rotation assignments (ensure every fellow on HF gets exactly 1 weekend per half-block, prioritizing first non-holiday weekend)
  const hfAssignmentTracker: Record<string, { assigned: boolean; blockKey: string; weekends: Date[]; fellow: Fellow }> = {};
  
  // Build tracker for all fellows on HF rotation (including PGY-6)
  for (const fellow of fellows) {
    
    const sched = schedByPGY[fellow.pgy];
    if (!sched?.byFellow?.[fellow.id]) continue;
    
    const fellowBlocks = sched.byFellow[fellow.id];
    const hfBlocks = Object.entries(fellowBlocks).filter(([_, rotation]) => rotation === "HF");
    
    for (const [blockKey, _] of hfBlocks) {
      const weekends = getHFRotationWeekends(fellow, schedByPGY, setup.yearStart);
      // Filter weekends for this specific half-block
      const blockWeekends = weekends.filter(weekend => {
        const blockKeyForWeekend = dateToBlockKey(weekend);
        return blockKeyForWeekend === blockKey;
      });
      
      hfAssignmentTracker[`${fellow.id}-${blockKey}`] = {
        assigned: false,
        blockKey,
        weekends: blockWeekends,
        fellow
      };
    }
  }
  
  // Assign one weekend per HF half-block, prioritizing first non-holiday weekend
  for (const [trackerId, tracker] of Object.entries(hfAssignmentTracker)) {
    const fellow = tracker.fellow;
    if (tracker.weekends.length === 0) continue;
    
    // Sort weekends chronologically to find first weekend
    const sortedWeekends = [...tracker.weekends].sort((a, b) => a.getTime() - b.getTime());
    
    // Separate non-holiday and holiday weekends, maintaining chronological order
    const nonHolidayWeekends = sortedWeekends.filter(weekend => 
      !isHolidayWeekend(weekend, allHolidayBlocks)
    );
    
    const holidayWeekends = sortedWeekends.filter(weekend => 
      isHolidayWeekend(weekend, allHolidayBlocks)
    );
    
    let assigned = false;
    
    // First try the earliest non-holiday weekend (priority for on-HF fellow)
    for (const weekend of nonHolidayWeekends) {
      const weekendISO = toISODate(weekend);
      if (schedule.weekends[weekendISO]) continue; // Already assigned
      
        const eligibilityCheck = isEligibleForHF(
          fellow, 
          weekend, 
          setup, 
          schedByPGY, 
          primarySchedule, 
          schedule.countsByFellow, 
          lastWeekendAssignment,
          {},
          allHolidayBlocks,
          schedule,
          hfSettings,
          { 
            isMandatory: true, 
            isHolidayWeekendOption: false
          }
        );
      
      if (eligibilityCheck.eligible) {
        schedule.weekends[weekendISO] = fellow.id;
        schedule.countsByFellow[fellow.id]++;
        lastWeekendAssignment[fellow.id] = weekendISO;
        tracker.assigned = true;
        assigned = true;
        break;
      }
    }
    
    // If no non-holiday weekend available and fellow is PGY-5, try holiday weekends
    if (!assigned && fellow.pgy === "PGY-5") {
      for (const weekend of holidayWeekends) {
        const weekendISO = toISODate(weekend);
        if (schedule.weekends[weekendISO]) continue; // Already assigned
        
        const eligibilityCheck = isEligibleForHF(
          fellow, 
          weekend, 
          setup, 
          schedByPGY, 
          primarySchedule, 
          schedule.countsByFellow, 
          lastWeekendAssignment,
          {},
          allHolidayBlocks,
          schedule,
          hfSettings,
          { 
            isMandatory: true, 
            isHolidayWeekendOption: true
          }
        );
        
        if (eligibilityCheck.eligible) {
          schedule.weekends[weekendISO] = fellow.id;
          schedule.countsByFellow[fellow.id]++;
          lastWeekendAssignment[fellow.id] = weekendISO;
          tracker.assigned = true;
          assigned = true;
          break;
        }
      }
    }
    
    // If still no assignment possible, record as mandatory missed
    if (!assigned) {
      mandatoryMissed.push(`${fellow.name} (${fellow.pgy}): No weekends available for mandatory HF assignment in block ${tracker.blockKey}`);
    }
  }

  // Phase 2: Distribute remaining non-holiday weekends based on quota and equity
  const remainingWeekends = allWeekends.filter(weekend => {
    const weekendISO = toISODate(weekend);
    if (schedule.weekends[weekendISO]) return false; // Already assigned
    
    // Only include non-holiday weekends (holiday weekends left unassigned)
    return !isHolidayWeekend(weekend, allHolidayBlocks);
  });
  
  // Multiple passes to ensure all non-holiday weekends are covered
  let relaxQuota = false;
  let relaxSpacing = false;
  let passCount = 0;
  const maxPasses = 4;
  
  while (passCount < maxPasses) {
    let assignedInPass = 0;
    
    for (const weekend of remainingWeekends) {
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
          lastWeekendAssignment, // Always use actual assignments for consecutive check
          {},  // No holiday assignments to consider since we're not auto-assigning them
          allHolidayBlocks,
          schedule,
          hfSettings,
          {
            isMandatory: false,
            isHolidayWeekendOption: false,
            relaxQuota: relaxQuota && fellow.pgy !== "PGY-5", // Never relax quota for PGY-5
            relaxSpacing: relaxSpacing
          }
        );
        if (check.eligible) {
          eligible.push(fellow);
        }
      }
      
      if (eligible.length === 0) {
        continue; // Try in next pass with relaxed constraints
      }
      
      // Fair distribution algorithm: prioritize fellows with lowest count, then longest time since last assignment
      eligible.sort((a, b) => {
        const aCount = schedule.countsByFellow[a.id] || 0;
        const bCount = schedule.countsByFellow[b.id] || 0;
        
        // Primary sort: lowest count
        if (aCount !== bCount) {
          return aCount - bCount;
        }
        
        // Secondary sort: longest time since last assignment (for PGY-5 equity)
        if (a.pgy === "PGY-5" && b.pgy === "PGY-5") {
          const aLastISO = lastWeekendAssignment[a.id];
          const bLastISO = lastWeekendAssignment[b.id];
          
          if (!aLastISO && !bLastISO) {
            return a.name.localeCompare(b.name);
          }
          if (!aLastISO) return -1; // Never assigned goes first
          if (!bLastISO) return 1;
          
          const aLastDate = parseISO(aLastISO);
          const bLastDate = parseISO(bLastISO);
          const aDaysSince = differenceInCalendarDays(weekend, aLastDate);
          const bDaysSince = differenceInCalendarDays(weekend, bLastDate);
          
          return bDaysSince - aDaysSince; // Longest time since last assignment goes first
        }
        
        // Tertiary sort: name for consistency
        return a.name.localeCompare(b.name);
      });
      
      const selectedFellow = eligible[0];
      schedule.weekends[weekendISO] = selectedFellow.id;
      schedule.countsByFellow[selectedFellow.id]++;
      lastWeekendAssignment[selectedFellow.id] = weekendISO;
      assignedInPass++;
    }
    
    passCount++;
    
    // Check if all weekends are covered
    const stillUncovered = remainingWeekends.filter(weekend => {
      const weekendISO = toISODate(weekend);
      return !schedule.weekends[weekendISO];
    });
    
    if (stillUncovered.length === 0) {
      break; // All covered
    }
    
    // If no assignments made in this pass, relax constraints for next pass
    if (assignedInPass === 0) {
      if (!relaxQuota) {
        relaxQuota = true; // Allow quota relaxation for PGY-4 and PGY-6 only
      } else if (!relaxSpacing) {
        relaxSpacing = true; // Emergency pass: relax spacing constraints
      }
    }
  }
  
  // Final pass: assign any remaining uncovered non-holiday weekends to any available fellow
  const finalUncovered = remainingWeekends.filter(weekend => {
    const weekendISO = toISODate(weekend);
    return !schedule.weekends[weekendISO];
  });
  
  for (const weekend of finalUncovered) {
    const weekendISO = toISODate(weekend);
    console.log(`🔍 Final pass: trying to assign uncovered weekend ${weekendISO}`);
    
    // Find ANY eligible fellow, ignoring quotas and spacing
    for (const fellow of fellows) {
      const check = isEligibleForHF(
        fellow, 
        weekend, 
        setup, 
        schedByPGY, 
        primarySchedule, 
        schedule.countsByFellow, 
        lastWeekendAssignment,
        {},
        allHolidayBlocks,
        schedule,
        hfSettings,
        {
          isMandatory: false,
          isHolidayWeekendOption: false,
          relaxQuota: fellow.pgy !== "PGY-5", // Allow quota relaxation except for PGY-5
          relaxSpacing: true
        }
      );
      
      if (check.eligible) {
        console.log(`✅ Final pass: assigned weekend ${weekendISO} to ${fellow.name}`);
        schedule.weekends[weekendISO] = fellow.id;
        schedule.countsByFellow[fellow.id]++;
        lastWeekendAssignment[fellow.id] = weekendISO;
        break;
      } else {
        console.log(`❌ Final pass: ${fellow.name} not eligible for ${weekendISO}: ${check.reason}`);
      }
    }
  }
  
  // Record any still remaining uncovered weekends
  for (const weekend of remainingWeekends) {
    const weekendISO = toISODate(weekend);
    if (!schedule.weekends[weekendISO]) {
      uncovered.push(weekendISO);
      console.log(`⚠️ Weekend ${weekendISO} remains uncovered after all passes`);
    }
  }

  return {
    schedule,
    uncovered,
    uncoveredHolidays,
    success: uncovered.length === 0 && uncoveredHolidays.length === 0 && mandatoryMissed.length === 0,
    mandatoryMissed,
  };
}

export function loadHFSchedule(): HFSchedule | null {
  try {
    const raw = localStorage.getItem(HF_SCHEDULE_STORAGE_KEY);
    if (!raw) return null;
    
    const parsed = JSON.parse(raw);
    
    // Handle backwards compatibility for v1 schedules
    if (parsed.version === 1) {
      return {
        version: 2,
        yearStart: parsed.yearStart,
        weekends: parsed.weekends || {},
        holidays: {},
        countsByFellow: parsed.countsByFellow || {},
        holidayCountsByFellow: {},
      };
    }
    
    return parsed;
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

// Helper functions for manual HF assignment management
export function getEffectiveHFAssignment(dateISO: string, schedule: HFSchedule | null): string | null {
  if (!schedule) return null;
  
  // Check day override first
  if (schedule.dayOverrides?.[dateISO] !== undefined) {
    return schedule.dayOverrides[dateISO];
  }
  
  const date = parseISO(dateISO);
  
  // Check if it's a weekend assignment
  if (isWeekendDate(date)) {
    const weekendStart = getWeekendStart(date);
    const weekendStartISO = toISODate(weekendStart);
    return schedule.weekends[weekendStartISO] || null;
  }
  
  // Check if it's part of a holiday block
  for (const [blockStartISO, fellowAndDates] of Object.entries(schedule.holidays)) {
    if (Array.isArray(fellowAndDates) && fellowAndDates.length > 1) {
      const [fellowId, ...blockDates] = fellowAndDates;
      if (blockDates.includes(dateISO)) {
        return fellowId;
      }
    }
  }
  
  return null;
}

export function getBlockDatesForDate(dateISO: string, setup: SetupState): string[] {
  const date = parseISO(dateISO);
  
  // If it's a weekend date, return the weekend block
  if (isWeekendDate(date)) {
    const weekendStart = getWeekendStart(date);
    return [toISODate(weekendStart), toISODate(addDays(weekendStart, 1))];
  }
  
  // If it's a holiday, return the full holiday block
  if (isHoliday(dateISO, setup)) {
    const holidayBlock = getHolidayBlock(date, setup);
    return holidayBlock.map(d => toISODate(d));
  }
  
  // Single day
  return [dateISO];
}

export function assignHFCoverage(
  dateISO: string, 
  fellowId: string | null, 
  targetScope: 'day' | 'block',
  schedule: HFSchedule,
  setup: SetupState
): HFSchedule {
  const newSchedule = { ...schedule };
  if (!newSchedule.dayOverrides) {
    newSchedule.dayOverrides = {};
  }
  
  const date = parseISO(dateISO);
  const targetDates = targetScope === 'block' 
    ? getBlockDatesForDate(dateISO, setup)
    : [dateISO];
  
  for (const targetDateISO of targetDates) {
    newSchedule.dayOverrides[targetDateISO] = fellowId;
  }
  
  return newSchedule;
}

export function clearHFCoverage(
  dateISO: string,
  targetScope: 'day' | 'block',
  schedule: HFSchedule,
  setup: SetupState
): HFSchedule {
  return assignHFCoverage(dateISO, null, targetScope, schedule, setup);
}

export function validateManualHFAssignment(
  dateISO: string,
  fellowId: string,
  targetScope: 'day' | 'block',
  setup: SetupState,
  callSchedule: any, // CallSchedule from call-engine
  schedByPGY: Record<PGY, StoredSchedule | null>,
  fellows: Fellow[],
  hfSchedule?: HFSchedule | null
): { isValid: boolean; reason?: string } {
  const fellow = fellows.find(f => f.id === fellowId);
  if (!fellow) {
    return { isValid: false, reason: "Fellow not found" };
  }

  // Load settings for validation
  const settings = loadSettings();
  const hfSettings = settings.hfCoverage;

  if (!callSchedule) {
    return { isValid: true }; // If no call schedule, allow assignment
  }

  const targetDates = targetScope === 'block' 
    ? getBlockDatesForDate(dateISO, setup)
    : [dateISO];

  // Check if this is a holiday weekend assignment
  const allHolidayBlocks = getAllHolidayBlocks(setup);
  const isHolidayAssignment = targetDates.some(targetDateISO => {
    const targetDate = parseISO(targetDateISO);
    if (isWeekendDate(targetDate)) {
      const weekendStart = getWeekendStart(targetDate);
      return isHolidayWeekend(weekendStart, allHolidayBlocks);
    }
    return false;
  });


  // Check all dates in the assignment block
  for (const targetDateISO of targetDates) {
    const targetDate = parseISO(targetDateISO);
    
    // HARDCODED RULE: Check if fellow is on vacation during this date
    const rotation = getRotationOnDate(fellow, targetDate, schedByPGY);
    if (rotation === "VAC") {
      return { 
        isValid: false, 
        reason: `Fellow is on vacation on ${format(targetDate, "MMM d")}`
      };
    }

    // HARDCODED RULE: Check if fellow is on primary call on this date
    if (callSchedule.days[targetDateISO] === fellowId) {
      return { 
        isValid: false, 
        reason: `Fellow is on primary call on ${format(targetDate, "MMM d")}`
      };
    }

    // HARDCODED RULE: Check if fellow is on primary call the day before
    const dayBefore = addDays(targetDate, -1);
    const dayBeforeISO = toISODate(dayBefore);
    if (callSchedule.days[dayBeforeISO] === fellowId) {
      return { 
        isValid: false, 
        reason: `Fellow is on primary call the day before ${format(targetDate, "MMM d")}`
      };
    }
  }

  // Check for consecutive weekends if setting enabled and HF schedule is provided
  if (hfSettings.noConsecutiveWeekends && hfSchedule && targetDates.some(d => isWeekendDate(parseISO(d)))) {
    for (const targetDateISO of targetDates) {
      const targetDate = parseISO(targetDateISO);
      if (isWeekendDate(targetDate)) {
        const weekendStart = getWeekendStart(targetDate);
        const consecutiveCheck = checkConsecutiveWeekends(weekendStart, fellowId, hfSchedule);
        if (!consecutiveCheck.eligible) {
          return { 
            isValid: false, 
            reason: consecutiveCheck.reason || "Would create consecutive weekend assignments"
          };
        }
      }
    }
  }

  return { isValid: true };
}

export function analyzeHFSchedule(schedule: HFSchedule, fellows: Fellow[], setup: SetupState): {
  fellowStats: Record<string, {
    weekendCount: number;
    holidayDayCount: number;
    effectiveWeekendCount: number; // includes fractional weekends from day overrides
    avgGapDays: number | null;
    minGapDays: number | null;
  }>;
  uncoveredWeekends: string[];
  uncoveredHolidays: string[];
} {
  const fellowStats: Record<string, {
    weekendCount: number;
    holidayDayCount: number;
    effectiveWeekendCount: number;
    avgGapDays: number | null;
    minGapDays: number | null;
  }> = {};
  
  // Initialize stats
  for (const fellow of fellows) {
    fellowStats[fellow.id] = {
      weekendCount: 0,
      holidayDayCount: 0,
      effectiveWeekendCount: 0,
      avgGapDays: null,
      minGapDays: null
    };
  }
  
  const weekendTracker: Record<string, Set<string>> = {}; // weekendStartISO -> Set of fellowIds assigned to days
  const uncoveredWeekends: string[] = [];
  const uncoveredHolidays: string[] = [];
  const allWeekends = getAllWeekends(setup.yearStart);
  const allHolidayBlocks = getAllHolidayBlocks(setup);
  
  // Analyze all dates in the academic year
  const start = parseISO(setup.yearStart);
  const end = new Date(start.getFullYear() + 1, 5, 30); // June 30 next year
  let current = start;
  
  while (current <= end) {
    const currentISO = toISODate(current);
    const assignedFellowId = getEffectiveHFAssignment(currentISO, schedule);
    
    if (isWeekendDate(current)) {
      const weekendStart = getWeekendStart(current);
      const weekendStartISO = toISODate(weekendStart);
      
      if (!weekendTracker[weekendStartISO]) {
        weekendTracker[weekendStartISO] = new Set();
      }
      
      if (assignedFellowId) {
        weekendTracker[weekendStartISO].add(assignedFellowId);
      }
    }
    
    // Count holiday days - count all days within a holiday block as covered by the assigned fellow
    if (assignedFellowId) {
      // Check if this date is within any holiday block
      for (const holidayBlock of allHolidayBlocks) {
        const blockDateISOs = holidayBlock.dates.map(d => toISODate(d));
        if (blockDateISOs.includes(currentISO)) {
          fellowStats[assignedFellowId].holidayDayCount++;
          break; // Only count once per date
        }
      }
    }
    
    current = addDays(current, 1);
  }
  
  // Track fellow weekend assignments for gap calculation
  const fellowWeekendAssignments: Record<string, Date[]> = {};
  for (const fellow of fellows) {
    fellowWeekendAssignments[fellow.id] = [];
  }
  
  // Calculate weekend counts and coverage
  for (const weekend of allWeekends) {
    const weekendStartISO = toISODate(weekend);
    const assignedFellows = weekendTracker[weekendStartISO] || new Set();
    const isHolidayWeekendFlag = isHolidayWeekend(weekend, allHolidayBlocks);
    
    if (assignedFellows.size === 0) {
      uncoveredWeekends.push(weekendStartISO);
    } else {
      // Count effective weekend coverage
      for (const fellowId of assignedFellows) {
        if (fellowStats[fellowId]) {
          // If fellow covers both days, count as 1 weekend
          // If fellow covers only 1 day, count as 0.5 weekend
          const weekendDays = [weekend, addDays(weekend, 1)];
          const daysCovered = weekendDays.filter(day => {
            const dayISO = toISODate(day);
            return getEffectiveHFAssignment(dayISO, schedule) === fellowId;
          }).length;
          
          if (daysCovered === 2) {
            // Only count as non-holiday weekend if it's not a holiday weekend
            if (!isHolidayWeekendFlag) {
              fellowStats[fellowId].weekendCount++;
              fellowWeekendAssignments[fellowId].push(weekend);
            }
            fellowStats[fellowId].effectiveWeekendCount++;
          } else if (daysCovered === 1) {
            fellowStats[fellowId].effectiveWeekendCount += 0.5;
          }
        }
      }
    }
  }
  
  // Calculate gap statistics for each fellow based on non-holiday weekends only
  for (const fellow of fellows) {
    const weekends = fellowWeekendAssignments[fellow.id];
    if (weekends.length > 1) {
      weekends.sort((a, b) => a.getTime() - b.getTime());
      const gaps: number[] = [];
      
      for (let i = 1; i < weekends.length; i++) {
        const gapDays = Math.floor((weekends[i].getTime() - weekends[i-1].getTime()) / (1000 * 60 * 60 * 24));
        gaps.push(gapDays);
      }
      
      if (gaps.length > 0) {
        fellowStats[fellow.id].avgGapDays = Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length);
        fellowStats[fellow.id].minGapDays = Math.min(...gaps);
      }
    }
  }
  
  // Check holiday block coverage
  for (const holidayBlock of allHolidayBlocks) {
    const blockStartISO = toISODate(holidayBlock.startDate);
    const hasAnyCoverage = holidayBlock.dates.some(date => {
      const dateISO = toISODate(date);
      return getEffectiveHFAssignment(dateISO, schedule) !== null;
    });
    
    if (!hasAnyCoverage) {
      uncoveredHolidays.push(blockStartISO);
    }
  }
  
  return {
    fellowStats,
    uncoveredWeekends,
    uncoveredHolidays
  };
}