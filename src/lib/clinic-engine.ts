import { format, parseISO, addDays, isAfter, isBefore, isEqual } from "date-fns";
import { computeAcademicYearHolidays } from "@/lib/holidays";
import { loadSchedule, loadSetup, type Fellow, type PGY, type SetupState } from "@/lib/schedule-engine";
import { type Rotation, getPrimaryRotation } from "@/lib/rotation-engine";
import type { CallSchedule } from "@/lib/call-engine";

export type ClinicType = "GENERAL" | "HEART_FAILURE" | "ACHD" | "DEVICE" | "EP";

export type ClinicAssignment = {
  fellowId: string;
  clinicType: ClinicType;
  dayOfWeek: string; // Monday, Tuesday, etc.
};

export type ClinicSchedule = {
  version: 1;
  yearStart: string; // ISO date (YYYY-MM-DD)
  days: Record<string, ClinicAssignment[]>; // date ISO -> clinic assignments
  countsByFellow: Record<string, Record<ClinicType, number>>; // fellowId -> clinicType -> count
  ambulatoryAssignments?: Record<string, string>; // date ISO -> fellowId
  ambulatoryCountsByFellow?: Record<string, number>; // fellowId -> count
};

const CLINIC_SCHEDULE_STORAGE_KEY = "cfsa_clinics_v1" as const;

// General clinic days - Monday, Wednesday, Thursday
const GENERAL_CLINIC_DAYS = [1, 3, 4]; // Monday=1, Wednesday=3, Thursday=4

// Special clinic assignments
const HEART_FAILURE_CLINIC_DAY = 2; // Tuesday
const ACHD_CLINIC_DAY = 1; // Monday  
const DEVICE_CLINIC_DAY = 5; // Friday
const EP_CLINIC_DAY = 3; // Wednesday (1st and 3rd)

