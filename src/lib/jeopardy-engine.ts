import { parseISO, format, differenceInCalendarDays, addDays, isSameDay } from "date-fns";
import { computeAcademicYearHolidays } from "@/lib/holidays";
import { loadSchedule, loadSetup, type Fellow, type PGY, type StoredSchedule, type SetupState } from "@/lib/schedule-engine";
import { loadCallSchedule, type CallSchedule } from "@/lib/call-engine";
import { loadHFSchedule } from "@/lib/hf-engine";

export type JeopardySchedule = {
  version: 1;
  yearStart: string; // ISO date (YYYY-MM-DD)
  days: Record<string, string>; // date ISO -> fellowId
  countsByFellow: Record<string, number>;
  weekdayCountsByFellow: Record<string, number>;
  weekendCountsByFellow: Record<string, number>;
  holidayCountsByFellow: Record<string, number>;
};

export type JeopardyAssignmentType = "weekday" | "weekend" | "holiday";

export type JeopardyBlock = {
  dates: string[]; // ISO dates in the block
  type: JeopardyAssignmentType;
  dayCount: number; // How many days this counts toward quota
};

const JEOPARDY_STORAGE_KEY = "cfsa_jeopardy_v1" as const;

// Annual quota limits by PGY
const JEOPARDY_QUOTAS: Record<PGY, { weekday: number; weekend: number; holiday: number; total: number }> = {
  "PGY-4": { weekday: 5, weekend: 2, holiday: 0, total: 7 },
  "PGY-5": { weekday: 15, weekend: 13, holiday: 0, total: 28 },
  "PGY-6": { weekday: 32, weekend: 8, holiday: 0, total: 40 },
};

function toISODate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function isWeekendDate(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6; // Sun or Sat
}

function isHolidayDate(dateISO: string, setup: SetupState): boolean {
  const holidays = setup.holidays?.length ? setup.holidays : computeAcademicYearHolidays(setup.yearStart);
  return holidays.some((h) => h.date === dateISO);
}

function afterAug15(d: Date, yearStartISO: string): boolean {
  const start = parseISO(yearStartISO);
  const aug15 = new Date(start.getFullYear(), 7, 15); // Aug is month 7
  return d >= aug15; // on or after Aug 15
}

function dateToBlockKey(d: Date): string {
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const abbr = monthNames[d.getMonth()];
  const half = d.getDate() <= 15 ? 1 : 2;
  return `${abbr.toUpperCase()}${half}`;
}

function getRotationOnDate(fellow: Fellow, date: Date, schedByPGY: Record<PGY, StoredSchedule | null>): string | undefined {
  const sched = schedByPGY[fellow.pgy];
  if (!sched || !sched.byFellow) return undefined;
  const row = sched.byFellow[fellow.id] || {};
  const key = dateToBlockKey(date);
  return row[key];
}

// Check if fellow has post-call spacing conflict (2-day rule AFTER primary call)
function hasPostCallConflict(fellow: Fellow, date: Date, primarySchedule: CallSchedule): boolean {
  if (!primarySchedule) return false;
  
  // Check if fellow has primary call in the 2 days before this jeopardy date
  for (let i = 1; i <= 2; i++) {
    const checkDate = addDays(date, -i);
    const checkISO = toISODate(checkDate);
    if (primarySchedule.days[checkISO] === fellow.id) {
      return true; // Conflict: primary call too recent
    }
  }
  return false;
}

// Check if fellow has HF weekend coverage conflict
function hasHFWeekendConflict(fellow: Fellow, dates: string[]): boolean {
  const hfSchedule = loadHFSchedule();
  if (!hfSchedule) return false;
  
  // Check if any of the jeopardy dates conflict with HF weekend coverage
  for (const dateISO of dates) {
    const date = parseISO(dateISO);
    if (isWeekendDate(date)) {
      // Check if fellow is assigned HF coverage for this weekend
      const weekendKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      if (hfSchedule.weekends[weekendKey] === fellow.id) {
        return true;
      }
    }
  }
  return false;
}

