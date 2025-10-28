import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SchedulerSettings } from "@/lib/settings-engine";
import { cn } from "@/lib/utils";

const ALL_ROTATIONS = [
  { value: "VAC", label: "Vacation" },
  { value: "LAC_CATH", label: "LAC Cath" },
  { value: "CCU", label: "CCU" },
  { value: "LAC_CONSULT", label: "LAC Consult" },
  { value: "HF", label: "Heart Failure" },
  { value: "KECK_CONSULT", label: "Keck Consult" },
  { value: "ECHO1", label: "Echo 1" },
  { value: "ECHO2", label: "Echo 2" },
  { value: "EP", label: "EP" },
  { value: "NUCLEAR", label: "Nuclear" },
  { value: "NONINVASIVE", label: "Non-Invasive" },
  { value: "ELECTIVE", label: "Elective" },
] as const;

const WEEKDAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
] as const;

interface PrimaryCallSettingsProps {
  settings: SchedulerSettings["primaryCall"];
  onUpdate: (data: Partial<SchedulerSettings["primaryCall"]>) => void;
}

export function PrimaryCallSettings({ settings, onUpdate }: PrimaryCallSettingsProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Call Quotas</CardTitle>
          <CardDescription>
            Maximum number of primary calls per fellow by PGY level
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="pgy4Max">PGY-4 Max Calls</Label>
            <Input
              id="pgy4Max"
              type="number"
              min="1"
              max="100"
              value={settings.maxCalls["PGY-4"]}
              onChange={(e) =>
                onUpdate({
                  maxCalls: { ...settings.maxCalls, "PGY-4": parseInt(e.target.value) },
                })
              }
              className="w-24"
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="pgy5Max">PGY-5 Max Calls</Label>
            <Input
              id="pgy5Max"
              type="number"
              min="1"
              max="100"
              value={settings.maxCalls["PGY-5"]}
              onChange={(e) =>
                onUpdate({
                  maxCalls: { ...settings.maxCalls, "PGY-5": parseInt(e.target.value) },
                })
              }
              className="w-24"
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="pgy6Max">PGY-6 Max Calls</Label>
            <Input
              id="pgy6Max"
              type="number"
              min="1"
              max="100"
              value={settings.maxCalls["PGY-6"]}
              onChange={(e) =>
                onUpdate({
                  maxCalls: { ...settings.maxCalls, "PGY-6": parseInt(e.target.value) },
                })
              }
              className="w-24"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Spacing & Timing Rules</CardTitle>
          <CardDescription>
            Configure call spacing and start dates
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="minSpacing">Minimum Spacing (days)</Label>
              <p className="text-sm text-muted-foreground">
                Minimum days between calls for the same fellow
              </p>
            </div>
            <Input
              id="minSpacing"
              type="number"
              min="2"
              max="7"
              value={settings.minSpacingDays}
              onChange={(e) =>
                onUpdate({ minSpacingDays: parseInt(e.target.value) })
              }
              className="w-20"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="pgy4Start">PGY-4 Start Date (MM-DD)</Label>
              <p className="text-sm text-muted-foreground">
                PGY-4 fellows start taking calls after this date
              </p>
            </div>
            <Input
              id="pgy4Start"
              type="text"
              placeholder="08-15"
              value={settings.pgy4StartDate}
              onChange={(e) => onUpdate({ pgy4StartDate: e.target.value })}
              className="w-24"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="noConsecSat">No Consecutive Saturdays</Label>
              <p className="text-sm text-muted-foreground">
                Prevent same fellow from taking consecutive Saturday calls
              </p>
            </div>
            <Switch
              id="noConsecSat"
              checked={settings.noConsecutiveSaturdays}
              onCheckedChange={(checked) =>
                onUpdate({ noConsecutiveSaturdays: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="noPGY6HolidayEves">No PGY-6 on Holiday Eves</Label>
              <p className="text-sm text-muted-foreground">
                Prevent PGY-6 fellows from taking Christmas Eve or New Year's Eve calls
              </p>
            </div>
            <Switch
              id="noPGY6HolidayEves"
              checked={settings.noPGY6OnHolidayEves}
              onCheckedChange={(checked) =>
                onUpdate({ noPGY6OnHolidayEves: checked })
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exclusion Rules</CardTitle>
          <CardDescription>
            Select rotations that exclude fellows from primary call duty
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <Label>Excluded Rotations</Label>
            <p className="text-sm text-muted-foreground">
              Fellows on these rotations will not be eligible for primary call
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {ALL_ROTATIONS.map((rotation) => {
                const isExcluded = settings.excludeRotations.includes(rotation.value);
                return (
                  <button
                    key={rotation.value}
                    type="button"
                    onClick={() => {
                      const newExcluded = isExcluded
                        ? settings.excludeRotations.filter((r) => r !== rotation.value)
                        : [...settings.excludeRotations, rotation.value];
                      onUpdate({ excludeRotations: newExcluded });
                    }}
                    className={cn(
                      "px-3 py-2 rounded-md text-sm font-medium transition-colors",
                      "border border-input hover:bg-accent hover:text-accent-foreground",
                      isExcluded && "bg-primary text-primary-foreground hover:bg-primary/90"
                    )}
                  >
                    {rotation.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-4 border-t space-y-3">
            <Label>EP Rotation Day Exclusions</Label>
            <p className="text-sm text-muted-foreground">
              Exclude EP rotation on specific weekdays (independent of EP exclusion above)
            </p>
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
              {WEEKDAYS.map((day) => {
                const isExcluded = settings.excludeEPOnDays.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => {
                      const newExcluded = isExcluded
                        ? settings.excludeEPOnDays.filter((d) => d !== day.value)
                        : [...settings.excludeEPOnDays, day.value];
                      onUpdate({ excludeEPOnDays: newExcluded });
                    }}
                    className={cn(
                      "px-2 py-2 rounded-md text-sm font-medium transition-colors",
                      "border border-input hover:bg-accent hover:text-accent-foreground",
                      isExcluded && "bg-primary text-primary-foreground hover:bg-primary/90"
                    )}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
