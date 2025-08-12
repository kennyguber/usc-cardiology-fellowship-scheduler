import React from "react";
import type { CallSchedule } from "@/lib/call-engine";
import { computeAcademicYearHolidays } from "@/lib/holidays";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Minimal Fellow type for our needs
type Fellow = { id: string; name: string; pgy: any };

type Props = {
  fellows: Fellow[];
  schedule: CallSchedule | null;
};

function daysBetween(a: Date, b: Date) {
  const ms = a.getTime() - b.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export default function PrimaryCallStatsTable({ fellows, schedule }: Props) {
  if (!schedule) {
    return <div className="text-muted-foreground">No call schedule found. Generate a schedule to see statistics.</div>;
  }

  const fellowById = Object.fromEntries(fellows.map((f) => [f.id, f] as const));

  const holidays = computeAcademicYearHolidays(schedule.yearStart);
  const holidaySet = new Set(holidays.map((h) => h.date));

  const order = ["M", "T", "W", "Th", "F", "Sa", "Su"] as const;

  type Acc = {
    id: string;
    name: string;
    pgy: any;
    total: number;
    weekday: number;
    weekend: number;
    holiday: number;
    dow: Record<(typeof order)[number], number>;
    dates: string[]; // ISO dates of calls
  };

  const byFellow: Record<string, Acc> = {};

  for (const [iso, fid] of Object.entries(schedule.days)) {
    if (!fid) continue;
    const fellow = fellowById[fid];
    if (!fellow) continue;

    const acc = (byFellow[fid] ||= {
      id: fid,
      name: fellow.name,
      pgy: fellow.pgy,
      total: 0,
      weekday: 0,
      weekend: 0,
      holiday: 0,
      dow: { M: 0, T: 0, W: 0, Th: 0, F: 0, Sa: 0, Su: 0 },
      dates: [],
    });

    acc.total += 1;
    acc.dates.push(iso);

    const d = new Date(iso + "T00:00:00Z"); // force UTC to avoid TZ shifts
    const dow = d.getUTCDay(); // 0=Sun ... 6=Sat in UTC
    const isHoliday = holidaySet.has(iso);

    // Weekday distribution (always count toward day of week)
    const label =
      dow === 0 ? "Su" :
      dow === 1 ? "M" :
      dow === 2 ? "T" :
      dow === 3 ? "W" :
      dow === 4 ? "Th" :
      dow === 5 ? "F" : "Sa";
    acc.dow[label as typeof order[number]] += 1;

    // Mutually exclusive buckets for Weekday/Weekend/Holiday
    if (isHoliday) acc.holiday += 1;
    else if (dow === 0 || dow === 6) acc.weekend += 1;
    else acc.weekday += 1;
  }

  type Row = Acc & {
    avgGap: number | null;
    longestGap: number | null;
    longestGapDates: { start: string; end: string } | null;
  };

  const rows: Row[] = Object.values(byFellow).map((acc) => {
    const sorted = [...acc.dates].sort();
    const gaps: number[] = [];
    let longest: number | null = null;
    let longestPair: { start: string; end: string } | null = null;
    for (let i = 1; i < sorted.length; i++) {
      const gap = daysBetween(new Date(sorted[i]), new Date(sorted[i - 1]));
      gaps.push(gap);
      if (longest === null || gap > longest) {
        longest = gap;
        longestPair = { start: sorted[i - 1], end: sorted[i] };
      }
    }
    const avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
    return { ...acc, avgGap: avg, longestGap: longest, longestGapDates: longestPair };
  });

  // Include fellows with zero calls as well
  for (const f of fellows) {
    if (!byFellow[f.id]) {
      rows.push({
        id: f.id,
        name: f.name,
        pgy: f.pgy,
        total: 0,
        weekday: 0,
        weekend: 0,
        holiday: 0,
        dow: { M: 0, T: 0, W: 0, Th: 0, F: 0, Sa: 0, Su: 0 },
        dates: [],
        avgGap: null,
        longestGap: null,
        longestGapDates: null,
      });
    }
  }

  const pgyOrder = (p: any) => {
    if (typeof p === "number") return p;
    const m = String(p).match(/(\d+)/);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  };
  rows.sort((a, b) => {
    const ap = pgyOrder(a.pgy);
    const bp = pgyOrder(b.pgy);
    if (ap !== bp) return ap - bp;
    return a.name.localeCompare(b.name);
  });

  const fmtDist = (r: Row) =>
    `M: ${r.dow.M}; T: ${r.dow.T}; W: ${r.dow.W}; Th: ${r.dow.Th}; F: ${r.dow.F}; Sa: ${r.dow.Sa}; Su: ${r.dow.Su}`;

  return (
    <div className="w-full overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky top-0 z-10 bg-background">Fellow</TableHead>
            <TableHead className="sticky top-0 z-10 bg-background">PGY</TableHead>
            <TableHead className="sticky top-0 z-10 bg-background text-right">Total Calls</TableHead>
            <TableHead className="sticky top-0 z-10 bg-background text-right">Weekday Calls</TableHead>
            <TableHead className="sticky top-0 z-10 bg-background">Weekday Distribution</TableHead>
            <TableHead className="sticky top-0 z-10 bg-background text-right">Weekend Calls</TableHead>
            <TableHead className="sticky top-0 z-10 bg-background text-right">Holiday Calls</TableHead>
            <TableHead className="sticky top-0 z-10 bg-background text-right">Average Days Between Call</TableHead>
            <TableHead className="sticky top-0 z-10 bg-background text-right">Longest Gap Between Call</TableHead>
            <TableHead className="sticky top-0 z-10 bg-background">Longest Call Gap Dates</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{r.name}</TableCell>
              <TableCell>{String(r.pgy)}</TableCell>
              <TableCell className="text-right tabular-nums">{r.total}</TableCell>
              <TableCell className="text-right tabular-nums">{r.weekday}</TableCell>
              <TableCell>{fmtDist(r)}</TableCell>
              <TableCell className="text-right tabular-nums">{r.weekend}</TableCell>
              <TableCell className="text-right tabular-nums">{r.holiday}</TableCell>
              <TableCell className="text-right tabular-nums">{r.avgGap == null ? "—" : r.avgGap.toFixed(1)}</TableCell>
              <TableCell className="text-right tabular-nums">{r.longestGap == null ? "—" : r.longestGap}</TableCell>
              <TableCell>
                {r.longestGapDates ? `${r.longestGapDates.start} to ${r.longestGapDates.end}` : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