function toISODate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function july1ToJune30Window(yearStartISO: string): { start: Date; end: Date; days: Date[] } {
  const start = parseISO(yearStartISO);
  const end = addDays(new Date(start.getFullYear() + 1, 5, 30), 0); // June 30 of next year
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

function dateToBlockKey(dateISO: string, yearStartISO: string): string | undefined {
  const date = parseISO(dateISO);
  const yearStart = parseISO(yearStartISO);
  
  if (isBefore(date, yearStart)) return undefined;
  
  // Check if date is beyond the academic year (after June 30 of next year)
  const yearEnd = new Date(yearStart.getFullYear() + 1, 5, 30); // June 30 of next year
  if (isAfter(date, yearEnd)) return undefined;
  
  const dayOfMonth = date.getDate();
  const monthIndex = (date.getMonth() - yearStart.getMonth() + 12) % 12;
  
  const monthNames = ["JUL", "AUG", "SEP", "OCT", "NOV", "DEC", "JAN", "FEB", "MAR", "APR", "MAY", "JUN"];
  const monthAbbr = monthNames[monthIndex];
  
  // First half (1-15) or second half (16-end)
  const half = dayOfMonth <= 15 ? "1" : "2";
  
  return `${monthAbbr}${half}`;
}

export function getFellowRotationOnDate(fellowId: string, dateISO: string): Rotation | undefined {
  // Get setup to determine year start
  const setup = loadSetup();
  if (!setup) return undefined;
  
  // Convert date to block key
  const blockKey = dateToBlockKey(dateISO, setup.yearStart);
  if (!blockKey) return undefined;
  
  // Get the fellow's rotation schedule for the date
  const pgy4Schedule = loadSchedule("PGY-4");
  const pgy5Schedule = loadSchedule("PGY-5");
  const pgy6Schedule = loadSchedule("PGY-6");
  
  // Find which schedule contains this fellow
  const fellowRotations = 
    pgy4Schedule?.byFellow[fellowId] ||
    pgy5Schedule?.byFellow[fellowId] ||
    pgy6Schedule?.byFellow[fellowId];
    
  if (!fellowRotations) return undefined;
  
  // Get the rotation for this block
  const rotation = fellowRotations[blockKey];
  return rotation as Rotation | undefined;
}

function isPostCallDay(fellowId: string, dateISO: string, callSchedule: CallSchedule | null): boolean {
  if (!callSchedule) return false;
  
  // Check if the previous day had this fellow on call
  const date = parseISO(dateISO);
  const prevDay = addDays(date, -1);
  const prevDayISO = toISODate(prevDay);
  
  return callSchedule.days[prevDayISO] === fellowId;
}

// Exclusion logic for special clinic assignments (more lenient)
function isExcludedFromSpecialClinic(
  fellow: Fellow,
  dateISO: string,
  rotation: Rotation | undefined,
  callSchedule: CallSchedule | null,
  setup: SetupState
): boolean {
  // Rule: No clinics on holidays
  if (isHoliday(dateISO, setup)) return true;
  
  // Rule: Exclude if on vacation
  if (rotation === "VAC") return true;
  
  // Rule: Exclude if post-call (day after primary call)
  if (isPostCallDay(fellow.id, dateISO, callSchedule)) return true;
  
  return false;
}

// Exclusion logic for general clinic assignments (stricter)
function isExcludedFromGeneralClinic(
  fellow: Fellow,
  dateISO: string,
  rotation: Rotation | undefined,
  callSchedule: CallSchedule | null,
  setup: SetupState
): boolean {
  // Rule: No clinics on holidays
  if (isHoliday(dateISO, setup)) return true;
  
  // Rule: Exclude if on vacation
  if (rotation === "VAC") return true;
  
  // Rule: Exclude if on CCU rotation
  if (rotation === "CCU") return true;
  
  // Rule: Exclude if on HF rotation  
  if (rotation === "HF") return true;
  
  // Rule: Exclude if post-call (day after primary call)
  if (isPostCallDay(fellow.id, dateISO, callSchedule)) return true;
  
  return false;
}

function getWeekOfMonth(date: Date): number {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  const dayOfMonth = date.getDate();
  const firstWeekday = firstDay.getDay();
  return Math.ceil((dayOfMonth + firstWeekday) / 7);
}

function isFirstOrThirdWednesday(date: Date): boolean {
  if (date.getDay() !== 3) return false; // Not Wednesday
  const week = getWeekOfMonth(date);
  return week === 1 || week === 3;
}

// Helper to get the start of the week (Monday) for a given date
function getWeekStart(date: Date): Date {
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is Sunday
  return new Date(date.getFullYear(), date.getMonth(), diff);
}

// Helper to get all dates in the same week
function getDatesInSameWeek(date: Date): string[] {
  const weekStart = getWeekStart(date);
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const currentDate = new Date(weekStart);
    currentDate.setDate(weekStart.getDate() + i);
    dates.push(toISODate(currentDate));
  }
  return dates;
}

// Check if a fellow has a special clinic (ACHD or HF) in the same week
function hasSpecialClinicInSameWeek(
  fellowId: string, 
  date: Date, 
  schedule: ClinicSchedule
): boolean {
  const weekDates = getDatesInSameWeek(date);
  
  for (const weekDate of weekDates) {
    const assignments = schedule.days[weekDate] || [];
    const hasSpecialClinic = assignments.some(assignment => 
      assignment.fellowId === fellowId && 
      (assignment.clinicType === "HEART_FAILURE" || assignment.clinicType === "ACHD")
    );
    if (hasSpecialClinic) {
      return true;
    }
  }
  
  return false;
}

