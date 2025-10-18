import { SchedulerSettings } from "@/lib/settings-engine";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface BlockRotationSettingsProps {
  settings: SchedulerSettings["blockRotations"];
}

export function BlockRotationSettings({ settings }: BlockRotationSettingsProps) {
  const rotationLabels: Record<string, string> = {
    lacCathBlocks: "LAC Cath",
    ccuBlocks: "CCU",
    lacConsultBlocks: "LAC Consult",
    hfBlocks: "HF",
    keckConsultBlocks: "Keck Consult",
    echo1Blocks: "ECHO1",
    echo2Blocks: "ECHO2",
    epBlocks: "EP",
    nuclearBlocks: "Nuclear",
    nonInvasiveBlocks: "Noninvasive",
    electiveBlocks: "Elective",
  };

  const calculateTotal = (pgySettings: any) => {
    return (
      pgySettings.lacCathBlocks +
      pgySettings.ccuBlocks +
      pgySettings.lacConsultBlocks +
      pgySettings.hfBlocks +
      pgySettings.keckConsultBlocks +
      pgySettings.echo1Blocks +
      pgySettings.echo2Blocks +
      pgySettings.epBlocks +
      pgySettings.nuclearBlocks +
      (pgySettings.nonInvasiveBlocks || 0) +
      pgySettings.electiveBlocks
    );
  };

  const rotations = Object.keys(rotationLabels);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Block Rotation Requirements</CardTitle>
        <CardDescription>
          Number of blocks assigned to each rotation per PGY year (excludes 2 vacation blocks)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rotation</TableHead>
              <TableHead className="text-center">PGY-4</TableHead>
              <TableHead className="text-center">PGY-5</TableHead>
              <TableHead className="text-center">PGY-6</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rotations.map((rotation) => (
              <TableRow key={rotation}>
                <TableCell className="font-medium">{rotationLabels[rotation]}</TableCell>
                <TableCell className="text-center">{settings.pgy4[rotation as keyof typeof settings.pgy4]}</TableCell>
                <TableCell className="text-center">{settings.pgy5[rotation as keyof typeof settings.pgy5]}</TableCell>
                <TableCell className="text-center">{settings.pgy6[rotation as keyof typeof settings.pgy6]}</TableCell>
              </TableRow>
            ))}
            <TableRow className="font-bold bg-muted/50">
              <TableCell>Total Rotation Blocks</TableCell>
              <TableCell className="text-center">{calculateTotal(settings.pgy4)}</TableCell>
              <TableCell className="text-center">{calculateTotal(settings.pgy5)}</TableCell>
              <TableCell className="text-center">{calculateTotal(settings.pgy6)}</TableCell>
            </TableRow>
            <TableRow className="font-bold">
              <TableCell>Vacation Blocks</TableCell>
              <TableCell className="text-center">2</TableCell>
              <TableCell className="text-center">2</TableCell>
              <TableCell className="text-center">2</TableCell>
            </TableRow>
            <TableRow className="font-bold bg-primary/10">
              <TableCell>Total Blocks</TableCell>
              <TableCell className="text-center">{calculateTotal(settings.pgy4) + 2}</TableCell>
              <TableCell className="text-center">{calculateTotal(settings.pgy5) + 2}</TableCell>
              <TableCell className="text-center">{calculateTotal(settings.pgy6) + 2}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <div className="mt-4 text-sm text-muted-foreground space-y-1">
          <p className="font-semibold">* PGY-5 Special Rules:</p>
          <ul className="list-disc list-inside ml-2 space-y-1">
            <li>CCU: Only 4 of 5 fellows receive 1 block each</li>
            <li>LAC Consult: Only 4 of 5 fellows receive 1 block (the non-CCU fellow + 3 CCU fellows)</li>
            <li>Elective: Variable (3-4 blocks) depending on CCU/LAC Consult assignment</li>
          </ul>
          
          <p className="font-semibold mt-3">* PGY-6 Special Rules:</p>
          <ul className="list-disc list-inside ml-2 space-y-1">
            <li>CCU, LAC Consult, ECHO1: PGY-6 fellows do not perform these rotations</li>
            <li>LAC Cath: Variable distribution [2,2,2,1,1] blocks per fellow</li>
            <li>HF & Keck Consult: 4 of 5 fellows receive 1 block each</li>
            <li>ECHO2: Variable distribution [2,2,2,2,1] blocks per fellow</li>
            <li>Nuclear & Noninvasive: Variable distribution [3,3,3,3,2] blocks per fellow each</li>
            <li>EP: All 5 fellows receive 2 blocks each</li>
            <li>Elective: Fills all remaining blocks (~8 blocks per fellow on average)</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
