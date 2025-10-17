import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SchedulerSettings } from "@/lib/settings-engine";

interface JeopardySettingsProps {
  settings: SchedulerSettings["jeopardyCall"];
  onUpdate: (data: Partial<SchedulerSettings["jeopardyCall"]>) => void;
}

export function JeopardySettings({ settings, onUpdate }: JeopardySettingsProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Jeopardy Quotas</CardTitle>
          <CardDescription>
            Configure weekday, weekend, and holiday jeopardy quotas by PGY level
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h4 className="font-medium mb-3">PGY-4</h4>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="pgy4-weekday">Weekday</Label>
                <Input
                  id="pgy4-weekday"
                  type="number"
                  min="0"
                  value={settings.quotas["PGY-4"].weekday}
                  onChange={(e) =>
                    onUpdate({
                      quotas: {
                        ...settings.quotas,
                        "PGY-4": { ...settings.quotas["PGY-4"], weekday: parseInt(e.target.value) },
                      },
                    })
                  }
                />
              </div>
              <div>
                <Label htmlFor="pgy4-weekend">Weekend</Label>
                <Input
                  id="pgy4-weekend"
                  type="number"
                  min="0"
                  value={settings.quotas["PGY-4"].weekend}
                  onChange={(e) =>
                    onUpdate({
                      quotas: {
                        ...settings.quotas,
                        "PGY-4": { ...settings.quotas["PGY-4"], weekend: parseInt(e.target.value) },
                      },
                    })
                  }
                />
              </div>
              <div>
                <Label htmlFor="pgy4-holiday">Holiday</Label>
                <Input
                  id="pgy4-holiday"
                  type="number"
                  min="0"
                  value={settings.quotas["PGY-4"].holiday}
                  onChange={(e) =>
                    onUpdate({
                      quotas: {
                        ...settings.quotas,
                        "PGY-4": { ...settings.quotas["PGY-4"], holiday: parseInt(e.target.value) },
                      },
                    })
                  }
                />
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-medium mb-3">PGY-5</h4>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="pgy5-weekday">Weekday</Label>
                <Input
                  id="pgy5-weekday"
                  type="number"
                  min="0"
                  value={settings.quotas["PGY-5"].weekday}
                  onChange={(e) =>
                    onUpdate({
                      quotas: {
                        ...settings.quotas,
                        "PGY-5": { ...settings.quotas["PGY-5"], weekday: parseInt(e.target.value) },
                      },
                    })
                  }
                />
              </div>
              <div>
                <Label htmlFor="pgy5-weekend">Weekend</Label>
                <Input
                  id="pgy5-weekend"
                  type="number"
                  min="0"
                  value={settings.quotas["PGY-5"].weekend}
                  onChange={(e) =>
                    onUpdate({
                      quotas: {
                        ...settings.quotas,
                        "PGY-5": { ...settings.quotas["PGY-5"], weekend: parseInt(e.target.value) },
                      },
                    })
                  }
                />
              </div>
              <div>
                <Label htmlFor="pgy5-holiday">Holiday</Label>
                <Input
                  id="pgy5-holiday"
                  type="number"
                  min="0"
                  value={settings.quotas["PGY-5"].holiday}
                  onChange={(e) =>
                    onUpdate({
                      quotas: {
                        ...settings.quotas,
                        "PGY-5": { ...settings.quotas["PGY-5"], holiday: parseInt(e.target.value) },
                      },
                    })
                  }
                />
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-medium mb-3">PGY-6</h4>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="pgy6-weekday">Weekday</Label>
                <Input
                  id="pgy6-weekday"
                  type="number"
                  min="0"
                  value={settings.quotas["PGY-6"].weekday}
                  onChange={(e) =>
                    onUpdate({
                      quotas: {
                        ...settings.quotas,
                        "PGY-6": { ...settings.quotas["PGY-6"], weekday: parseInt(e.target.value) },
                      },
                    })
                  }
                />
              </div>
              <div>
                <Label htmlFor="pgy6-weekend">Weekend</Label>
                <Input
                  id="pgy6-weekend"
                  type="number"
                  min="0"
                  value={settings.quotas["PGY-6"].weekend}
                  onChange={(e) =>
                    onUpdate({
                      quotas: {
                        ...settings.quotas,
                        "PGY-6": { ...settings.quotas["PGY-6"], weekend: parseInt(e.target.value) },
                      },
                    })
                  }
                />
              </div>
              <div>
                <Label htmlFor="pgy6-holiday">Holiday</Label>
                <Input
                  id="pgy6-holiday"
                  type="number"
                  min="0"
                  value={settings.quotas["PGY-6"].holiday}
                  onChange={(e) =>
                    onUpdate({
                      quotas: {
                        ...settings.quotas,
                        "PGY-6": { ...settings.quotas["PGY-6"], holiday: parseInt(e.target.value) },
                      },
                    })
                  }
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Jeopardy Rules</CardTitle>
          <CardDescription>
            Configure spacing, timing, and eligibility rules
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="jeopardySpacing">Minimum Spacing (days)</Label>
              <p className="text-sm text-muted-foreground">
                Minimum days between jeopardy assignments
              </p>
            </div>
            <Input
              id="jeopardySpacing"
              type="number"
              min="1"
              max="5"
              value={settings.minSpacingDays}
              onChange={(e) =>
                onUpdate({ minSpacingDays: parseInt(e.target.value) })
              }
              className="w-20"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="jeopardyStart">PGY-4 Start Date (MM-DD)</Label>
              <p className="text-sm text-muted-foreground">
                PGY-4 fellows start jeopardy after this date
              </p>
            </div>
            <Input
              id="jeopardyStart"
              type="text"
              placeholder="08-15"
              value={settings.pgy4StartDate}
              onChange={(e) => onUpdate({ pgy4StartDate: e.target.value })}
              className="w-24"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="noConsec">No Consecutive Days</Label>
              <p className="text-sm text-muted-foreground">
                Prevent jeopardy assignments on consecutive days
              </p>
            </div>
            <Switch
              id="noConsec"
              checked={settings.noConsecutiveDays}
              onCheckedChange={(checked) =>
                onUpdate({ noConsecutiveDays: checked })
              }
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