// Generate all jeopardy blocks for the academic year
function generateJeopardyBlocks(yearStartISO: string, setup: SetupState): JeopardyBlock[] {
  const start = parseISO(yearStartISO);
  const end = new Date(start.getFullYear() + 1, 5, 30); // June 30 of next year
  const blocks: JeopardyBlock[] = [];
  
  // Get all holidays for the academic year
  const holidays = setup.holidays?.length ? setup.holidays : computeAcademicYearHolidays(yearStartISO);
  const holidaySet = new Set(holidays.map(h => h.date));
  
  // Helper to check if a date is a holiday
  const isHoliday = (dateISO: string) => holidaySet.has(dateISO);
  
  // Generate holiday blocks first
  const holidayBlocks = generateHolidayBlocks(holidays);
  blocks.push(...holidayBlocks);
  
  // Collect all dates that are part of holiday blocks
  const holidayBlockDates = new Set<string>();
  for (const block of holidayBlocks) {
    for (const date of block.dates) {
      holidayBlockDates.add(date);
    }
  }
  
  // Generate weekend blocks (excluding holiday weekends)
  let current = new Date(start);
  while (current <= end) {
    const currentISO = toISODate(current);
    
    // Check if this is a Saturday and not part of a holiday block
    if (current.getDay() === 6 && !holidayBlockDates.has(currentISO)) {
      const sunday = addDays(current, 1);
      const sundayISO = toISODate(sunday);
      
      // Only create weekend block if Sunday is also not a holiday block date
      if (!holidayBlockDates.has(sundayISO)) {
        blocks.push({
          dates: [currentISO, sundayISO],
          type: "weekend",
          dayCount: 2,
        });
      }
    }
    
    current = addDays(current, 1);
  }
  
  // Generate weekday blocks (individual days, excluding weekends and holiday block dates)
  current = new Date(start);
  while (current <= end) {
    const currentISO = toISODate(current);
    const dayOfWeek = current.getDay();
    
    // Skip weekends, holidays, and dates already in holiday blocks
    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !isHoliday(currentISO) && !holidayBlockDates.has(currentISO)) {
      blocks.push({
        dates: [currentISO],
        type: "weekday",
        dayCount: 1,
      });
    }
    
    current = addDays(current, 1);
  }
  
  return blocks;
}

function generateHolidayBlocks(holidays: Array<{ date: string; name: string }>): JeopardyBlock[] {
  const blocks: JeopardyBlock[] = [];
  const processed = new Set<string>();
  
  for (const holiday of holidays) {
    if (processed.has(holiday.date)) continue;
    
    const holidayDate = parseISO(holiday.date);
    const dayOfWeek = holidayDate.getDay();
    
    if (holiday.name.toLowerCase().includes("thanksgiving")) {
      // Thanksgiving: 4 days (Thu-Sun)
      const dates: string[] = [];
      for (let i = 0; i < 4; i++) {
        const date = addDays(holidayDate, i);
        const dateISO = toISODate(date);
        dates.push(dateISO);
        processed.add(dateISO);
      }
      blocks.push({
        dates,
        type: "holiday",
        dayCount: 4,
      });
    } else if (dayOfWeek === 1 || dayOfWeek === 5) {
      // Monday or Friday holidays: 3 days (includes adjacent weekend)
      const dates: string[] = [];
      if (dayOfWeek === 1) {
        // Monday holiday: Sat-Mon
        const saturday = addDays(holidayDate, -2);
        const sunday = addDays(holidayDate, -1);
        dates.push(toISODate(saturday), toISODate(sunday), holiday.date);
      } else {
        // Friday holiday: Fri-Sun
        const saturday = addDays(holidayDate, 1);
        const sunday = addDays(holidayDate, 2);
        dates.push(holiday.date, toISODate(saturday), toISODate(sunday));
      }
      
      dates.forEach(d => processed.add(d));
      blocks.push({
        dates,
        type: "holiday",
        dayCount: 3,
      });
    } else if (dayOfWeek >= 2 && dayOfWeek <= 4) {
      // Midweek holidays (Tue/Wed/Thu): 1 day
      processed.add(holiday.date);
      blocks.push({
        dates: [holiday.date],
        type: "holiday",
        dayCount: 1,
      });
    }
    // Weekend holidays are handled as part of weekend blocks or ignored
  }
  
  return blocks;
}

