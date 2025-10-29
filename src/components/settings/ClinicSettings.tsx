import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { SchedulerSettings, type PGY } from "@/lib/settings-engine";

// Helper component for day selection buttons (single select)
interface DayButtonsProps {
  selectedDay: number;
  onChange: (day: number) => void;
}

const DayButtons = ({ selectedDay, onChange }: DayButtonsProps) => {
  const days = [
    { day: 1, label: "Mon" },
    { day: 2, label: "Tue" },
    { day: 3, label: "Wed" },
    { day: 4, label: "Thu" },
    { day: 5, label: "Fri" }
  ];

  return (
    <div className="flex gap-2 flex-wrap">
      {days.map(({ day, label }) => (
        <Button
          key={day}
          variant={selectedDay === day ? "default" : "outline"}
          size="sm"
          onClick={() => onChange(day)}
          className="min-w-[60px]"
        >
          {label}
        </Button>
      ))}
    </div>
  );
};

// Helper component for week selection buttons (multi-select)
interface WeekButtonsProps {
  selectedWeeks: number[];
  onChange: (weeks: number[]) => void;
}

const WeekButtons = ({ selectedWeeks, onChange }: WeekButtonsProps) => {
  const weeks = [1, 2, 3, 4];

  const toggleWeek = (week: number) => {
    const newWeeks = selectedWeeks.includes(week)
      ? selectedWeeks.filter(w => w !== week)
      : [...selectedWeeks, week].sort();
    
    // Prevent deselecting all weeks
    if (newWeeks.length === 0) return;
    
    onChange(newWeeks);
  };

  return (
    <div className="flex gap-2 flex-wrap">
      {weeks.map(week => (
        <Button
          key={week}
          variant={selectedWeeks.includes(week) ? "default" : "outline"}
          size="sm"
          onClick={() => toggleWeek(week)}
          className="min-w-[50px]"
        >
          {week}
        </Button>
      ))}
    </div>
  );
};

// Helper component for rotation selection buttons (multi-select)
interface RotationButtonsProps {
  selectedRotations: string[];
  onChange: (rotations: string[]) => void;
}

const RotationButtons = ({ selectedRotations, onChange }: RotationButtonsProps) => {
  const rotations = [
    "VAC", "LAC_CATH", "CCU", "LAC_CONSULT", "HF", 
    "KECK_CONSULT", "ECHO1", "ECHO2", "EP", 
    "NUCLEAR", "NONINVASIVE", "ELECTIVE"
  ];

  const toggleRotation = (rotation: string) => {
    const newRotations = selectedRotations.includes(rotation)
      ? selectedRotations.filter(r => r !== rotation)
      : [...selectedRotations, rotation];
    
    // Prevent deselecting all rotations
    if (newRotations.length === 0) return;
    
    onChange(newRotations);
  };

  return (
    <div className="flex gap-2 flex-wrap">
      {rotations.map(rotation => (
        <Button
          key={rotation}
          variant={selectedRotations.includes(rotation) ? "default" : "outline"}
          size="sm"
          onClick={() => toggleRotation(rotation)}
          className="text-xs"
        >
          {rotation}
        </Button>
      ))}
    </div>
  );
};

// Helper component for PGY selection buttons (multi-select)
interface PGYButtonsProps {
  selectedPGYs: PGY[];
  onChange: (pgys: PGY[]) => void;
}

const PGYButtons = ({ selectedPGYs, onChange }: PGYButtonsProps) => {
  const pgys: PGY[] = ["PGY-4", "PGY-5", "PGY-6"];

  const togglePGY = (pgy: PGY) => {
    const newPGYs = selectedPGYs.includes(pgy)
      ? selectedPGYs.filter(p => p !== pgy)
      : [...selectedPGYs, pgy];
    
    // Prevent deselecting all PGYs
    if (newPGYs.length === 0) return;
    
    onChange(newPGYs as PGY[]);
  };

  return (
    <div className="flex gap-2 flex-wrap">
      {pgys.map(pgy => (
        <Button
          key={pgy}
          variant={selectedPGYs.includes(pgy) ? "default" : "outline"}
          size="sm"
          onClick={() => togglePGY(pgy)}
          className="min-w-[70px]"
        >
          {pgy}
        </Button>
      ))}
    </div>
  );
};

interface ClinicSettingsProps {
  settings: SchedulerSettings["clinics"];
  onUpdate: (data: Partial<SchedulerSettings["clinics"]>) => void;
}

