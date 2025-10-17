import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SchedulerSettings } from "@/lib/settings-engine";

interface VacationSettingsProps {
  settings: SchedulerSettings["vacation"];
  onUpdate: (data: Partial<SchedulerSettings["vacation"]>) => void;
}

export function VacationSettings({ settings, onUpdate }: VacationSettingsProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>General Vacation Rules</CardTitle>
          <CardDescription>
            Configure vacation limits and spacing requirements
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="maxVacations">Max Vacations Per Year</Label>
                <p className="text-sm text-muted-foreground">
                  Maximum number of vacation blocks each fellow can take
                </p>
              </div>
              <Input
                id="maxVacations"
                type="number"
                min="1"
                max="4"
                value={settings.maxVacationsPerYear}
                onChange={(e) =>
                  onUpdate({ maxVacationsPerYear: parseInt(e.target.value) })
                }
                className="w-20"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="minSpacing">Minimum Spacing (blocks)</Label>
                <p className="text-sm text-muted-foreground">
                  Vacations must be at least this many blocks apart (1 block = 2 weeks)
                </p>
              </div>
              <Input
                id="minSpacing"
                type="number"
                min="3"
                max="12"
                value={settings.minSpacingBlocks}
                onChange={(e) =>
                  onUpdate({ minSpacingBlocks: parseInt(e.target.value) })
                }
                className="w-20"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="julyRestriction">No July Vacations</Label>
                <p className="text-sm text-muted-foreground">
                  Prevent any fellow from taking vacation in July
                </p>
              </div>
              <Switch
                id="julyRestriction"
                checked={settings.julyRestriction}
                onCheckedChange={(checked) =>
                  onUpdate({ julyRestriction: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="pgy4August">No PGY-4 August Vacations</Label>
                <p className="text-sm text-muted-foreground">
                  Prevent PGY-4 fellows from taking vacation in August
                </p>
              </div>
              <Switch
                id="pgy4August"
                checked={settings.pgy4AugustRestriction}
                onCheckedChange={(checked) =>
                  onUpdate({ pgy4AugustRestriction: checked })
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Block Capacity Limits</CardTitle>
          <CardDescription>
            Control how many fellows can be on vacation simultaneously
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="maxPerBlock">Max Fellows Per Block (Same PGY)</Label>
                <p className="text-sm text-muted-foreground">
                  Maximum fellows from the same PGY level on vacation in one block
                </p>
              </div>
              <Input
                id="maxPerBlock"
                type="number"
                min="1"
                max="5"
                value={settings.maxFellowsPerBlock}
                onChange={(e) =>
                  onUpdate({ maxFellowsPerBlock: parseInt(e.target.value) })
                }
                className="w-20"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="maxTotal">Max Total Per Block (All PGYs)</Label>
                <p className="text-sm text-muted-foreground">
                  Maximum total fellows on vacation across all PGY levels
                </p>
              </div>
              <Input
                id="maxTotal"
                type="number"
                min="1"
                max="10"
                value={settings.maxTotalPerBlock}
                onChange={(e) =>
                  onUpdate({ maxTotalPerBlock: parseInt(e.target.value) })
                }
                className="w-20"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