// Check if fellow is eligible for a jeopardy block
function isEligibleForBlock(fellow: Fellow, block: JeopardyBlock, setup: SetupState, schedByPGY: Record<PGY, StoredSchedule | null>, primarySchedule: CallSchedule): boolean {
  // Basic eligibility: PGY-4 after August 15th
  if (fellow.pgy === "PGY-4") {
    const firstDate = parseISO(block.dates[0]);
    if (!afterAug15(firstDate, setup.yearStart)) {
      return false;
    }
  }
  
  // PGY-6 Holiday Restriction
  if (fellow.pgy === "PGY-6" && block.type === "holiday") {
    return false;
  }
  
  // Check same-day primary call exclusion for all dates in the block
  for (const dateISO of block.dates) {
    if (primarySchedule.days[dateISO] === fellow.id) {
      return false;
    }
  }
  
  // Check rotation exclusions for all dates in the block
  for (const dateISO of block.dates) {
    const date = parseISO(dateISO);
    const rotation = getRotationOnDate(fellow, date, schedByPGY);
    if (rotation === "VAC" || rotation === "HF" || rotation === "CCU") {
      return false;
    }
  }
  
  // Check post-call spacing conflicts for all dates in the block
  for (const dateISO of block.dates) {
    const date = parseISO(dateISO);
    if (hasPostCallConflict(fellow, date, primarySchedule)) {
      return false;
    }
  }
  
  // Check HF weekend conflicts
  if (hasHFWeekendConflict(fellow, block.dates)) {
    return false;
  }
  
  return true;
}

// Check if assigning this block would violate consecutive jeopardy rule
function wouldCreateConsecutiveConflict(fellow: Fellow, block: JeopardyBlock, currentAssignments: Record<string, string>): boolean {
  for (const dateISO of block.dates) {
    const date = parseISO(dateISO);
    
    // Check day before
    const dayBefore = addDays(date, -1);
    const dayBeforeISO = toISODate(dayBefore);
    if (currentAssignments[dayBeforeISO] === fellow.id) {
      return true;
    }
    
    // Check day after
    const dayAfter = addDays(date, 1);
    const dayAfterISO = toISODate(dayAfter);
    if (currentAssignments[dayAfterISO] === fellow.id) {
      return true;
    }
  }
  
  return false;
}

// Check quota limits
function isWithinQuotaLimits(fellow: Fellow, block: JeopardyBlock, currentCounts: Record<string, { weekday: number; weekend: number; holiday: number; total: number }>): boolean {
  const quota = JEOPARDY_QUOTAS[fellow.pgy];
  const counts = currentCounts[fellow.id] || { weekday: 0, weekend: 0, holiday: 0, total: 0 };
  
  if (block.type === "weekday") {
    return counts.weekday + block.dayCount <= quota.weekday && counts.total + block.dayCount <= quota.total;
  } else if (block.type === "weekend") {
    return counts.weekend + block.dayCount <= quota.weekend && counts.total + block.dayCount <= quota.total;
  } else { // holiday
    return counts.holiday + block.dayCount <= quota.holiday && counts.total + block.dayCount <= quota.total;
  }
}

