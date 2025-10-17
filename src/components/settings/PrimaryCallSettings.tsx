import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SchedulerSettings } from "@/lib/settings-engine";

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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exclusion Rules</CardTitle>
          <CardDescription>
            Rotations and conditions that exclude fellows from primary call
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Excluded Rotations</Label>
            <p className="text-sm text-muted-foreground">
              Current: {settings.excludeRotations.join(", ")}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
