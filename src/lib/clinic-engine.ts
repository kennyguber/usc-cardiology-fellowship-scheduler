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

function getFellowRotationOnDate(fellowId: string, dateISO: string): Rotation | undefined {
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

function isExcludedFromClinic(
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
    countsByFellow: {}
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
      
      // Check exclusion conditions
      if (isExcludedFromClinic(fellow, dateISO, rotation, callSchedule, setup)) {
        continue;
      }
      
      // Apply special rotation rules for PGY-5 and PGY-6
      if ((fellow.pgy === "PGY-5" || fellow.pgy === "PGY-6")) {
        const primaryRotation = rotation ? getPrimaryRotation(rotation) : undefined;
        
        // Rule 3a: NONINVASIVE rotation -> Heart Failure Clinic on Tuesday
        if (primaryRotation === "NONINVASIVE" && dayOfWeek === HEART_FAILURE_CLINIC_DAY) {
          assignments.push({
            fellowId: fellow.id,
            clinicType: "HEART_FAILURE",
            dayOfWeek: "Tuesday"
          });
          schedule.countsByFellow[fellow.id].HEART_FAILURE++;
          continue; // Skip general clinic assignment
        }
        
        // Rule 3b: LAC_CATH rotation -> ACHD Clinic on Monday
        if (primaryRotation === "LAC_CATH" && dayOfWeek === ACHD_CLINIC_DAY) {
          assignments.push({
            fellowId: fellow.id,
            clinicType: "ACHD",
            dayOfWeek: "Monday"
          });
          schedule.countsByFellow[fellow.id].ACHD++;
          continue; // Skip general clinic assignment
        }
      }
      
      // Rule 4: EP rotation special assignments
      const primaryRotation = rotation ? getPrimaryRotation(rotation) : undefined;
      if (primaryRotation === "EP") {
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
      }
      
      // General clinic assignment
      if (GENERAL_CLINIC_DAYS.includes(dayOfWeek)) {
        const fellowClinicDay = fellow.clinicDay;
        const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const currentDayName = dayNames[dayOfWeek];
        
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
  
  return schedule;
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