// Weighted selection based on current assignment counts
function selectFellowWeighted(fellows: Fellow[], currentCounts: Record<string, { weekday: number; weekend: number; holiday: number; total: number }>): Fellow | null {
  if (fellows.length === 0) return null;
  
  const weights = fellows.map(fellow => {
    const counts = currentCounts[fellow.id] || { weekday: 0, weekend: 0, holiday: 0, total: 0 };
    // Prefer fellows with fewer total assignments
    return 1 / (counts.total + 1);
  });
  
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight === 0) return fellows[0];
  
  let random = Math.random() * totalWeight;
  for (let i = 0; i < fellows.length; i++) {
    random -= weights[i];
    if (random <= 0) return fellows[i];
  }
  
  return fellows[fellows.length - 1];
}

export function buildJeopardySchedule(): { schedule: JeopardySchedule; success: boolean; uncovered: string[]; errors: string[] } {
  const setup = loadSetup();
  if (!setup) {
    return {
      schedule: { version: 1, yearStart: toISODate(new Date()), days: {}, countsByFellow: {}, weekdayCountsByFellow: {}, weekendCountsByFellow: {}, holidayCountsByFellow: {} },
      success: false,
      uncovered: [],
      errors: ["Setup not completed"]
    };
  }
  
  const primarySchedule = loadCallSchedule();
  if (!primarySchedule) {
    return {
      schedule: { version: 1, yearStart: setup.yearStart, days: {}, countsByFellow: {}, weekdayCountsByFellow: {}, weekendCountsByFellow: {}, holidayCountsByFellow: {} },
      success: false,
      uncovered: [],
      errors: ["Primary call schedule must be generated first"]
    };
  }
  
  const schedByPGY: Record<PGY, StoredSchedule | null> = {
    "PGY-4": loadSchedule("PGY-4"),
    "PGY-5": loadSchedule("PGY-5"),
    "PGY-6": loadSchedule("PGY-6"),
  };
  
  // Generate all jeopardy blocks
  const blocks = generateJeopardyBlocks(setup.yearStart, setup);
  
  // Sort blocks by processing order: holidays first, weekends second, weekdays last
  const sortedBlocks = blocks.sort((a, b) => {
    const typeOrder = { holiday: 0, weekend: 1, weekday: 2 };
    if (typeOrder[a.type] !== typeOrder[b.type]) {
      return typeOrder[a.type] - typeOrder[b.type];
    }
    // Within same type, sort chronologically
    return a.dates[0].localeCompare(b.dates[0]);
  });
  
  const assignments: Record<string, string> = {};
  const currentCounts: Record<string, { weekday: number; weekend: number; holiday: number; total: number }> = {};
  const uncovered: string[] = [];
  const errors: string[] = [];
  
  // Initialize counts for all fellows
  for (const fellow of setup.fellows) {
    currentCounts[fellow.id] = { weekday: 0, weekend: 0, holiday: 0, total: 0 };
  }
  
  // Process each block
  for (const block of sortedBlocks) {
    const eligibleFellows = setup.fellows.filter(fellow => 
      isEligibleForBlock(fellow, block, setup, schedByPGY, primarySchedule) &&
      isWithinQuotaLimits(fellow, block, currentCounts) &&
      !wouldCreateConsecutiveConflict(fellow, block, assignments)
    );
    
    const selectedFellow = selectFellowWeighted(eligibleFellows, currentCounts);
    
    if (selectedFellow) {
      // Assign the entire block to this fellow
      for (const dateISO of block.dates) {
        assignments[dateISO] = selectedFellow.id;
      }
      
      // Update counts
      const counts = currentCounts[selectedFellow.id];
      if (block.type === "weekday") {
        counts.weekday += block.dayCount;
      } else if (block.type === "weekend") {
        counts.weekend += block.dayCount;
      } else {
        counts.holiday += block.dayCount;
      }
      counts.total += block.dayCount;
    } else {
      // Could not assign this block
      uncovered.push(...block.dates);
      errors.push(`Could not assign ${block.type} block starting ${block.dates[0]} (${block.dayCount} days)`);
    }
  }
  
  // Create final counts by fellow for simple display
  const countsByFellow: Record<string, number> = {};
  const weekdayCountsByFellow: Record<string, number> = {};
  const weekendCountsByFellow: Record<string, number> = {};
  const holidayCountsByFellow: Record<string, number> = {};
  
  for (const fellow of setup.fellows) {
    const counts = currentCounts[fellow.id];
    countsByFellow[fellow.id] = counts.total;
    weekdayCountsByFellow[fellow.id] = counts.weekday;
    weekendCountsByFellow[fellow.id] = counts.weekend;
    holidayCountsByFellow[fellow.id] = counts.holiday;
  }
  
  const schedule: JeopardySchedule = {
    version: 1,
    yearStart: setup.yearStart,
    days: assignments,
    countsByFellow,
    weekdayCountsByFellow,
    weekendCountsByFellow,
    holidayCountsByFellow,
  };
  
  return {
    schedule,
    success: uncovered.length === 0,
    uncovered,
    errors
  };
}