export function buildClinicSchedule(
  callSchedule: CallSchedule | null,
  setup: SetupState | null
): ClinicSchedule | null {
  if (!setup) return null;
  
  const { days } = july1ToJune30Window(setup.yearStart);
  const schedule: ClinicSchedule = {
    version: 1,
    yearStart: setup.yearStart,
    days: {},
    countsByFellow: {},
    ambulatoryAssignments: {},
    ambulatoryCountsByFellow: {}
  };
  
  // Initialize counts
  for (const fellow of setup.fellows) {
    schedule.countsByFellow[fellow.id] = {
      GENERAL: 0,
      HEART_FAILURE: 0,
      ACHD: 0,
      DEVICE: 0,
      EP: 0
    };
    schedule.ambulatoryCountsByFellow![fellow.id] = 0;
  }
  
  for (const date of days) {
    const dateISO = toISODate(date);
    const dayOfWeek = date.getDay(); // 0=Sunday, 1=Monday, etc.
    const assignments: ClinicAssignment[] = [];
    
    // Skip holidays - no clinics
    if (isHoliday(dateISO, setup)) {
      schedule.days[dateISO] = assignments;
      continue;
    }
    
    for (const fellow of setup.fellows) {
      const rotation = getFellowRotationOnDate(fellow.id, dateISO);
      const primaryRotation = rotation ? getPrimaryRotation(rotation) : undefined;
      
      // PRIORITY 1: Apply special rotation rules for PGY-5 and PGY-6 (with special exclusion rules)
      if ((fellow.pgy === "PGY-5" || fellow.pgy === "PGY-6")) {
        // Rule 3a: NONINVASIVE rotation -> Heart Failure Clinic on Tuesday
        if (primaryRotation === "NONINVASIVE" && dayOfWeek === HEART_FAILURE_CLINIC_DAY) {
          if (!isExcludedFromSpecialClinic(fellow, dateISO, rotation, callSchedule, setup)) {
            assignments.push({
              fellowId: fellow.id,
              clinicType: "HEART_FAILURE",
              dayOfWeek: "Tuesday"
            });
            schedule.countsByFellow[fellow.id].HEART_FAILURE++;
            continue; // Skip other assignments for this fellow
          }
        }
        
        // Rule 3b: LAC_CATH rotation -> ACHD Clinic on Monday
        if (primaryRotation === "LAC_CATH" && dayOfWeek === ACHD_CLINIC_DAY) {
          if (!isExcludedFromSpecialClinic(fellow, dateISO, rotation, callSchedule, setup)) {
            assignments.push({
              fellowId: fellow.id,
              clinicType: "ACHD",
              dayOfWeek: "Monday"
            });
            schedule.countsByFellow[fellow.id].ACHD++;
            continue; // Skip other assignments for this fellow
          }
        }
      }
      
      // PRIORITY 2: EP rotation special assignments (with special exclusion rules)
      if (primaryRotation === "EP") {
        if (!isExcludedFromSpecialClinic(fellow, dateISO, rotation, callSchedule, setup)) {
          // Device Clinic every Friday
          if (dayOfWeek === DEVICE_CLINIC_DAY) {
            assignments.push({
              fellowId: fellow.id,
              clinicType: "DEVICE",
              dayOfWeek: "Friday"
            });
            schedule.countsByFellow[fellow.id].DEVICE++;
          }
          
          // EP Clinic every 1st and 3rd Wednesday
          if (isFirstOrThirdWednesday(date)) {
            assignments.push({
              fellowId: fellow.id,
              clinicType: "EP",
              dayOfWeek: "Wednesday"
            });
            schedule.countsByFellow[fellow.id].EP++;
          }
          
          // EP fellows can still have general clinics on their assigned days
          // Fall through to general clinic logic
        }
      }
      
      // PRIORITY 3: General clinic assignment (with stricter exclusion rules)
      if (GENERAL_CLINIC_DAYS.includes(dayOfWeek)) {
        // Check general exclusion conditions
        if (isExcludedFromGeneralClinic(fellow, dateISO, rotation, callSchedule, setup)) {
          continue;
        }
        
        const fellowClinicDay = fellow.clinicDay;
        const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const currentDayName = dayNames[dayOfWeek];
        
        // Check if this fellow has a special clinic (ACHD or HF) in the same week
        // If so, skip general clinic assignment for this week
        if (hasSpecialClinicInSameWeek(fellow.id, date, schedule)) {
          continue;
        }
        
        // Assign if this is their preferred clinic day
        if (fellowClinicDay === currentDayName) {
          assignments.push({
            fellowId: fellow.id,
            clinicType: "GENERAL",
            dayOfWeek: currentDayName
          });
          schedule.countsByFellow[fellow.id].GENERAL++;
        }
      }
    }
    
    schedule.days[dateISO] = assignments;
  }
  
  // Assign Ambulatory Fellows after all clinic assignments are done
  assignAmbulatoryFellows(schedule, setup);
  
  return schedule;
}