export function ClinicSettings({ settings, onUpdate }: ClinicSettingsProps) {
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>General Clinic Configuration</CardTitle>
          <CardDescription>
            Configure general clinic days and rules
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>General Clinic Days</Label>
            <p className="text-sm text-muted-foreground">
              Select which weekdays can have general clinic assignments
            </p>
            <div className="flex gap-2 flex-wrap">
              {[
                { day: 1, label: "Mon" },
                { day: 2, label: "Tue" },
                { day: 3, label: "Wed" },
                { day: 4, label: "Thu" },
                { day: 5, label: "Fri" }
              ].map(({ day, label }) => {
                const isSelected = settings.generalClinicDays.includes(day);
                
                return (
                  <Button
                    key={day}
                    variant={isSelected ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      const newDays = isSelected
                        ? settings.generalClinicDays.filter(d => d !== day)
                        : [...settings.generalClinicDays, day].sort();
                      
                      // Prevent deselecting all days
                      if (newDays.length === 0) {
                        return;
                      }
                      
                      onUpdate({ generalClinicDays: newDays });
                    }}
                    className="min-w-[60px]"
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
            {settings.generalClinicDays.length === 0 && (
              <p className="text-sm text-destructive">
                At least one clinic day must be selected
              </p>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="exclude-post">Exclude Post-Call Fellows</Label>
              <p className="text-sm text-muted-foreground">
                Fellows on post-call day cannot be assigned clinic
              </p>
            </div>
            <Switch
              id="exclude-post"
              checked={settings.excludePostCall}
              onCheckedChange={(checked) =>
                onUpdate({ excludePostCall: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="exclude-holidays">Exclude Holidays</Label>
              <p className="text-sm text-muted-foreground">
                No clinic assignments on holidays
              </p>
            </div>
            <Switch
              id="exclude-holidays"
              checked={settings.excludeHolidays}
              onCheckedChange={(checked) =>
                onUpdate({ excludeHolidays: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="skip-week">Skip Week with Special Clinic</Label>
              <p className="text-sm text-muted-foreground">
                Skip general clinic week if fellow has a special clinic
              </p>
            </div>
            <Switch
              id="skip-week"
              checked={settings.skipWeekWithSpecialClinic}
              onCheckedChange={(checked) =>
                onUpdate({ skipWeekWithSpecialClinic: checked })
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Special Clinics</CardTitle>
          <CardDescription>
            Configure specialized clinic days, weeks, rotations, and eligible PGYs
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          
          {/* Heart Failure Clinic */}
          <div className="space-y-4 pb-6 border-b">
            <h4 className="font-semibold text-lg">Heart Failure Clinic</h4>
            
            <div className="space-y-2">
              <Label className="text-sm font-medium">Day of Week</Label>
              <DayButtons
                selectedDay={settings.specialClinics.heartFailure.dayOfWeek}
                onChange={(day) => 
                  onUpdate({
                    specialClinics: {
                      ...settings.specialClinics,
                      heartFailure: { ...settings.specialClinics.heartFailure, dayOfWeek: day }
                    }
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Weeks of Month</Label>
              <WeekButtons
                selectedWeeks={settings.specialClinics.heartFailure.weekOfMonth}
                onChange={(weeks) =>
                  onUpdate({
                    specialClinics: {
                      ...settings.specialClinics,
                      heartFailure: { ...settings.specialClinics.heartFailure, weekOfMonth: weeks }
                    }
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Eligible Rotations</Label>
              <RotationButtons
                selectedRotations={settings.specialClinics.heartFailure.eligibleRotations}
                onChange={(rotations) =>
                  onUpdate({
                    specialClinics: {
                      ...settings.specialClinics,
                      heartFailure: { ...settings.specialClinics.heartFailure, eligibleRotations: rotations }
                    }
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Eligible PGY Levels</Label>
              <PGYButtons
                selectedPGYs={settings.specialClinics.heartFailure.eligiblePGYs}
                onChange={(pgys) =>
                  onUpdate({
                    specialClinics: {
                      ...settings.specialClinics,
                      heartFailure: { ...settings.specialClinics.heartFailure, eligiblePGYs: pgys }
                    }
                  })
                }
              />
            </div>
          </div>

          {/* ACHD Clinic */}
          <div className="space-y-4 pb-6 border-b">
            <h4 className="font-semibold text-lg">ACHD Clinic</h4>
            
            <div className="space-y-2">
              <Label className="text-sm font-medium">Day of Week</Label>
              <DayButtons
                selectedDay={settings.specialClinics.achd.dayOfWeek}
                onChange={(day) => 
                  onUpdate({
                    specialClinics: {
                      ...settings.specialClinics,
                      achd: { ...settings.specialClinics.achd, dayOfWeek: day }
                    }
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Weeks of Month</Label>
              <WeekButtons
                selectedWeeks={settings.specialClinics.achd.weekOfMonth}
                onChange={(weeks) =>
                  onUpdate({
                    specialClinics: {
                      ...settings.specialClinics,
                      achd: { ...settings.specialClinics.achd, weekOfMonth: weeks }
                    }
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Eligible Rotations</Label>
              <RotationButtons
                selectedRotations={settings.specialClinics.achd.eligibleRotations}
                onChange={(rotations) =>
                  onUpdate({
                    specialClinics: {
                      ...settings.specialClinics,
                      achd: { ...settings.specialClinics.achd, eligibleRotations: rotations }
                    }
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Eligible PGY Levels</Label>
              <PGYButtons
                selectedPGYs={settings.specialClinics.achd.eligiblePGYs}
                onChange={(pgys) =>
                  onUpdate({
                    specialClinics: {
                      ...settings.specialClinics,
                      achd: { ...settings.specialClinics.achd, eligiblePGYs: pgys }
                    }
                  })
                }
              />
            </div>
          </div>

          {/* Device Clinic */}
          <div className="space-y-4 pb-6 border-b">
            <h4 className="font-semibold text-lg">Device Clinic</h4>
            
            <div className="space-y-2">
              <Label className="text-sm font-medium">Day of Week</Label>
              <DayButtons
                selectedDay={settings.specialClinics.device.dayOfWeek}
                onChange={(day) => 
                  onUpdate({
                    specialClinics: {
                      ...settings.specialClinics,
                      device: { ...settings.specialClinics.device, dayOfWeek: day }
                    }
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Weeks of Month</Label>
              <WeekButtons
                selectedWeeks={settings.specialClinics.device.weekOfMonth}
                onChange={(weeks) =>
                  onUpdate({
                    specialClinics: {
                      ...settings.specialClinics,
                      device: { ...settings.specialClinics.device, weekOfMonth: weeks }
                    }
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Eligible Rotations</Label>
              <RotationButtons
                selectedRotations={settings.specialClinics.device.eligibleRotations}
                onChange={(rotations) =>
                  onUpdate({
                    specialClinics: {
                      ...settings.specialClinics,
                      device: { ...settings.specialClinics.device, eligibleRotations: rotations }
                    }
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Eligible PGY Levels</Label>
              <PGYButtons
                selectedPGYs={settings.specialClinics.device.eligiblePGYs}
                onChange={(pgys) =>
                  onUpdate({
                    specialClinics: {
                      ...settings.specialClinics,
                      device: { ...settings.specialClinics.device, eligiblePGYs: pgys }
                    }
                  })
                }
              />
            </div>
          </div>

          {/* EP Clinic */}
          <div className="space-y-4">
            <h4 className="font-semibold text-lg">EP Clinic</h4>
            
            <div className="space-y-2">
              <Label className="text-sm font-medium">Day of Week</Label>
              <DayButtons
                selectedDay={settings.specialClinics.ep.dayOfWeek}
                onChange={(day) => 
                  onUpdate({
                    specialClinics: {
                      ...settings.specialClinics,
                      ep: { ...settings.specialClinics.ep, dayOfWeek: day }
                    }
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Weeks of Month</Label>
              <p className="text-xs text-muted-foreground">
                EP Clinic typically runs on alternating weeks (1 and 3, or 2 and 4)
              </p>
              <WeekButtons
                selectedWeeks={settings.specialClinics.ep.weekOfMonth}
                onChange={(weeks) =>
                  onUpdate({
                    specialClinics: {
                      ...settings.specialClinics,
                      ep: { ...settings.specialClinics.ep, weekOfMonth: weeks }
                    }
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Eligible Rotations</Label>
              <RotationButtons
                selectedRotations={settings.specialClinics.ep.eligibleRotations}
                onChange={(rotations) =>
                  onUpdate({
                    specialClinics: {
                      ...settings.specialClinics,
                      ep: { ...settings.specialClinics.ep, eligibleRotations: rotations }
                    }
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Eligible PGY Levels</Label>
              <PGYButtons
                selectedPGYs={settings.specialClinics.ep.eligiblePGYs}
                onChange={(pgys) =>
                  onUpdate({
                    specialClinics: {
                      ...settings.specialClinics,
                      ep: { ...settings.specialClinics.ep, eligiblePGYs: pgys }
                    }
                  })
                }
              />
            </div>
          </div>

        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rotation Exclusions</CardTitle>
          <CardDescription>
            Rotations that exclude fellows from clinic assignments
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>General Clinic Exclusions</Label>
            <p className="text-sm text-muted-foreground">
              {settings.excludeRotations.general.join(", ")}
            </p>
          </div>

          <div className="space-y-2">
            <Label>Special Clinic Exclusions</Label>
            <p className="text-sm text-muted-foreground">
              {settings.excludeRotations.special.join(", ")}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
