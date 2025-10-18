import { SchedulerSettings } from "./settings-engine";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateSettings(settings: SchedulerSettings): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Vacation validation
  if (settings.vacation.maxVacationsPerYear < 1 || settings.vacation.maxVacationsPerYear > 4) {
    errors.push("Max vacations per year must be between 1 and 4");
  }
  if (settings.vacation.minSpacingBlocks < 3 || settings.vacation.minSpacingBlocks > 12) {
    warnings.push("Vacation spacing should typically be between 3 and 12 blocks");
  }
  if (settings.vacation.maxFellowsPerBlock < 1) {
    errors.push("Max fellows per block must be at least 1");
  }

  // Block rotation validation (rotation blocks + vacation blocks = 24 total)
  const validateBlockTotal = (pgy: "pgy4" | "pgy5" | "pgy6") => {
    const blocks = settings.blockRotations[pgy];
    let rotationTotal = 
      blocks.lacCathBlocks +
      blocks.ccuBlocks +
      blocks.lacConsultBlocks +
      blocks.hfBlocks +
      blocks.keckConsultBlocks +
      blocks.echo1Blocks +
      blocks.echo2Blocks +
      blocks.epBlocks +
      blocks.nuclearBlocks +
      blocks.electiveBlocks;
    
    // PGY-5 and PGY-6 have nonInvasiveBlocks, PGY-4 does not
    if (pgy === "pgy5" || pgy === "pgy6") {
      rotationTotal += (blocks as typeof settings.blockRotations.pgy5 | typeof settings.blockRotations.pgy6).nonInvasiveBlocks;
    }
    
    const expectedRotationBlocks = 24 - settings.vacation.maxVacationsPerYear;
    
    if (rotationTotal !== expectedRotationBlocks) {
      errors.push(`${pgy.toUpperCase()} rotation blocks must equal ${expectedRotationBlocks} (currently ${rotationTotal}). Total with ${settings.vacation.maxVacationsPerYear} vacation blocks = 24.`);
    }
  };
  
  validateBlockTotal("pgy4");
  validateBlockTotal("pgy5");
  validateBlockTotal("pgy6");

  // Primary call validation
  if (settings.primaryCall.minSpacingDays < 2 || settings.primaryCall.minSpacingDays > 7) {
    warnings.push("Primary call spacing should typically be between 2 and 7 days");
  }
  
  // Check for duplicate PGYs in weekday priorities
  Object.entries(settings.primaryCall.weekdayPriority).forEach(([day, pgys]) => {
    if (new Set(pgys).size !== pgys.length) {
      errors.push(`${day} has duplicate PGYs in priority list`);
    }
  });

  // Jeopardy validation
  if (settings.jeopardyCall.minSpacingDays < 1 || settings.jeopardyCall.minSpacingDays > 5) {
    warnings.push("Jeopardy spacing should typically be between 1 and 5 days");
  }

  // HF coverage validation
  if (settings.hfCoverage.minSpacingDays < 7 || settings.hfCoverage.minSpacingDays > 21) {
    warnings.push("HF spacing should typically be between 7 and 21 days");
  }

  // Clinic validation
  const validDays = [0, 1, 2, 3, 4, 5, 6];
  settings.clinics.generalClinicDays.forEach((day) => {
    if (!validDays.includes(day)) {
      errors.push(`Invalid clinic day: ${day} (must be 0-6)`);
    }
  });

  // Ambulatory fellow validation
  if (settings.ambulatoryFellow.maxAssignmentsPerFellow < 1) {
    errors.push("Max ambulatory assignments must be at least 1");
  }
  if (settings.ambulatoryFellow.blockLengthWeeks < 1 || settings.ambulatoryFellow.blockLengthWeeks > 4) {
    warnings.push("Ambulatory block length should typically be 1-4 weeks");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