// Helper to get the 2-week block key for a date
export function getBlockKeyForDate(dateISO: string, yearStartISO: string): string | undefined {
  return dateToBlockKey(dateISO, yearStartISO);
}

// Assign Ambulatory Fellows according to the rules
function assignAmbulatoryFellows(schedule: ClinicSchedule, setup: SetupState): void {
  const { days } = july1ToJune30Window(setup.yearStart);
  
  // Priority order for rotations
  const rotationPriority: Array<Rotation | string> = ['NUCLEAR', 'NONINVASIVE', 'ELECTIVE', 'EP'];
  
  // Track current block assignments and previous block's assigned fellow
  let currentBlockKey: string | undefined;
  let currentBlockStart: string | undefined;
  let previousBlockFellow: string | undefined;
  
  for (const date of days) {
    const dateISO = toISODate(date);
    const blockKey = getBlockKeyForDate(dateISO, setup.yearStart);
    
    // Check if we're starting a new 2-week block
    if (blockKey !== currentBlockKey) {
      currentBlockKey = blockKey;
      currentBlockStart = dateISO;
      
      // Try to assign an ambulatory fellow for this block
      let assignedFellow: string | null = null;
      
      // Try each rotation in priority order
      for (const targetRotation of rotationPriority) {
        if (assignedFellow) break;
        
        // Find PGY-5 or PGY-6 fellows on this rotation during this block
        const eligibleFellows = setup.fellows.filter(fellow => {
          // Must be PGY-5 or PGY-6
          if (fellow.pgy !== "PGY-5" && fellow.pgy !== "PGY-6") return false;
          
          // Must not have 3 assignments already
          if ((schedule.ambulatoryCountsByFellow?.[fellow.id] ?? 0) >= 3) return false;
          
          // Cannot be the same fellow as the previous block (no consecutive assignments)
          if (fellow.id === previousBlockFellow) return false;
          
          // Check if fellow is on the target rotation during this block
          const rotation = getFellowRotationOnDate(fellow.id, dateISO);
          const primaryRotation = rotation ? getPrimaryRotation(rotation) : undefined;
          
          return primaryRotation === targetRotation;
        });
        
        // If we have eligible fellows, pick the one with fewest assignments
        if (eligibleFellows.length > 0) {
          eligibleFellows.sort((a, b) => {
            const aCount = schedule.ambulatoryCountsByFellow?.[a.id] ?? 0;
            const bCount = schedule.ambulatoryCountsByFellow?.[b.id] ?? 0;
            return aCount - bCount;
          });
          assignedFellow = eligibleFellows[0].id;
        }
      }
      
      // Assign this fellow to all days in the block
      if (assignedFellow && schedule.ambulatoryCountsByFellow) {
        schedule.ambulatoryCountsByFellow[assignedFellow]++;
        previousBlockFellow = assignedFellow;
        
        // Assign to all days in this block
        for (const blockDate of days) {
          const blockDateISO = toISODate(blockDate);
          const blockDateKey = getBlockKeyForDate(blockDateISO, setup.yearStart);
          
          if (blockDateKey === blockKey && schedule.ambulatoryAssignments) {
            schedule.ambulatoryAssignments[blockDateISO] = assignedFellow;
          }
        }
      } else {
        // No fellow assigned for this block, reset previous block fellow
        previousBlockFellow = undefined;
      }
    }
  }
}

