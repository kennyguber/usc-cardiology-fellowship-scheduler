import { differenceInCalendarDays, addDays, parseISO, format, isAfter } from "date-fns";
import { computeAcademicYearHolidays } from "@/lib/holidays";
import { loadSchedule, loadSetup, type Fellow, type PGY, type StoredSchedule, type SetupState } from "@/lib/schedule-engine";
import { loadCallSchedule, type CallSchedule } from "@/lib/call-engine";

export type HFSchedule = {
  version: 2;
  yearStart: string; // ISO date (YYYY-MM-DD)
  weekends: Record<string, string>; // weekend start date ISO -> fellowId
  holidays: Record<string, string[]>; // holiday block start ISO -> [fellowId, ...dates in block]
  countsByFellow: Record<string, number>; // weekend counts
  holidayCountsByFellow: Record<string, number>; // holiday day counts
};

const HF_SCHEDULE_STORAGE_KEY = "cfsa_hf_v2" as const;

// HF Coverage quotas by PGY level (weekends only)
const HF_QUOTAS: Record<PGY, number> = {
  "PGY-4": 2, // Only during HF rotation
  "PGY-5": 6, // 1 during HF + 5 distributed
  "PGY-6": 0, // No regular HF assignments (except July 4th weekend last resort)
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

function isEligibleForHF(
  fellow: Fellow,
  weekendStart: Date,
  setup: SetupState,
  schedByPGY: Record<PGY, StoredSchedule | null>,
  primarySchedule: CallSchedule | null,
  hfCounts: Record<string, number>,
  lastHFAssignment: Record<string, string | undefined>,
  isJuly4Weekend: boolean = false,
  relaxQuota: boolean = false
): { eligible: boolean; reason?: string } {
  
  // PGY-6 rules: Only eligible for July 4th weekend or specific edge cases
  if (fellow.pgy === "PGY-6") {
    if (!isJuly4Weekend) {
      return { eligible: false, reason: "PGY-6 not eligible for non-holiday HF assignments" };
    }
  }
  
  // PGY-4 only eligible during HF rotation
  if (fellow.pgy === "PGY-4") {
    const rotation = getRotationOnDate(fellow, weekendStart, schedByPGY);
    if (rotation !== "HF") {
      return { eligible: false, reason: "PGY-4 only eligible during HF rotation" };
    }
  } else if (fellow.pgy === "PGY-5") {
    // PGY-5s eligible except on vacation
    const rotation = getRotationOnDate(fellow, weekendStart, schedByPGY);
    if (rotation === "VAC") {
      return { eligible: false, reason: "Cannot assign during vacation" };
    }
  }
  
  // Check if at quota limit (unless relaxing for coverage)
  if (!relaxQuota) {
    const currentCount = hfCounts[fellow.id] || 0;
    const quota = HF_QUOTAS[fellow.pgy];
    if (currentCount >= quota && !(fellow.pgy === "PGY-6" && isJuly4Weekend)) {
      return { eligible: false, reason: `Already at quota (${currentCount}/${quota})` };
    }
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

function isEligibleForHolidayHF(
  fellow: Fellow,
  holidayBlock: { startDate: Date; dates: Date[]; isJuly4Weekend: boolean },
  setup: SetupState,
  schedByPGY: Record<PGY, StoredSchedule | null>,
  primarySchedule: CallSchedule | null,
  lastHFAssignment: Record<string, string | undefined>,
  pgy5Available: boolean = true
): { eligible: boolean; reason?: string } {
  
  // PGY-6 rules: Only eligible for July 4th or if no PGY-5s available, OR if on HF with only holiday weekends
  if (fellow.pgy === "PGY-6") {
    if (holidayBlock.isJuly4Weekend) {
      // Always eligible for July 4th if no PGY-5s available
      if (pgy5Available) {
        return { eligible: false, reason: "PGY-5s available for July 4th weekend" };
      }
    } else {
      // For other holidays, only if on HF rotation with only holiday weekends in their block
      const rotation = getRotationOnDate(fellow, holidayBlock.startDate, schedByPGY);
      if (rotation !== "HF") {
        return { eligible: false, reason: "PGY-6 not on HF rotation" };
      }
      
      // Check if their HF block contains only holiday weekends
      const hfWeekends = getHFRotationWeekends(fellow, schedByPGY, setup.yearStart);
      const allHolidayBlocks = getAllHolidayBlocks(setup);
      const nonHolidayWeekendsInBlock = hfWeekends.filter(weekend => {
        const weekendISO = toISODate(weekend);
        return !allHolidayBlocks.some(block => 
          block.dates.some(d => toISODate(getWeekendStart(d)) === weekendISO)
        );
      });
      
      if (nonHolidayWeekendsInBlock.length > 0) {
        return { eligible: false, reason: "PGY-6 has non-holiday weekends available in HF block" };
      }
    }
  }
  
  // PGY-4 only eligible during HF rotation for first date of block
  if (fellow.pgy === "PGY-4") {
    const rotation = getRotationOnDate(fellow, holidayBlock.startDate, schedByPGY);
    if (rotation !== "HF") {
      return { eligible: false, reason: "PGY-4 only eligible during HF rotation" };
    }
  } else if (fellow.pgy === "PGY-5") {
    // PGY-5s eligible except on vacation
    const rotation = getRotationOnDate(fellow, holidayBlock.startDate, schedByPGY);
    if (rotation === "VAC") {
      return { eligible: false, reason: "Cannot assign during vacation" };
    }
  }
  
  // Check for primary call conflicts on any day in the holiday block
  if (primarySchedule) {
    for (const blockDate of holidayBlock.dates) {
      const dateISO = toISODate(blockDate);
      if (primarySchedule.days[dateISO] === fellow.id) {
        return { eligible: false, reason: "Primary call conflict during holiday block" };
      }
    }
  }
  
  // Check 14-day spacing between HF assignments
  const lastISO = lastHFAssignment[fellow.id];
  if (lastISO) {
    const lastDate = parseISO(lastISO);
    const daysBetween = differenceInCalendarDays(holidayBlock.startDate, lastDate);
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

export function buildHFSchedule(): { 
  schedule: HFSchedule; 
  uncovered: string[]; 
  uncoveredHolidays: string[];
  success: boolean;
  mandatoryMissed: string[];
} {
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
  const lastHFAssignment: Record<string, string | undefined> = {};

  // Phase 1: Assign holiday blocks (prioritize PGY-5s, then PGY-4s on HF, then PGY-6s for edge cases)
  for (const holidayBlock of allHolidayBlocks) {
    const blockStartISO = toISODate(holidayBlock.startDate);
    
    // Check if PGY-5s are available for July 4th
    const pgy5Available = fellows.some(fellow => {
      if (fellow.pgy !== "PGY-5") return false;
      const check = isEligibleForHolidayHF(
        fellow, 
        holidayBlock, 
        setup, 
        schedByPGY, 
        primarySchedule, 
        lastHFAssignment,
        true
      );
      return check.eligible;
    });
    
    // Find eligible fellows with priority order
    const pgy5Eligible: Fellow[] = [];
    const pgy4Eligible: Fellow[] = [];
    const pgy6Eligible: Fellow[] = [];
    
    for (const fellow of fellows) {
      const check = isEligibleForHolidayHF(
        fellow, 
        holidayBlock, 
        setup, 
        schedByPGY, 
        primarySchedule, 
        lastHFAssignment,
        pgy5Available
      );
      if (check.eligible) {
        if (fellow.pgy === "PGY-5") {
          pgy5Eligible.push(fellow);
        } else if (fellow.pgy === "PGY-4") {
          pgy4Eligible.push(fellow);
        } else if (fellow.pgy === "PGY-6") {
          pgy6Eligible.push(fellow);
        }
      }
    }
    
    // Select fellow based on priority: PGY-5 -> PGY-4 -> PGY-6
    let selectedFellow: Fellow | null = null;
    let eligiblePool: Fellow[] = [];
    
    if (pgy5Eligible.length > 0) {
      eligiblePool = pgy5Eligible;
    } else if (pgy4Eligible.length > 0) {
      eligiblePool = pgy4Eligible;
    } else if (pgy6Eligible.length > 0) {
      eligiblePool = pgy6Eligible;
    }
    
    if (eligiblePool.length === 0) {
      uncoveredHolidays.push(blockStartISO);
      continue;
    }
    
    // Within each PGY group, prioritize by holiday equity (lowest holiday day count first)
    eligiblePool.sort((a, b) => {
      const aCount = schedule.holidayCountsByFellow[a.id] || 0;
      const bCount = schedule.holidayCountsByFellow[b.id] || 0;
      if (aCount !== bCount) return aCount - bCount;
      
      // Secondary sort by name for consistency
      return a.name.localeCompare(b.name);
    });
    
    selectedFellow = eligiblePool[0];
    const blockDates = holidayBlock.dates.map(d => toISODate(d));
    
    schedule.holidays[blockStartISO] = [selectedFellow.id, ...blockDates];
    schedule.holidayCountsByFellow[selectedFellow.id] += blockDates.length;
    lastHFAssignment[selectedFellow.id] = blockStartISO;
  }

  // Phase 2: Mandatory HF rotation assignments (ensure every fellow on HF gets exactly 1 weekend per half-block)
  const hfAssignmentTracker: Record<string, { assigned: boolean; blockKey: string; weekends: Date[] }> = {};
  
  // Build tracker for all fellows on HF rotation
  for (const fellow of fellows) {
    if (fellow.pgy === "PGY-6") continue; // PGY-6 handled separately
    
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
        weekends: blockWeekends
      };
    }
  }
  
  // Assign one weekend per HF half-block
  for (const [trackerId, tracker] of Object.entries(hfAssignmentTracker)) {
    const fellowId = trackerId.split('-')[0];
    const fellow = fellows.find(f => f.id === fellowId);
    if (!fellow || tracker.weekends.length === 0) continue;
    
    // Prioritize non-holiday weekends first
    const nonHolidayWeekends = tracker.weekends.filter(weekend => {
      const weekendISO = toISODate(weekend);
      return !allHolidayBlocks.some(block => 
        block.dates.some(d => toISODate(getWeekendStart(d)) === weekendISO)
      );
    });
    
    const holidayWeekends = tracker.weekends.filter(weekend => {
      const weekendISO = toISODate(weekend);
      return allHolidayBlocks.some(block => 
        block.dates.some(d => toISODate(getWeekendStart(d)) === weekendISO)
      );
    });
    
    let assigned = false;
    
    // Try non-holiday weekends first
    for (const weekend of nonHolidayWeekends) {
      const weekendISO = toISODate(weekend);
      if (schedule.weekends[weekendISO]) continue; // Already assigned
      
      const eligibilityCheck = isEligibleForHF(
        fellow, weekend, setup, schedByPGY, primarySchedule, schedule.countsByFellow, lastHFAssignment
      );
      
      if (eligibilityCheck.eligible) {
        schedule.weekends[weekendISO] = fellow.id;
        schedule.countsByFellow[fellow.id]++;
        lastHFAssignment[fellow.id] = weekendISO;
        tracker.assigned = true;
        assigned = true;
        break;
      }
    }
    
    // If no non-holiday weekend available, try holiday weekends for PGY-6 edge case
    if (!assigned && fellow.pgy === "PGY-6" && holidayWeekends.length > 0) {
      for (const weekend of holidayWeekends) {
        const weekendISO = toISODate(weekend);
        if (schedule.weekends[weekendISO]) continue;
        
        // For PGY-6, only assign holiday weekends if this is their only option
        const eligibilityCheck = isEligibleForHF(
          fellow, weekend, setup, schedByPGY, primarySchedule, schedule.countsByFellow, lastHFAssignment, true
        );
        
        if (eligibilityCheck.eligible) {
          schedule.weekends[weekendISO] = fellow.id;
          schedule.countsByFellow[fellow.id]++;
          lastHFAssignment[fellow.id] = weekendISO;
          tracker.assigned = true;
          assigned = true;
          break;
        }
      }
    }
    
    if (!assigned) {
      mandatoryMissed.push(`${fellow.name} (${fellow.pgy}): Could not assign mandatory HF weekend for block ${tracker.blockKey}`);
    }
  }

  // Phase 3: Distribute remaining weekends based on quota and equity
  const remainingWeekends = allWeekends.filter(weekend => {
    const weekendISO = toISODate(weekend);
    if (schedule.weekends[weekendISO]) return false; // Already assigned
    
    // Only include non-holiday weekends in this phase
    const isHolidayWeekend = allHolidayBlocks.some(block => 
      block.dates.some(d => toISODate(getWeekendStart(d)) === weekendISO)
    );
    return !isHolidayWeekend;
  });
  
  // Multiple passes to ensure all non-holiday weekends are covered
  let relaxQuota = false;
  let passCount = 0;
  const maxPasses = 3;
  
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
          lastHFAssignment,
          false, // Not July 4th weekend
          relaxQuota
        );
        if (check.eligible) {
          eligible.push(fellow);
        }
      }
      
      if (eligible.length === 0) {
        continue; // Try in next pass with relaxed constraints
      }
      
      // Prioritize by quota utilization (assign to fellow with lowest percentage of quota used)
      eligible.sort((a, b) => {
        const aQuota = HF_QUOTAS[a.pgy] || 1;
        const bQuota = HF_QUOTAS[b.pgy] || 1;
        const aPercent = (schedule.countsByFellow[a.id] || 0) / aQuota;
        const bPercent = (schedule.countsByFellow[b.id] || 0) / bQuota;
        
        if (Math.abs(aPercent - bPercent) < 0.01) {
          // If utilization is similar, sort by name for consistency
          return a.name.localeCompare(b.name);
        }
        
        return aPercent - bPercent;
      });
      
      const selectedFellow = eligible[0];
      schedule.weekends[weekendISO] = selectedFellow.id;
      schedule.countsByFellow[selectedFellow.id]++;
      lastHFAssignment[selectedFellow.id] = weekendISO;
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
      relaxQuota = true;
    }
  }
  
  // Record any remaining uncovered weekends
  for (const weekend of remainingWeekends) {
    const weekendISO = toISODate(weekend);
    if (!schedule.weekends[weekendISO]) {
      uncovered.push(weekendISO);
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