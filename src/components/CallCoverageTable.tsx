import { useMemo } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle } from "lucide-react";
import type { CallSchedule } from "@/lib/call-engine";
import type { Fellow } from "@/lib/schedule-engine";
import { auditCallSchedule } from "@/lib/call-engine";
import { loadSettings } from "@/lib/settings-engine";

export default function CallCoverageTable({ schedule, fellows }: { schedule: CallSchedule | null; fellows: Fellow[] }) {
  const fellowById = useMemo(() => Object.fromEntries(fellows.map((f) => [f.id, f] as const)), [fellows]);
  const settings = loadSettings();

  const { rows, audit } = useMemo(() => {
    const auditResult = auditCallSchedule(schedule);
    const auditByFellow = Object.fromEntries(
      auditResult.fellows.map((f) => [f.id, f])
    );

    const entries = Object.entries(schedule?.countsByFellow ?? {});
    const allIds = new Set<string>([...fellows.map((f) => f.id), ...entries.map(([id]) => id)]);
    const list = Array.from(allIds).map((id) => {
      const fellow = fellowById[id];
      const auditData = auditByFellow[id];
      const actualCalls = auditData?.actualCalls ?? 0;
      const maxCalls = fellow ? settings.primaryCall.maxCalls[fellow.pgy] : 0;
      
      return {
        id,
        n: actualCalls,
        maxCalls,
        exceedsLimit: actualCalls > maxCalls,
        name: fellowById[id]?.name ?? id,
        pgy: fellowById[id]?.pgy ?? "",
      };
    });
    return { 
      rows: list.sort((a, b) => a.name.localeCompare(b.name)),
      audit: auditResult,
    };
  }, [schedule, fellowById, fellows, settings]);

  return (
    <div className="space-y-2">
      {audit.totalViolations > 0 && (
        <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-md border border-destructive/20">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm font-medium">
            Warning: {audit.totalViolations} fellow{audit.totalViolations !== 1 ? 's' : ''} exceed{audit.totalViolations === 1 ? 's' : ''} call limits
          </span>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fellow</TableHead>
            <TableHead>PGY</TableHead>
            <TableHead className="text-right">Calls</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-muted-foreground">
                No schedule generated yet.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow key={r.id} className={r.exceedsLimit ? "bg-destructive/5" : ""}>
                <TableCell>{r.name}</TableCell>
                <TableCell>{r.pgy}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <span className={r.exceedsLimit ? "text-destructive font-semibold" : ""}>
                      {r.n}/{r.maxCalls}
                    </span>
                    {r.exceedsLimit && (
                      <AlertCircle className="h-4 w-4 text-destructive" />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