export function loadClinicSchedule(): ClinicSchedule | null {
  try {
    const raw = localStorage.getItem(CLINIC_SCHEDULE_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ClinicSchedule;
  } catch {
    return null;
  }
}

export function saveClinicSchedule(schedule: ClinicSchedule): void {
  try {
    localStorage.setItem(CLINIC_SCHEDULE_STORAGE_KEY, JSON.stringify(schedule));
  } catch {
    // ignore storage errors
  }
}

export function clearClinicSchedule(): void {
  try {
    localStorage.removeItem(CLINIC_SCHEDULE_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

// Utility function to get clinic assignments for a specific date
export function getClinicAssignmentsForDate(
  schedule: ClinicSchedule | null,
  dateISO: string
): ClinicAssignment[] {
  if (!schedule) return [];
  return schedule.days[dateISO] || [];
}

// Utility function to format clinic assignments for display
export function formatClinicAssignments(assignments: ClinicAssignment[]): string {
  if (assignments.length === 0) return "";
  
  const clinicNames: Record<ClinicType, string> = {
    GENERAL: "General",
    HEART_FAILURE: "HF",
    ACHD: "ACHD", 
    DEVICE: "Device",
    EP: "EP"
  };
  
  return assignments.map(a => clinicNames[a.clinicType]).join(", ");
}

export interface ClinicNote {
  fellowId: string;
  reason: string;
  type: 'post-call' | 'vacation' | 'ccu-rotation' | 'hf-rotation' | 'special-assignment';
}

export function getClinicNotesForDate(
  dateISO: string,
  fellows: Array<{ id: string; name: string; pgy: string; preferredClinicDay: string }>,
  callSchedule: CallSchedule | null,
  clinicSchedule: ClinicSchedule | null,
  setup: SetupState | null
): ClinicNote[] {
  if (!setup || !fellows.length || !clinicSchedule) return [];

  const notes: ClinicNote[] = [];
  const date = parseISO(dateISO);
  const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const currentDay = dayNames[dayOfWeek];

  // Get clinic assignments for this date
  const clinicAssignments = getClinicAssignmentsForDate(clinicSchedule, dateISO);
  const fellowsWithClinics = new Set(clinicAssignments.map(a => a.fellowId));

  for (const fellow of fellows) {
    const fellowRotation = getFellowRotationOnDate(fellow.id, dateISO);
    
    // Check if fellow should have general clinic on this day
    const shouldHaveGeneralClinic = fellow.preferredClinicDay === currentDay && 
                                   !isHoliday(dateISO, setup) &&
                                   fellowRotation !== 'VAC' as any;

    // Check if fellow has clinic assignment
    const hasClinicAssignment = fellowsWithClinics.has(fellow.id);

    // Determine if we need to show a note
    let noteReason = '';
    let noteType: ClinicNote['type'] | null = null;

    if (shouldHaveGeneralClinic && !hasClinicAssignment) {
      // Fellow should have general clinic but doesn't - find reason
      
      // Check if they have special clinic this week (LAC_CATH→ACHD or NONINVASIVE→HF)
      if (hasSpecialClinicInSameWeek(fellow.id, date, clinicSchedule)) {
        if (fellowRotation === 'LAC_CATH') {
          noteReason = 'LAC_CATH→ACHD';
          noteType = 'special-assignment';
        } else if (fellowRotation === 'NONINVASIVE') {
          noteReason = 'NONINVASIVE→HF';
          noteType = 'special-assignment';
        }
      } else if (isPostCallDay(fellow.id, dateISO, callSchedule)) {
        noteReason = 'Post-Call';
        noteType = 'post-call';
      } else if (fellowRotation === 'CCU') {
        noteReason = 'CCU Rotation';
        noteType = 'ccu-rotation';
      } else if (fellowRotation === 'HF') {
        noteReason = 'HF Rotation';
        noteType = 'hf-rotation';
      } else if (fellowRotation === 'VAC' as any) {
        noteReason = 'Vacation';
        noteType = 'vacation';
      }
    }

    // Additional check: PGY-5/6 NONINVASIVE fellows missing Tuesday HF clinic due to post-call
    if (dayOfWeek === 2 && // Tuesday
        (fellow.pgy === 'PGY-5' || fellow.pgy === 'PGY-6') &&
        fellowRotation === 'NONINVASIVE' &&
        !hasClinicAssignment &&
        isPostCallDay(fellow.id, dateISO, callSchedule)) {
      noteReason = 'Post-Call (HF Clinic)';
      noteType = 'post-call';
    }

    if (noteReason && noteType) {
      notes.push({
        fellowId: fellow.id,
        reason: noteReason,
        type: noteType
      });
    }
  }

  return notes;
}

export interface ClinicCoverageGap {
  date: string;
  dayOfWeek: string;
  clinicType: ClinicType | 'AMBULATORY_FELLOW';
  required: number;
  assigned: number;
}

// Helper function to check if any fellow is on EP rotation for a given date
function anyFellowOnEPRotation(dateISO: string, setup: SetupState): boolean {
  for (const fellow of setup.fellows) {
    const rotation = getFellowRotationOnDate(fellow.id, dateISO);
    if (rotation && getPrimaryRotation(rotation) === "EP") {
      return true;
    }
  }
  return false;
}

export function checkSpecialtyClinicCoverage(
  clinicSchedule: ClinicSchedule | null,
  setup: SetupState | null
): { success: boolean; gaps: ClinicCoverageGap[] } {
  if (!clinicSchedule || !setup) {
    return { success: false, gaps: [] };
  }

  const { days } = july1ToJune30Window(setup.yearStart);
  const gaps: ClinicCoverageGap[] = [];
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Track which blocks have ambulatory fellow assignments
  const blocksWithAmbulatoryFellow = new Set<string>();
  
  for (const date of days) {
    const dateISO = toISODate(date);
    const dayOfWeek = date.getDay(); // 0=Sunday, 1=Monday, etc.
    const dayName = dayNames[dayOfWeek];
    
    // Track ambulatory fellow assignments by block
    const blockKey = getBlockKeyForDate(dateISO, setup.yearStart);
    if (blockKey && clinicSchedule.ambulatoryAssignments?.[dateISO]) {
      blocksWithAmbulatoryFellow.add(blockKey);
    }
    
    // Skip holidays
    if (isHoliday(dateISO, setup)) continue;
    
    const assignments = clinicSchedule.days[dateISO] || [];
    
    // Check Monday ACHD requirement
    if (dayOfWeek === 1) { // Monday
      const achdCount = assignments.filter(a => a.clinicType === "ACHD").length;
      if (achdCount === 0) {
        gaps.push({
          date: dateISO,
          dayOfWeek: dayName,
          clinicType: "ACHD",
          required: 1,
          assigned: achdCount
        });
      }
    }
    
    // Check Tuesday HF requirement
    if (dayOfWeek === 2) { // Tuesday
      const hfCount = assignments.filter(a => a.clinicType === "HEART_FAILURE").length;
      if (hfCount === 0) {
        gaps.push({
          date: dateISO,
          dayOfWeek: dayName,
          clinicType: "HEART_FAILURE",
          required: 1,
          assigned: hfCount
        });
      }
    }
    
    // Check Friday Device requirement (only if EP fellow is on rotation)
    if (dayOfWeek === 5) { // Friday
      const hasEPFellow = anyFellowOnEPRotation(dateISO, setup);
      if (hasEPFellow) {
        const deviceCount = assignments.filter(a => a.clinicType === "DEVICE").length;
        if (deviceCount === 0) {
          gaps.push({
            date: dateISO,
            dayOfWeek: dayName,
            clinicType: "DEVICE",
            required: 1,
            assigned: deviceCount
          });
        }
      }
    }
    
    // Check 1st and 3rd Wednesday EP requirement (only if EP fellow is on rotation)
    if (dayOfWeek === 3 && isFirstOrThirdWednesday(date)) { // Wednesday
      const hasEPFellow = anyFellowOnEPRotation(dateISO, setup);
      if (hasEPFellow) {
        const epCount = assignments.filter(a => a.clinicType === "EP").length;
        if (epCount === 0) {
          gaps.push({
            date: dateISO,
            dayOfWeek: dayName,
            clinicType: "EP",
            required: 1,
            assigned: epCount
          });
        }
      }
    }
  }
  
  // Check for ambulatory fellow gaps (unassigned blocks)
  // Get all unique block keys from the year
  const allBlockKeys = new Set<string>();
  for (const date of days) {
    const dateISO = toISODate(date);
    const blockKey = getBlockKeyForDate(dateISO, setup.yearStart);
    if (blockKey) {
      allBlockKeys.add(blockKey);
    }
  }
  
  // Find blocks without ambulatory fellow assignments
  for (const blockKey of allBlockKeys) {
    if (!blocksWithAmbulatoryFellow.has(blockKey)) {
      // Find the first date in this block to report the gap
      const firstDateInBlock = days.find(date => {
        const dateISO = toISODate(date);
        return getBlockKeyForDate(dateISO, setup.yearStart) === blockKey;
      });
      
      if (firstDateInBlock) {
        const dateISO = toISODate(firstDateInBlock);
        const dayOfWeek = firstDateInBlock.getDay();
        const dayName = dayNames[dayOfWeek];
        
        gaps.push({
          date: dateISO,
          dayOfWeek: `${dayName} (${blockKey})`,
          clinicType: "AMBULATORY_FELLOW",
          required: 1,
          assigned: 0
        });
      }
    }
  }

  return {
    success: gaps.length === 0,
    gaps
  };
}

// Get eligible ambulatory fellows for a specific block
export function getEligibleAmbulatoryFellows(blockKey: string, schedule: ClinicSchedule, setup: SetupState): Fellow[] {
  const rotationPriority: Array<string> = ['NUCLEAR', 'NONINVASIVE', 'ELECTIVE', 'EP'];
  
  // Find the first date in this block to check rotations
  const { days } = july1ToJune30Window(setup.yearStart);
  const firstDateInBlock = days.find(date => {
    const dateISO = toISODate(date);
    return getBlockKeyForDate(dateISO, setup.yearStart) === blockKey;
  });
  
  if (!firstDateInBlock) return [];
  const dateISO = toISODate(firstDateInBlock);
  
  // Get the fellow assigned to the previous block (to prevent consecutive assignments)
  const prevBlockFellow = getPreviousBlockFellow(blockKey, schedule, setup);
  
  const eligible: Fellow[] = [];
  
  for (const targetRotation of rotationPriority) {
    const fellowsOnRotation = setup.fellows.filter(fellow => {
      // Must be PGY-5 or PGY-6
      if (fellow.pgy !== "PGY-5" && fellow.pgy !== "PGY-6") return false;
      
      // Must not have 3 assignments already
      if ((schedule.ambulatoryCountsByFellow?.[fellow.id] ?? 0) >= 3) return false;
      
      // Cannot be the same fellow as the previous block
      if (fellow.id === prevBlockFellow) return false;
      
      // Check if fellow is on the target rotation during this block
      const rotation = getFellowRotationOnDate(fellow.id, dateISO);
      const primaryRotation = rotation ? getPrimaryRotation(rotation) : undefined;
      
      return primaryRotation === targetRotation;
    });
    
    eligible.push(...fellowsOnRotation);
  }
  
  // Sort by assignment count (fewest first)
  eligible.sort((a, b) => {
    const aCount = schedule.ambulatoryCountsByFellow?.[a.id] ?? 0;
    const bCount = schedule.ambulatoryCountsByFellow?.[b.id] ?? 0;
    return aCount - bCount;
  });
  
  return eligible;
}

// Get ineligible ambulatory fellows with reasons
export function getIneligibleAmbulatoryReasons(blockKey: string, schedule: ClinicSchedule, setup: SetupState): Array<{ fellow: Fellow; reasons: string[] }> {
  const { days } = july1ToJune30Window(setup.yearStart);
  const firstDateInBlock = days.find(date => {
    const dateISO = toISODate(date);
    return getBlockKeyForDate(dateISO, setup.yearStart) === blockKey;
  });
  
  if (!firstDateInBlock) return [];
  const dateISO = toISODate(firstDateInBlock);
  
  const prevBlockFellow = getPreviousBlockFellow(blockKey, schedule, setup);
  const eligibleIds = new Set(getEligibleAmbulatoryFellows(blockKey, schedule, setup).map(f => f.id));
  
  const ineligible: Array<{ fellow: Fellow; reasons: string[] }> = [];
  
  for (const fellow of setup.fellows) {
    if (eligibleIds.has(fellow.id)) continue;
    
    const reasons: string[] = [];
    
    // Check PGY level
    if (fellow.pgy !== "PGY-5" && fellow.pgy !== "PGY-6") {
      reasons.push("Not PGY-5 or PGY-6");
    }
    
    // Check assignment count
    const count = schedule.ambulatoryCountsByFellow?.[fellow.id] ?? 0;
    if (count >= 3) {
      reasons.push(`Already has maximum 3 assignments (${count})`);
    }
    
    // Check consecutive block rule
    if (fellow.id === prevBlockFellow) {
      reasons.push("Assigned to previous block (no consecutive assignments allowed)");
    }
    
    // Check rotation
    const rotation = getFellowRotationOnDate(fellow.id, dateISO);
    const primaryRotation = rotation ? getPrimaryRotation(rotation) : undefined;
    const eligibleRotations = ['NUCLEAR', 'NONINVASIVE', 'ELECTIVE', 'EP'];
    if (primaryRotation && !eligibleRotations.includes(primaryRotation)) {
      reasons.push(`Not on eligible rotation (on ${primaryRotation})`);
    } else if (!primaryRotation) {
      reasons.push("Rotation not found for this block");
    }
    
    if (reasons.length > 0) {
      ineligible.push({ fellow, reasons });
    }
  }
  
  return ineligible;
}

// Apply ambulatory assignment for a block
export function applyAmbulatoryAssignment(
  schedule: ClinicSchedule, 
  blockKey: string, 
  fellowId: string | null, 
  setup: SetupState
): { success: boolean; schedule?: ClinicSchedule; error?: string } {
  const newSchedule = JSON.parse(JSON.stringify(schedule)) as ClinicSchedule;
  
  if (!newSchedule.ambulatoryAssignments) {
    newSchedule.ambulatoryAssignments = {};
  }
  if (!newSchedule.ambulatoryCountsByFellow) {
    newSchedule.ambulatoryCountsByFellow = {};
  }
  
  const { days } = july1ToJune30Window(setup.yearStart);
  
  // Get all dates in this block
  const blockDates = days.filter(date => {
    const dateISO = toISODate(date);
    return getBlockKeyForDate(dateISO, setup.yearStart) === blockKey;
  }).map(d => toISODate(d));
  
  if (blockDates.length === 0) {
    return { success: false, error: "Invalid block key" };
  }
  
  // Get current assignment (check first date in block)
  const currentFellowId = newSchedule.ambulatoryAssignments[blockDates[0]];
  
  // Clear old assignment if exists
  if (currentFellowId) {
    // Decrement count for old fellow
    if (newSchedule.ambulatoryCountsByFellow[currentFellowId]) {
      newSchedule.ambulatoryCountsByFellow[currentFellowId]--;
    }
    
    // Clear all dates in the block
    for (const dateISO of blockDates) {
      delete newSchedule.ambulatoryAssignments[dateISO];
    }
  }
  
  // Apply new assignment if provided
  if (fellowId) {
    // Increment count for new fellow
    if (!newSchedule.ambulatoryCountsByFellow[fellowId]) {
      newSchedule.ambulatoryCountsByFellow[fellowId] = 0;
    }
    newSchedule.ambulatoryCountsByFellow[fellowId]++;
    
    // Assign to all dates in the block
    for (const dateISO of blockDates) {
      newSchedule.ambulatoryAssignments[dateISO] = fellowId;
    }
  }
  
  return { success: true, schedule: newSchedule };
}

// Helper to get the fellow assigned to the previous block
function getPreviousBlockFellow(blockKey: string, schedule: ClinicSchedule, setup: SetupState): string | undefined {
  const { days } = july1ToJune30Window(setup.yearStart);
  
  // Find the first date in the current block
  const firstDateInBlock = days.find(date => {
    const dateISO = toISODate(date);
    return getBlockKeyForDate(dateISO, setup.yearStart) === blockKey;
  });
  
  if (!firstDateInBlock) return undefined;
  
  // Go back one day to find the previous block
  const prevDate = addDays(firstDateInBlock, -1);
  const prevDateISO = toISODate(prevDate);
  
  return schedule.ambulatoryAssignments?.[prevDateISO];
}