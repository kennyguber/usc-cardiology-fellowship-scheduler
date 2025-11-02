import { format, parseISO, addDays, isAfter, isBefore, isEqual } from "date-fns";
import { computeAcademicYearHolidays } from "@/lib/holidays";
import { loadSchedule, loadSetup, type Fellow, type PGY, type SetupState } from "@/lib/schedule-engine";
import { type Rotation, getPrimaryRotation } from "@/lib/rotation-engine";
import type { CallSchedule } from "@/lib/call-engine";
import { loadSettings } from "@/lib/settings-engine";

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

// NOTE: These constants are deprecated - the algorithm now uses settings from clinicSettings
// They are kept here only for reference
const GENERAL_CLINIC_DAYS = [1, 3, 4]; // Monday=1, Wednesday=3, Thursday=4
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
  const dayOfMonth = date.getDate();
  return Math.ceil(dayOfMonth / 7);
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

/**
 * Selects the best fellow for a specialty clinic from eligible candidates
 * Tie-breaking rules:
 * 1. Fellow with fewest total specialty clinics (all types)
 * 2. Fellow with fewest of this specific clinic type
 * 3. Alphabetical by ID
 */
function selectBestCandidateForSpecialtyClinic(
  eligibleFellows: Fellow[],
  clinicType: 'HEART_FAILURE' | 'ACHD' | 'DEVICE' | 'EP',
  countsByFellow: Record<string, Record<ClinicType, number>>
): Fellow | null {
  if (eligibleFellows.length === 0) return null;
  if (eligibleFellows.length === 1) return eligibleFellows[0];
  
  // Sort by priority criteria
  const sorted = [...eligibleFellows].sort((a, b) => {
    const countsA = countsByFellow[a.id];
    const countsB = countsByFellow[b.id];
    
    // Total specialty clinics (excluding GENERAL)
    const totalA = countsA.HEART_FAILURE + countsA.ACHD + countsA.DEVICE + countsA.EP;
    const totalB = countsB.HEART_FAILURE + countsB.ACHD + countsB.DEVICE + countsB.EP;
    
    if (totalA !== totalB) return totalA - totalB;
    
    // This specific clinic type count
    const typeCountA = countsA[clinicType];
    const typeCountB = countsB[clinicType];
    
    if (typeCountA !== typeCountB) return typeCountA - typeCountB;
    
    // Alphabetical by ID
    return a.id.localeCompare(b.id);
  });
  
  return sorted[0];
}

