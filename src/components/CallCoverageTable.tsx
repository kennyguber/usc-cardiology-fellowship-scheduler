import { useMemo } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CallSchedule } from "@/lib/call-engine";
import type { Fellow } from "@/lib/schedule-engine";

export default function CallCoverageTable({ schedule, fellows }: { schedule: CallSchedule | null; fellows: Fellow[] }) {
  const fellowById = useMemo(() => Object.fromEntries(fellows.map((f) => [f.id, f] as const)), [fellows]);

  const rows = useMemo(() => {
    const entries = Object.entries(schedule?.countsByFellow ?? {});
    const allIds = new Set<string>([...fellows.map((f) => f.id), ...entries.map(([id]) => id)]);
    const list = Array.from(allIds).map((id) => ({
      id,
      n: schedule?.countsByFellow?.[id] ?? 0,
      name: fellowById[id]?.name ?? id,
      pgy: fellowById[id]?.pgy ?? "",
    }));
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [schedule, fellowById, fellows]);

  return (
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
            <TableRow key={r.id}>
              <TableCell>{r.name}</TableCell>
              <TableCell>{r.pgy}</TableCell>
              <TableCell className="text-right">{r.n}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
