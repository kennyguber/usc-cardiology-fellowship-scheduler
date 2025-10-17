import { PGY } from "./schedule-engine";

export interface SchedulerSettings {
  version: 1;
  
  // VACATION RULES
  vacation: {
    maxVacationsPerYear: number;
    minSpacingBlocks: number;
    julyRestriction: boolean;
    pgy4AugustRestriction: boolean;
    maxFellowsPerBlock: number;
    maxTotalPerBlock: number;
  };
  
  // BLOCK ROTATION RULES
  blockRotations: {
    pgy4: {
      lacCathBlocks: number;
      ccuBlocks: number;
      lacConsultBlocks: number;
      hfBlocks: number;
      keckConsultBlocks: number;
      echo1Blocks: number;
      echo2Blocks: number;
      epBlocks: number;
      nuclearBlocks: number;
      electiveBlocks: number;
      enforceEarlyLacCathRule: boolean;
      enforceNonConsecutiveMonths: boolean;
    };
    pgy5: {
      lacCathBlocks: number;
      ccuBlocks: number;
      lacConsultBlocks: number;
      hfBlocks: number;
      keckConsultBlocks: number;
      echo1Blocks: number;
      echo2Blocks: number;
      epBlocks: number;
      nuclearBlocks: number;
      electiveBlocks: number;
      enforceNonConsecutiveMonths: boolean;
    };
    pgy6: {
      lacCathBlocks: number;
      ccuBlocks: number;
      lacConsultBlocks: number;
      hfBlocks: number;
      keckConsultBlocks: number;
      echo1Blocks: number;
      echo2Blocks: number;
      epBlocks: number;
      nuclearBlocks: number;
      electiveBlocks: number;
      enforceNonConsecutiveMonths: boolean;
    };
  };
  
  // PRIMARY CALL RULES
  primaryCall: {
    maxCalls: {
      "PGY-4": number;
      "PGY-5": number;
      "PGY-6": number;
    };
    minSpacingDays: number;
    pgy4StartDate: string;
    weekdayPriority: {
      monday: PGY[];
      tuesday: PGY[];
      wednesday: PGY[];
      thursday: PGY[];
      friday: PGY[];
    };
    weekendPriority: PGY[];
    excludeRotations: string[];
    excludeEPOnDays: number[];
    noConsecutiveSaturdays: boolean;
  };
  
  // JEOPARDY CALL RULES
  jeopardyCall: {
    quotas: {
      "PGY-4": { weekday: number; weekend: number; holiday: number };
      "PGY-5": { weekday: number; weekend: number; holiday: number };
      "PGY-6": { weekday: number; weekend: number; holiday: number };
    };
    pgy4StartDate: string;
    holidayEligibility: PGY[];
    minSpacingDays: number;
    noConsecutiveDays: boolean;
    excludeRotations: string[];
    thanksgivingBlockDays: number;
    mondayFridayHolidayDays: number;
    midweekHolidayDays: number;
  };
  
  // HF COVERAGE RULES
  hfCoverage: {
    weekendQuotas: {
      "PGY-4": number;
      "PGY-5": number;
      "PGY-6": number;
    };
    pgy4OnlyDuringRotation: boolean;
    pgy6OnlyDuringRotation: boolean;
    pgy5ExcludeVacation: boolean;
    holidayEligibility: PGY[];
    minSpacingDays: number;
    noConsecutiveWeekends: boolean;
    excludePrimaryCallFriday: boolean;
    excludePrimaryCallWeekend: boolean;
  };
  
  // CLINIC RULES
  clinics: {
    generalClinicDays: number[];
    specialClinics: {
      heartFailure: {
        dayOfWeek: number;
        eligibleRotations: string[];
        eligiblePGYs: PGY[];
      };
      achd: {
        dayOfWeek: number;
        eligibleRotations: string[];
        eligiblePGYs: PGY[];
      };
      device: {
        dayOfWeek: number;
        eligibleRotations: string[];
      };
      ep: {
        dayOfWeek: number;
        eligibleRotations: string[];
        weekOfMonth: number[];
      };
    };
    excludeRotations: {
      general: string[];
      special: string[];
    };
    excludePostCall: boolean;
    excludeHolidays: boolean;
    skipWeekWithSpecialClinic: boolean;
  };
  
  // AMBULATORY FELLOW RULES
  ambulatoryFellow: {
    blockLengthWeeks: number;
    eligiblePGYs: PGY[];
    maxAssignmentsPerFellow: number;
    rotationPriority: string[];
    noConsecutiveBlocks: boolean;
  };
}

