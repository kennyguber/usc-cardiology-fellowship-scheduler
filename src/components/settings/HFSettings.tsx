import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SchedulerSettings } from "@/lib/settings-engine";

interface HFSettingsProps {
  settings: SchedulerSettings["hfCoverage"];
  onUpdate: (data: Partial<SchedulerSettings["hfCoverage"]>) => void;
}

export function HFSettings({ settings, onUpdate }: HFSettingsProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>HF Weekend Quotas</CardTitle>
          <CardDescription>
            Configure weekend coverage quotas by PGY level
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="hf-pgy4">PGY-4 Weekend Quota</Label>
            <Input
              id="hf-pgy4"
              type="number"
              min="0"
              value={settings.weekendQuotas["PGY-4"]}
              onChange={(e) =>
                onUpdate({
                  weekendQuotas: { ...settings.weekendQuotas, "PGY-4": parseInt(e.target.value) },
                })
              }
              className="w-24"
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="hf-pgy5">PGY-5 Weekend Quota</Label>
            <Input
              id="hf-pgy5"
              type="number"
              min="0"
              value={settings.weekendQuotas["PGY-5"]}
              onChange={(e) =>
                onUpdate({
                  weekendQuotas: { ...settings.weekendQuotas, "PGY-5": parseInt(e.target.value) },
                })
              }
              className="w-24"
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="hf-pgy6">PGY-6 Weekend Quota</Label>
            <Input
              id="hf-pgy6"
              type="number"
              min="0"
              value={settings.weekendQuotas["PGY-6"]}
              onChange={(e) =>
                onUpdate({
                  weekendQuotas: { ...settings.weekendQuotas, "PGY-6": parseInt(e.target.value) },
                })
              }
              className="w-24"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Eligibility Rules</CardTitle>
          <CardDescription>
            Configure rotation and timing restrictions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="pgy4-rotation">PGY-4 Only During HF Rotation</Label>
              <p className="text-sm text-muted-foreground">
                PGY-4 fellows can only do HF weekends during their HF rotation
              </p>
            </div>
            <Switch
              id="pgy4-rotation"
              checked={settings.pgy4OnlyDuringRotation}
              onCheckedChange={(checked) =>
                onUpdate({ pgy4OnlyDuringRotation: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="pgy6-rotation">PGY-6 Only During HF Rotation</Label>
              <p className="text-sm text-muted-foreground">
                PGY-6 fellows can only do HF weekends during their HF rotation
              </p>
            </div>
            <Switch
              id="pgy6-rotation"
              checked={settings.pgy6OnlyDuringRotation}
              onCheckedChange={(checked) =>
                onUpdate({ pgy6OnlyDuringRotation: checked })
              }
            />
          </div>

        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Spacing Rules</CardTitle>
          <CardDescription>
            Configure spacing between HF weekend assignments
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="hf-spacing">Minimum Spacing (days)</Label>
              <p className="text-sm text-muted-foreground">
                Minimum days between HF weekend assignments
              </p>
            </div>
            <Input
              id="hf-spacing"
              type="number"
              min="7"
              max="21"
              value={settings.minSpacingDays}
              onChange={(e) =>
                onUpdate({ minSpacingDays: parseInt(e.target.value) })
              }
              className="w-20"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="no-consec">No Consecutive Weekends (Hard Rule)</Label>
              <p className="text-sm text-muted-foreground">
                Prevent consecutive HF weekend assignments
              </p>
            </div>
            <Switch
              id="no-consec"
              checked={settings.noConsecutiveWeekends}
              onCheckedChange={(checked) =>
                onUpdate({ noConsecutiveWeekends: checked })
              }
            />
          </div>

        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mandatory Conflict Rules</CardTitle>
          <CardDescription>
            The following rules are always enforced and cannot be disabled
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>• Fellows on <strong>vacation</strong> cannot be assigned HF coverage</p>
          <p>• Fellows with <strong>primary call on Friday</strong> cannot work the following weekend</p>
          <p>• Fellows with <strong>primary call on weekend days</strong> cannot also work HF coverage</p>
        </CardContent>
      </Card>
    </div>
  );
}