export function buildClinicSchedule(
  callSchedule: CallSchedule | null,
  setup: SetupState | null
): ClinicSchedule | null {
  if (!setup) return null;
  
  // Load settings
  const settings = loadSettings();
  const clinicSettings = settings.clinics;
  
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
    
    const weekOfMonth = getWeekOfMonth(date);
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    
    // Track which fellows have been assigned a specialty clinic today
    const fellowsWithSpecialtyClinicToday = new Set<string>();
    
    // ==================== PASS 1: SPECIALTY CLINIC ASSIGNMENTS ====================
    
    // Helper to assign a specialty clinic
    const assignSpecialtyClinic = (
      clinicConfig: { dayOfWeek: number; weekOfMonth: number[]; eligibleRotations: string[]; eligiblePGYs: PGY[] },
      clinicType: 'HEART_FAILURE' | 'ACHD' | 'DEVICE' | 'EP'
    ) => {
      // Check if this clinic should run today
      // If week 4 is configured, treat it as including week 5+ (rest of month)
      const effectiveWeekOfMonth = weekOfMonth > 4 && clinicConfig.weekOfMonth.includes(4) 
        ? 4 
        : weekOfMonth;
      
      if (dayOfWeek !== clinicConfig.dayOfWeek || !clinicConfig.weekOfMonth.includes(effectiveWeekOfMonth)) {
        return;
      }
      
      // Find all eligible fellows
      const eligibleFellows = setup.fellows.filter(fellow => {
        const rotation = getFellowRotationOnDate(fellow.id, dateISO);
        const primaryRotation = rotation ? getPrimaryRotation(rotation) : undefined;
        
        // Check all eligibility criteria
        return (
          clinicConfig.eligibleRotations.includes(primaryRotation || "") &&
          clinicConfig.eligiblePGYs.includes(fellow.pgy) &&
          !isExcludedFromSpecialClinic(fellow, dateISO, rotation, callSchedule, setup) &&
          !fellowsWithSpecialtyClinicToday.has(fellow.id) // Not already assigned today
        );
      });
      
      // Select best candidate
      const selectedFellow = selectBestCandidateForSpecialtyClinic(
        eligibleFellows,
        clinicType,
        schedule.countsByFellow
      );
      
      if (selectedFellow) {
        assignments.push({
          fellowId: selectedFellow.id,
          clinicType: clinicType,
          dayOfWeek: dayNames[dayOfWeek]
        });
        schedule.countsByFellow[selectedFellow.id][clinicType]++;
        fellowsWithSpecialtyClinicToday.add(selectedFellow.id);
      } else {
        // Log warning - no eligible fellow found for this specialty clinic
        console.warn(`No eligible fellow for ${clinicType} clinic on ${dateISO} (${dayNames[dayOfWeek]}, week ${weekOfMonth})`);
      }
    };
    
    // Assign each specialty clinic type
    assignSpecialtyClinic(clinicSettings.specialClinics.heartFailure, 'HEART_FAILURE');
    assignSpecialtyClinic(clinicSettings.specialClinics.achd, 'ACHD');
    assignSpecialtyClinic(clinicSettings.specialClinics.device, 'DEVICE');
    assignSpecialtyClinic(clinicSettings.specialClinics.ep, 'EP');
    
    // ==================== PASS 2: GENERAL CLINIC ASSIGNMENTS ====================
    
    // Only assign general clinics on configured general clinic days
    if (clinicSettings.generalClinicDays.includes(dayOfWeek)) {
      for (const fellow of setup.fellows) {
        // Skip if already assigned a specialty clinic today
        if (fellowsWithSpecialtyClinicToday.has(fellow.id)) {
          continue;
        }
        
        const rotation = getFellowRotationOnDate(fellow.id, dateISO);
        
        // Check general exclusion conditions
        if (isExcludedFromGeneralClinic(fellow, dateISO, rotation, callSchedule, setup)) {
          continue;
        }
        
        const fellowClinicDay = fellow.clinicDay;
        const currentDayName = dayNames[dayOfWeek];
        
        // Check if this fellow has a special clinic (ACHD or HF) in the same week
        if (hasSpecialClinicInSameWeek(fellow.id, date, schedule)) {
          continue;
        }
        
        // Assign general clinic if it's their preferred day
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
/**
 * Apply a clinic assignment change (add, edit, remove)
 * Automatically updates countsByFellow statistics
 */
export function applyClinicAssignmentChange(
  schedule: ClinicSchedule,
  dateISO: string,
  operation: 'add' | 'edit' | 'remove',
  assignmentIndex: number | null,
  newAssignment: ClinicAssignment | null
): { success: boolean; schedule?: ClinicSchedule; error?: string } {
  const updatedSchedule = JSON.parse(JSON.stringify(schedule)) as ClinicSchedule;
  const dayAssignments = updatedSchedule.days[dateISO] || [];
  
  if (operation === 'remove') {
    if (assignmentIndex === null || assignmentIndex < 0 || assignmentIndex >= dayAssignments.length) {
      return { success: false, error: 'Invalid assignment index' };
    }
    
    const oldAssignment = dayAssignments[assignmentIndex];
    
    // Remove from array
    dayAssignments.splice(assignmentIndex, 1);
    updatedSchedule.days[dateISO] = dayAssignments;
    
    // Update counts
    if (updatedSchedule.countsByFellow[oldAssignment.fellowId]) {
      updatedSchedule.countsByFellow[oldAssignment.fellowId][oldAssignment.clinicType]--;
    }
    
    return { success: true, schedule: updatedSchedule };
  }
  
  if (operation === 'add') {
    if (!newAssignment) {
      return { success: false, error: 'New assignment required for add operation' };
    }
    
    // Check for duplicate (same fellow, same clinic type, same day)
    const duplicate = dayAssignments.find(
      a => a.fellowId === newAssignment.fellowId && a.clinicType === newAssignment.clinicType
    );
    
    if (duplicate) {
      return { success: false, error: 'This fellow already has this clinic type on this day' };
    }
    
    // Add to array
    dayAssignments.push(newAssignment);
    updatedSchedule.days[dateISO] = dayAssignments;
    
    // Update counts
    if (!updatedSchedule.countsByFellow[newAssignment.fellowId]) {
      updatedSchedule.countsByFellow[newAssignment.fellowId] = {
        GENERAL: 0,
        HEART_FAILURE: 0,
        ACHD: 0,
        DEVICE: 0,
        EP: 0
      };
    }
    updatedSchedule.countsByFellow[newAssignment.fellowId][newAssignment.clinicType]++;
    
    return { success: true, schedule: updatedSchedule };
  }
  
  if (operation === 'edit') {
    if (assignmentIndex === null || assignmentIndex < 0 || assignmentIndex >= dayAssignments.length) {
      return { success: false, error: 'Invalid assignment index' };
    }
    
    if (!newAssignment) {
      return { success: false, error: 'New assignment required for edit operation' };
    }
    
    const oldAssignment = dayAssignments[assignmentIndex];
    
    // Check for duplicate if changing fellow or clinic type
    const duplicate = dayAssignments.find(
      (a, idx) => idx !== assignmentIndex && 
                  a.fellowId === newAssignment.fellowId && 
                  a.clinicType === newAssignment.clinicType
    );
    
    if (duplicate) {
      return { success: false, error: 'This fellow already has this clinic type on this day' };
    }
    
    // Replace assignment
    dayAssignments[assignmentIndex] = newAssignment;
    updatedSchedule.days[dateISO] = dayAssignments;
    
    // Update counts - decrement old, increment new
    if (updatedSchedule.countsByFellow[oldAssignment.fellowId]) {
      updatedSchedule.countsByFellow[oldAssignment.fellowId][oldAssignment.clinicType]--;
    }
    
    if (!updatedSchedule.countsByFellow[newAssignment.fellowId]) {
      updatedSchedule.countsByFellow[newAssignment.fellowId] = {
        GENERAL: 0,
        HEART_FAILURE: 0,
        ACHD: 0,
        DEVICE: 0,
        EP: 0
      };
    }
    updatedSchedule.countsByFellow[newAssignment.fellowId][newAssignment.clinicType]++;
    
    return { success: true, schedule: updatedSchedule };
  }
  
  return { success: false, error: 'Invalid operation' };
}

/**
 * Get fellows who could be assigned a clinic on a given date
 * Returns sorted by current clinic count (load balancing)
 */
export function getEligibleFellowsForClinic(
  dateISO: string,
  clinicType: ClinicType,
  schedule: ClinicSchedule,
  callSchedule: CallSchedule | null,
  setup: SetupState
): Fellow[] {
  const settings = loadSettings();
  const clinicSettings = settings?.clinics;
  if (!clinicSettings) return [];
  
  const date = parseISO(dateISO);
  
  // Skip holidays
  if (isHoliday(dateISO, setup)) return [];
  
  const eligible = setup.fellows.filter(fellow => {
    const rotation = getFellowRotationOnDate(fellow.id, dateISO);
    const primaryRotation = rotation ? getPrimaryRotation(rotation) : undefined;
    
    // Check for specialty clinic eligibility
    if (clinicType !== 'GENERAL') {
      let config: { eligibleRotations: string[]; eligiblePGYs: PGY[] } | null = null;
      
      if (clinicType === 'HEART_FAILURE') {
        config = clinicSettings.specialClinics.heartFailure;
      } else if (clinicType === 'ACHD') {
        config = clinicSettings.specialClinics.achd;
      } else if (clinicType === 'DEVICE') {
        config = clinicSettings.specialClinics.device;
      } else if (clinicType === 'EP') {
        config = clinicSettings.specialClinics.ep;
      }
      
      if (!config) return false;
      
      // Check rotation and PGY eligibility
      if (!config.eligibleRotations.includes(primaryRotation || "")) return false;
      if (!config.eligiblePGYs.includes(fellow.pgy)) return false;
      
      // Check exclusions for specialty clinics
      if (isExcludedFromSpecialClinic(fellow, dateISO, rotation, callSchedule, setup)) {
        return false;
      }
    } else {
      // General clinic eligibility
      if (isExcludedFromGeneralClinic(fellow, dateISO, rotation, callSchedule, setup)) {
        return false;
      }
    }
    
    return true;
  });
  
  // Sort by current clinic count (load balancing)
  return eligible.sort((a, b) => {
    const countA = schedule.countsByFellow[a.id]?.[clinicType] || 0;
    const countB = schedule.countsByFellow[b.id]?.[clinicType] || 0;
    
    if (countA !== countB) return countA - countB;
    
    // Tie-breaker: alphabetical
    return a.id.localeCompare(b.id);
  });
}

/**
 * Get all fellows and reasons why they're ineligible for a clinic
 */
export function getIneligibleClinicReasons(
  dateISO: string,
  clinicType: ClinicType,
  schedule: ClinicSchedule,
  callSchedule: CallSchedule | null,
  setup: SetupState
): Array<{ fellow: Fellow; reasons: string[] }> {
  const settings = loadSettings();
  const clinicSettings = settings?.clinics;
  if (!clinicSettings) return [];
  
  const date = parseISO(dateISO);
  const isHolidayDay = isHoliday(dateISO, setup);
  
  const ineligible: Array<{ fellow: Fellow; reasons: string[] }> = [];
  
  for (const fellow of setup.fellows) {
    const rotation = getFellowRotationOnDate(fellow.id, dateISO);
    const primaryRotation = rotation ? getPrimaryRotation(rotation) : undefined;
    const reasons: string[] = [];
    
    // Check if already eligible (skip if no reasons)
    let isEligible = true;
    
    if (isHolidayDay) {
      reasons.push('Holiday - no clinics scheduled');
      isEligible = false;
    }
    
    // Check vacation (via rotation)
    if (primaryRotation === 'VAC') {
      reasons.push('On vacation');
      isEligible = false;
    }
    
    // Check specialty clinic specific criteria
    if (clinicType !== 'GENERAL') {
      let config: { eligibleRotations: string[]; eligiblePGYs: PGY[] } | null = null;
      
      if (clinicType === 'HEART_FAILURE') {
        config = clinicSettings.specialClinics.heartFailure;
      } else if (clinicType === 'ACHD') {
        config = clinicSettings.specialClinics.achd;
      } else if (clinicType === 'DEVICE') {
        config = clinicSettings.specialClinics.device;
      } else if (clinicType === 'EP') {
        config = clinicSettings.specialClinics.ep;
      }
      
      if (config) {
        // Check rotation
        if (!config.eligibleRotations.includes(primaryRotation || "")) {
          reasons.push(`Not on eligible rotation (currently on ${primaryRotation || 'none'})`);
          isEligible = false;
        }
        
        // Check PGY
        if (!config.eligiblePGYs.includes(fellow.pgy)) {
          reasons.push(`Not eligible PGY level (${fellow.pgy})`);
          isEligible = false;
        }
        
        // Check post-call
        if (isPostCallDay(fellow.id, dateISO, callSchedule)) {
          reasons.push('Post-call (day after primary call)');
          isEligible = false;
        }
      }
    } else {
      // General clinic specific checks
      if (isExcludedFromGeneralClinic(fellow, dateISO, rotation, callSchedule, setup)) {
        // Add specific reasons
        if (isPostCallDay(fellow.id, dateISO, callSchedule)) {
          reasons.push('Post-call');
        }
        if (!primaryRotation || ['VACATION', 'RESEARCH', 'ELECTIVE'].includes(primaryRotation)) {
          reasons.push(`On ${primaryRotation || 'unknown rotation'}`);
        }
        isEligible = false;
      }
    }
    
    if (!isEligible && reasons.length > 0) {
      ineligible.push({ fellow, reasons });
    }
  }
  
  return ineligible.sort((a, b) => a.fellow.name.localeCompare(b.fellow.name));
}

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
    
    // Check EP clinic requirement based on settings
    const settings = loadSettings();
    const epClinic = settings.clinics.specialClinics.ep;
    const weekOfMonth = getWeekOfMonth(date);
    
    if (dayOfWeek === epClinic.dayOfWeek && epClinic.weekOfMonth.includes(weekOfMonth)) {
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