export const DEFAULT_SETTINGS: SchedulerSettings = {
  version: 1,
  
  vacation: {
    maxVacationsPerYear: 2,
    minSpacingBlocks: 6,
    julyRestriction: true,
    pgy4AugustRestriction: true,
    maxFellowsPerBlock: 2,
    maxTotalPerBlock: 2,
  },
  
  blockRotations: {
    pgy4: {
      lacCathBlocks: 4,
      ccuBlocks: 4,
      lacConsultBlocks: 4,
      hfBlocks: 2,
      keckConsultBlocks: 4,
      echo1Blocks: 2,
      echo2Blocks: 2,
      epBlocks: 2,
      nuclearBlocks: 2,
      electiveBlocks: 2,
      enforceEarlyLacCathRule: true,
      enforceNonConsecutiveMonths: true,
    },
    pgy5: {
      lacCathBlocks: 6,
      ccuBlocks: 2,
      lacConsultBlocks: 2,
      hfBlocks: 2,
      keckConsultBlocks: 2,
      echo1Blocks: 2,
      echo2Blocks: 2,
      epBlocks: 2,
      nuclearBlocks: 2,
      electiveBlocks: 2,
      enforceNonConsecutiveMonths: true,
    },
    pgy6: {
      lacCathBlocks: 6,
      ccuBlocks: 2,
      lacConsultBlocks: 2,
      hfBlocks: 2,
      keckConsultBlocks: 2,
      echo1Blocks: 2,
      echo2Blocks: 2,
      epBlocks: 2,
      nuclearBlocks: 2,
      electiveBlocks: 2,
      enforceNonConsecutiveMonths: true,
    },
  },
  
  primaryCall: {
    maxCalls: {
      "PGY-4": 47,
      "PGY-5": 16,
      "PGY-6": 11,
    },
    minSpacingDays: 4,
    pgy4StartDate: "08-15",
    weekdayPriority: {
      monday: ["PGY-5", "PGY-4", "PGY-6"],
      tuesday: ["PGY-5", "PGY-4", "PGY-6"],
      wednesday: ["PGY-4", "PGY-5", "PGY-6"],
      thursday: ["PGY-6", "PGY-4", "PGY-5"],
      friday: ["PGY-4", "PGY-5", "PGY-6"],
    },
    weekendPriority: ["PGY-4", "PGY-5"],
    excludeRotations: ["VAC", "HF"],
    excludeEPOnDays: [2, 4],
    noConsecutiveSaturdays: true,
  },
  
  jeopardyCall: {
    quotas: {
      "PGY-4": { weekday: 5, weekend: 2, holiday: 0 },
      "PGY-5": { weekday: 15, weekend: 13, holiday: 0 },
      "PGY-6": { weekday: 32, weekend: 8, holiday: 0 },
    },
    pgy4StartDate: "08-15",
    holidayEligibility: ["PGY-5"],
    minSpacingDays: 2,
    noConsecutiveDays: true,
    excludeRotations: ["VAC", "HF", "CCU"],
    thanksgivingBlockDays: 4,
    mondayFridayHolidayDays: 3,
    midweekHolidayDays: 1,
  },
  
  hfCoverage: {
    weekendQuotas: {
      "PGY-4": 2,
      "PGY-5": 7,
      "PGY-6": 2,
    },
    pgy4OnlyDuringRotation: true,
    pgy6OnlyDuringRotation: true,
    pgy5ExcludeVacation: true,
    holidayEligibility: ["PGY-5"],
    minSpacingDays: 14,
    noConsecutiveWeekends: true,
    excludePrimaryCallFriday: true,
    excludePrimaryCallWeekend: true,
  },
  
  clinics: {
    generalClinicDays: [1, 3, 4],
    specialClinics: {
      heartFailure: {
        dayOfWeek: 2,
        eligibleRotations: ["NONINVASIVE"],
        eligiblePGYs: ["PGY-5", "PGY-6"],
      },
      achd: {
        dayOfWeek: 1,
        eligibleRotations: ["LAC_CATH"],
        eligiblePGYs: ["PGY-5", "PGY-6"],
      },
      device: {
        dayOfWeek: 5,
        eligibleRotations: ["EP"],
      },
      ep: {
        dayOfWeek: 3,
        eligibleRotations: ["EP"],
        weekOfMonth: [1, 3],
      },
    },
    excludeRotations: {
      general: ["VAC", "CCU", "HF"],
      special: ["VAC"],
    },
    excludePostCall: true,
    excludeHolidays: true,
    skipWeekWithSpecialClinic: true,
  },
  
  ambulatoryFellow: {
    blockLengthWeeks: 2,
    eligiblePGYs: ["PGY-5", "PGY-6"],
    maxAssignmentsPerFellow: 3,
    rotationPriority: ["NUCLEAR", "NONINVASIVE", "ELECTIVE", "EP"],
    noConsecutiveBlocks: true,
  },
};

const SETTINGS_STORAGE_KEY = "cfsa_settings_v1";

export function loadSettings(): SchedulerSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!stored) return DEFAULT_SETTINGS;
    
    const parsed = JSON.parse(stored) as SchedulerSettings;
    // Merge with defaults to handle missing keys
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch (error) {
    console.error("Failed to load settings:", error);
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: SchedulerSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error("Failed to save settings:", error);
  }
}

export function resetSettings(): SchedulerSettings {
  saveSettings(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

export function exportSettings(settings: SchedulerSettings): void {
  const dataStr = JSON.stringify(settings, null, 2);
  const dataBlob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "scheduler-settings.json";
  link.click();
  URL.revokeObjectURL(url);
}

export function importSettings(file: File): Promise<SchedulerSettings> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const settings = JSON.parse(e.target?.result as string) as SchedulerSettings;
        // Basic validation
        if (!settings.version || settings.version !== 1) {
          reject(new Error("Invalid settings file version"));
          return;
        }
        resolve(settings);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
