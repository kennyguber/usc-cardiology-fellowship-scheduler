import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { SchedulerSettings } from "@/lib/settings-engine";

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
            Specialized clinic configurations
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <h4 className="font-medium">Heart Failure Clinic</h4>
            <p className="text-sm text-muted-foreground">
              Day: {dayNames[settings.specialClinics.heartFailure.dayOfWeek]}
              <br />
              Rotations: {settings.specialClinics.heartFailure.eligibleRotations.join(", ")}
              <br />
              PGYs: {settings.specialClinics.heartFailure.eligiblePGYs.join(", ")}
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-medium">ACHD Clinic</h4>
            <p className="text-sm text-muted-foreground">
              Day: {dayNames[settings.specialClinics.achd.dayOfWeek]}
              <br />
              Rotations: {settings.specialClinics.achd.eligibleRotations.join(", ")}
              <br />
              PGYs: {settings.specialClinics.achd.eligiblePGYs.join(", ")}
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-medium">Device Clinic</h4>
            <p className="text-sm text-muted-foreground">
              Day: {dayNames[settings.specialClinics.device.dayOfWeek]}
              <br />
              Rotations: {settings.specialClinics.device.eligibleRotations.join(", ")}
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-medium">EP Clinic</h4>
            <p className="text-sm text-muted-foreground">
              Day: {dayNames[settings.specialClinics.ep.dayOfWeek]}
              <br />
              Rotations: {settings.specialClinics.ep.eligibleRotations.join(", ")}
              <br />
              Weeks: {settings.specialClinics.ep.weekOfMonth.join(", ")}
            </p>
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