export function loadJeopardySchedule(): JeopardySchedule | null {
  try {
    const raw = localStorage.getItem(JEOPARDY_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as JeopardySchedule;
  } catch {
    return null;
  }
}

export function saveJeopardySchedule(schedule: JeopardySchedule): void {
  try {
    localStorage.setItem(JEOPARDY_STORAGE_KEY, JSON.stringify(schedule));
  } catch {
    // ignore
  }
}

export function clearJeopardySchedule(): void {
  try {
    localStorage.removeItem(JEOPARDY_STORAGE_KEY);
  } catch {
    // ignore
  }
}

// Manual assignment helpers
export function applyJeopardyAssignment(schedule: JeopardySchedule, dateISO: string, fellowId: string | null): { success: boolean; schedule?: JeopardySchedule; error?: string } {
  const setup = loadSetup();
  const primarySchedule = loadCallSchedule();
  
  if (!setup || !primarySchedule) {
    return { success: false, error: "Setup or primary schedule not available" };
  }
  
  const newSchedule = {
    ...schedule,
    days: { ...schedule.days },
    countsByFellow: { ...schedule.countsByFellow },
    weekdayCountsByFellow: { ...schedule.weekdayCountsByFellow },
    weekendCountsByFellow: { ...schedule.weekendCountsByFellow },
    holidayCountsByFellow: { ...schedule.holidayCountsByFellow },
  };
  
  // Remove old assignment if exists
  const oldFellowId = schedule.days[dateISO];
  if (oldFellowId) {
    newSchedule.countsByFellow[oldFellowId] = Math.max(0, (newSchedule.countsByFellow[oldFellowId] || 0) - 1);
    
    const date = parseISO(dateISO);
    const isWeekend = isWeekendDate(date);
    const isHoliday = isHolidayDate(dateISO, setup);
    
    if (isHoliday) {
      newSchedule.holidayCountsByFellow[oldFellowId] = Math.max(0, (newSchedule.holidayCountsByFellow[oldFellowId] || 0) - 1);
    } else if (isWeekend) {
      newSchedule.weekendCountsByFellow[oldFellowId] = Math.max(0, (newSchedule.weekendCountsByFellow[oldFellowId] || 0) - 1);
    } else {
      newSchedule.weekdayCountsByFellow[oldFellowId] = Math.max(0, (newSchedule.weekdayCountsByFellow[oldFellowId] || 0) - 1);
    }
  }
  
  if (fellowId === null) {
    // Clear assignment
    delete newSchedule.days[dateISO];
    return { success: true, schedule: newSchedule };
  }
  
  // Add new assignment
  const fellow = setup.fellows.find(f => f.id === fellowId);
  if (!fellow) {
    return { success: false, error: "Fellow not found" };
  }
  
  // Validate assignment
  const date = parseISO(dateISO);
  const schedByPGY: Record<PGY, StoredSchedule | null> = {
    "PGY-4": loadSchedule("PGY-4"),
    "PGY-5": loadSchedule("PGY-5"),
    "PGY-6": loadSchedule("PGY-6"),
  };
  
  const block: JeopardyBlock = {
    dates: [dateISO],
    type: isHolidayDate(dateISO, setup) ? "holiday" : isWeekendDate(date) ? "weekend" : "weekday",
    dayCount: 1,
  };
  
  if (!isEligibleForBlock(fellow, block, setup, schedByPGY, primarySchedule)) {
    return { success: false, error: "Fellow not eligible for this date" };
  }
  
  if (wouldCreateConsecutiveConflict(fellow, block, newSchedule.days)) {
    return { success: false, error: "Would create consecutive jeopardy assignment" };
  }
  
  // Apply assignment
  newSchedule.days[dateISO] = fellowId;
  newSchedule.countsByFellow[fellowId] = (newSchedule.countsByFellow[fellowId] || 0) + 1;
  
  if (block.type === "holiday") {
    newSchedule.holidayCountsByFellow[fellowId] = (newSchedule.holidayCountsByFellow[fellowId] || 0) + 1;
  } else if (block.type === "weekend") {
    newSchedule.weekendCountsByFellow[fellowId] = (newSchedule.weekendCountsByFellow[fellowId] || 0) + 1;
  } else {
    newSchedule.weekdayCountsByFellow[fellowId] = (newSchedule.weekdayCountsByFellow[fellowId] || 0) + 1;
  }
  
  return { success: true, schedule: newSchedule };
}

// Get eligible fellows for a specific date
export function getEligibleJeopardyFellows(dateISO: string): Fellow[] {
  const setup = loadSetup();
  const primarySchedule = loadCallSchedule();
  
  if (!setup || !primarySchedule) return [];
  
  const date = parseISO(dateISO);
  const schedByPGY: Record<PGY, StoredSchedule | null> = {
    "PGY-4": loadSchedule("PGY-4"),
    "PGY-5": loadSchedule("PGY-5"),
    "PGY-6": loadSchedule("PGY-6"),
  };
  
  const block: JeopardyBlock = {
    dates: [dateISO],
    type: isHolidayDate(dateISO, setup) ? "holiday" : isWeekendDate(date) ? "weekend" : "weekday",
    dayCount: 1,
  };
  
  return setup.fellows.filter(fellow => 
    isEligibleForBlock(fellow, block, setup, schedByPGY, primarySchedule)
  );
}

// Get reasons why fellows are ineligible
// Get the jeopardy block for a specific date
export function getJeopardyBlockForDate(dateISO: string): JeopardyBlock | null {
  const setup = loadSetup();
  if (!setup) return null;
  
  const blocks = generateJeopardyBlocks(setup.yearStart, setup);
  return blocks.find(block => block.dates.includes(dateISO)) || null;
}

// Get eligible fellows for a jeopardy block (all dates in the block)
export function getEligibleJeopardyFellowsForBlock(block: JeopardyBlock): Fellow[] {
  const setup = loadSetup();
  const primarySchedule = loadCallSchedule();
  
  if (!setup || !primarySchedule) return [];
  
  const schedByPGY: Record<PGY, StoredSchedule | null> = {
    "PGY-4": loadSchedule("PGY-4"),
    "PGY-5": loadSchedule("PGY-5"),
    "PGY-6": loadSchedule("PGY-6"),
  };
  
  return setup.fellows.filter(fellow => 
    isEligibleForBlock(fellow, block, setup, schedByPGY, primarySchedule)
  );
}

// Get ineligible reasons for a jeopardy block
export function getIneligibleJeopardyReasonsForBlock(block: JeopardyBlock): Array<{ fellow: Fellow; reasons: string[] }> {
  const setup = loadSetup();
  const primarySchedule = loadCallSchedule();
  
  if (!setup || !primarySchedule) return [];
  
  const schedByPGY: Record<PGY, StoredSchedule | null> = {
    "PGY-4": loadSchedule("PGY-4"),
    "PGY-5": loadSchedule("PGY-5"),
    "PGY-6": loadSchedule("PGY-6"),
  };
  
  const result: Array<{ fellow: Fellow; reasons: string[] }> = [];
  
  for (const fellow of setup.fellows) {
    const reasons: string[] = [];
    
    // Check each date in the block
    for (const dateISO of block.dates) {
      const date = parseISO(dateISO);
      
      // Check PGY restrictions
      if (block.type === "holiday" && fellow.pgy === "PGY-4") {
        reasons.push("PGY-4s cannot be assigned holiday jeopardy");
        break; // Only need to add this reason once
      }
      
      // Check rotation eligibility
      const rotation = getRotationOnDate(fellow, date, schedByPGY);
      if (rotation && !["Ward", "ICU", "CCU", "CVICU"].includes(rotation)) {
        reasons.push(`On ${rotation} rotation on ${dateISO}`);
      }
      
      // Check post-call spacing
      if (hasPostCallConflict(fellow, date, primarySchedule)) {
        reasons.push(`Within 2 days of primary call on ${dateISO}`);
      }
      
      // Check HF weekend conflicts
      if (hasHFWeekendConflict(fellow, [dateISO])) {
        reasons.push(`HF weekend conflict on ${dateISO}`);
      }
    }
    
    if (reasons.length > 0) {
      result.push({ fellow, reasons });
    }
  }
  
  return result;
}

// Extended apply function that can handle scoped assignments
export function applyJeopardyAssignmentScoped(
  schedule: JeopardySchedule, 
  dateISO: string, 
  fellowId: string | null, 
  scope: "single" | "block" = "single"
): { success: boolean; schedule?: JeopardySchedule; error?: string } {
  if (scope === "single") {
    return applyJeopardyAssignment(schedule, dateISO, fellowId);
  }
  
  const block = getJeopardyBlockForDate(dateISO);
  if (!block) {
    return { success: false, error: "No block found for this date" };
  }
  
  const setup = loadSetup();
  const primarySchedule = loadCallSchedule();
  
  if (!setup || !primarySchedule) {
    return { success: false, error: "Setup or primary schedule not available" };
  }
  
  const newSchedule = {
    ...schedule,
    days: { ...schedule.days },
    countsByFellow: { ...schedule.countsByFellow },
    weekdayCountsByFellow: { ...schedule.weekdayCountsByFellow },
    weekendCountsByFellow: { ...schedule.weekendCountsByFellow },
    holidayCountsByFellow: { ...schedule.holidayCountsByFellow },
  };
  
  // Remove old assignments for all dates in the block
  for (const blockDateISO of block.dates) {
    const oldFellowId = schedule.days[blockDateISO];
    if (oldFellowId) {
      newSchedule.countsByFellow[oldFellowId] = Math.max(0, (newSchedule.countsByFellow[oldFellowId] || 0) - 1);
      
      const date = parseISO(blockDateISO);
      const isWeekend = isWeekendDate(date);
      const isHoliday = isHolidayDate(blockDateISO, setup);
      
      if (isHoliday) {
        newSchedule.holidayCountsByFellow[oldFellowId] = Math.max(0, (newSchedule.holidayCountsByFellow[oldFellowId] || 0) - 1);
      } else if (isWeekend) {
        newSchedule.weekendCountsByFellow[oldFellowId] = Math.max(0, (newSchedule.weekendCountsByFellow[oldFellowId] || 0) - 1);
      } else {
        newSchedule.weekdayCountsByFellow[oldFellowId] = Math.max(0, (newSchedule.weekdayCountsByFellow[oldFellowId] || 0) - 1);
      }
      
      delete newSchedule.days[blockDateISO];
    }
  }
  
  if (fellowId === null) {
    // Clear all assignments in the block
    return { success: true, schedule: newSchedule };
  }
  
  // Add new assignments for all dates in the block
  const fellow = setup.fellows.find(f => f.id === fellowId);
  if (!fellow) {
    return { success: false, error: "Fellow not found" };
  }
  
  // Validate assignment for the entire block
  const schedByPGY: Record<PGY, StoredSchedule | null> = {
    "PGY-4": loadSchedule("PGY-4"),
    "PGY-5": loadSchedule("PGY-5"),
    "PGY-6": loadSchedule("PGY-6"),
  };
  
  if (!isEligibleForBlock(fellow, block, setup, schedByPGY, primarySchedule)) {
    return { success: false, error: "Fellow not eligible for this block" };
  }
  
  if (wouldCreateConsecutiveConflict(fellow, block, newSchedule.days)) {
    return { success: false, error: "Would create consecutive jeopardy assignment" };
  }
  
  // Apply assignments for all dates in the block
  for (const blockDateISO of block.dates) {
    newSchedule.days[blockDateISO] = fellowId;
  }
  
  // Update counts based on block type and size
  newSchedule.countsByFellow[fellowId] = (newSchedule.countsByFellow[fellowId] || 0) + block.dayCount;
  
  if (block.type === "holiday") {
    newSchedule.holidayCountsByFellow[fellowId] = (newSchedule.holidayCountsByFellow[fellowId] || 0) + block.dayCount;
  } else if (block.type === "weekend") {
    newSchedule.weekendCountsByFellow[fellowId] = (newSchedule.weekendCountsByFellow[fellowId] || 0) + block.dayCount;
  } else {
    newSchedule.weekdayCountsByFellow[fellowId] = (newSchedule.weekdayCountsByFellow[fellowId] || 0) + block.dayCount;
  }
  
  return { success: true, schedule: newSchedule };
}

export function getIneligibleJeopardyReasons(dateISO: string): Array<{ fellow: Fellow; reasons: string[] }> {
  const setup = loadSetup();
  const primarySchedule = loadCallSchedule();
  
  if (!setup || !primarySchedule) return [];
  
  const date = parseISO(dateISO);
  const schedByPGY: Record<PGY, StoredSchedule | null> = {
    "PGY-4": loadSchedule("PGY-4"),
    "PGY-5": loadSchedule("PGY-5"),
    "PGY-6": loadSchedule("PGY-6"),
  };
  
  const block: JeopardyBlock = {
    dates: [dateISO],
    type: isHolidayDate(dateISO, setup) ? "holiday" : isWeekendDate(date) ? "weekend" : "weekday",
    dayCount: 1,
  };
  
  const results: Array<{ fellow: Fellow; reasons: string[] }> = [];
  
  for (const fellow of setup.fellows) {
    const reasons: string[] = [];
    
    // Check basic eligibility
    if (fellow.pgy === "PGY-4" && !afterAug15(date, setup.yearStart)) {
      reasons.push("PGY-4 not eligible before August 15th");
    }
    
    // Check PGY-6 holiday restriction
    if (fellow.pgy === "PGY-6" && block.type === "holiday") {
      reasons.push("PGY-6 cannot take holiday assignments");
    }
    
    // Check same-day primary call exclusion
    if (primarySchedule.days[dateISO] === fellow.id) {
      reasons.push("Same day as primary call");
    }
    
    // Check rotation exclusions
    const rotation = getRotationOnDate(fellow, date, schedByPGY);
    if (rotation === "VAC") {
      reasons.push("On vacation");
    } else if (rotation === "HF") {
      reasons.push("On HF rotation");
    } else if (rotation === "CCU") {
      reasons.push("On CCU rotation");
    }
    
    // Check post-call spacing
    if (hasPostCallConflict(fellow, date, primarySchedule)) {
      reasons.push("Within 2 days of primary call");
    }
    
    // Check HF weekend conflicts
    if (hasHFWeekendConflict(fellow, [dateISO])) {
      reasons.push("Has HF weekend coverage");
    }
    
    if (reasons.length > 0) {
      results.push({ fellow, reasons });
    }
  }
  
  return results;
}