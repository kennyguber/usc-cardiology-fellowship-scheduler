import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SchedulerSettings } from "@/lib/settings-engine";

interface AmbulatorySettingsProps {
  settings: SchedulerSettings["ambulatoryFellow"];
  onUpdate: (data: Partial<SchedulerSettings["ambulatoryFellow"]>) => void;
}

export function AmbulatorySettings({ settings, onUpdate }: AmbulatorySettingsProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Ambulatory Fellow Configuration</CardTitle>
          <CardDescription>
            Configure ambulatory fellow assignment rules
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="block-length">Block Length (weeks)</Label>
              <p className="text-sm text-muted-foreground">
                Duration of each ambulatory block assignment
              </p>
            </div>
            <Input
              id="block-length"
              type="number"
              min="1"
              max="4"
              value={settings.blockLengthWeeks}
              onChange={(e) =>
                onUpdate({ blockLengthWeeks: parseInt(e.target.value) })
              }
              className="w-20"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="max-assignments">Max Assignments Per Fellow</Label>
              <p className="text-sm text-muted-foreground">
                Maximum ambulatory blocks each fellow can be assigned
              </p>
            </div>
            <Input
              id="max-assignments"
              type="number"
              min="1"
              max="10"
              value={settings.maxAssignmentsPerFellow}
              onChange={(e) =>
                onUpdate({ maxAssignmentsPerFellow: parseInt(e.target.value) })
              }
              className="w-20"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="no-consec">No Consecutive Blocks</Label>
              <p className="text-sm text-muted-foreground">
                Prevent same fellow from having consecutive ambulatory blocks
              </p>
            </div>
            <Switch
              id="no-consec"
              checked={settings.noConsecutiveBlocks}
              onCheckedChange={(checked) =>
                onUpdate({ noConsecutiveBlocks: checked })
              }
            />
          </div>

          <div className="space-y-2">
            <Label>Eligible PGY Levels</Label>
            <p className="text-sm text-muted-foreground">
              {settings.eligiblePGYs.join(", ")}
            </p>
          </div>

          <div className="space-y-2">
            <Label>Rotation Priority (in order)</Label>
            <p className="text-sm text-muted-foreground">
              {settings.rotationPriority.join(" → ")}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
