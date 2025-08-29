import { useMemo } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadHFSchedule, analyzeHFSchedule } from "@/lib/hf-engine";
import { loadSetup } from "@/lib/schedule-engine";
import type { Fellow } from "@/lib/schedule-engine";

interface Props {
  fellows: Fellow[];
}

export default function HFCoverageStatsTable({ fellows }: Props) {
  const setup = loadSetup();
  const hfSchedule = loadHFSchedule();

  const stats = useMemo(() => {
    if (!hfSchedule || !setup) return [];

    const analysis = analyzeHFSchedule(hfSchedule, fellows, setup);
    
    const rows: Array<{
      fellow: Fellow;
      nonHolidayWeekends: number;
      holidayDays: number;
      effectiveWeekends: number;
      avgGap: number | null;
      shortestGap: number | null;
    }> = [];

    // Process each fellow
    fellows.forEach(fellow => {
      const fellowStats = analysis.fellowStats[fellow.id];
      if (!fellowStats) return;

      // For gap calculation, we need to find all weekend assignments in chronological order
      const weekendAssignments: Date[] = [];
      
      // Collect all weekend dates where this fellow has any coverage
      const start = new Date(setup.yearStart);
      const end = new Date(start.getFullYear() + 1, 5, 30);
      let current = start;
      
      while (current <= end) {
        const currentISO = current.toISOString().split('T')[0];
        const assignedFellowId = hfSchedule.dayOverrides?.[currentISO] !== undefined 
          ? hfSchedule.dayOverrides[currentISO]
          : (current.getDay() === 0 || current.getDay() === 6) 
            ? (() => {
                const weekendStart = current.getDay() === 6 ? current : new Date(current.getTime() - 24 * 60 * 60 * 1000);
                const weekendStartISO = weekendStart.toISOString().split('T')[0];
                return hfSchedule.weekends[weekendStartISO] || 
                       Object.entries(hfSchedule.holidays).find(([, fellowAndDates]) => 
                         Array.isArray(fellowAndDates) && fellowAndDates.includes(currentISO)
                       )?.[1]?.[0] || null;
              })()
            : Object.entries(hfSchedule.holidays).find(([, fellowAndDates]) => 
                Array.isArray(fellowAndDates) && fellowAndDates.includes(currentISO)
              )?.[1]?.[0] || null;
        
        if (assignedFellowId === fellow.id && (current.getDay() === 0 || current.getDay() === 6)) {
          const weekendStart = current.getDay() === 6 ? new Date(current) : new Date(current.getTime() - 24 * 60 * 60 * 1000);
          if (!weekendAssignments.find(w => w.getTime() === weekendStart.getTime())) {
            weekendAssignments.push(weekendStart);
          }
        }
        
        current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
      }
      
      weekendAssignments.sort((a, b) => a.getTime() - b.getTime());
      
      let avgGap: number | null = null;
      let shortestGap: number | null = null;

      if (weekendAssignments.length > 1) {
        const gaps: number[] = [];
        for (let i = 1; i < weekendAssignments.length; i++) {
          const gap = Math.floor((weekendAssignments[i].getTime() - weekendAssignments[i-1].getTime()) / (1000 * 60 * 60 * 24));
          gaps.push(gap);
        }
        
        if (gaps.length > 0) {
          avgGap = Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length);
          shortestGap = Math.min(...gaps);
        }
      }

      rows.push({
        fellow,
        nonHolidayWeekends: fellowStats.weekendCount,
        holidayDays: fellowStats.holidayDayCount,
        effectiveWeekends: fellowStats.effectiveWeekendCount,
        avgGap,
        shortestGap
      });
    });

    // Sort by PGY then by name
    return rows.sort((a, b) => {
      if (a.fellow.pgy !== b.fellow.pgy) {
        return a.fellow.pgy.localeCompare(b.fellow.pgy);
      }
      return a.fellow.name.localeCompare(b.fellow.name);
    });
  }, [fellows, hfSchedule, setup]);

  if (!hfSchedule) {
    return (
      <div className="text-center text-muted-foreground py-8">
        No HF schedule found. Please generate an HF schedule first.
      </div>
    );
  }

  return (
    <div className="relative">
      <Table>
        <TableHeader className="sticky top-0 bg-background/95 backdrop-blur-sm">
          <TableRow>
            <TableHead className="font-medium">Fellow</TableHead>
            <TableHead className="font-medium">PGY</TableHead>
            <TableHead className="font-medium">HF Non-Holiday Weekends</TableHead>
            <TableHead className="font-medium">HF Effective Weekends</TableHead>
            <TableHead className="font-medium">HF Holidays/Holiday Weekends</TableHead>
            <TableHead className="font-medium">Average Gap Between HF Weekends</TableHead>
            <TableHead className="font-medium">Shortest Gap Between HF Weekends</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stats.map((row) => (
            <TableRow key={row.fellow.id}>
              <TableCell className="font-medium">{row.fellow.name}</TableCell>
              <TableCell>{row.fellow.pgy}</TableCell>
              <TableCell>{row.nonHolidayWeekends}</TableCell>
              <TableCell>{row.effectiveWeekends === Math.floor(row.effectiveWeekends) ? row.effectiveWeekends : row.effectiveWeekends.toFixed(1)}</TableCell>
              <TableCell>{row.holidayDays}</TableCell>
              <TableCell>{row.avgGap !== null ? `${row.avgGap} days` : "N/A"}</TableCell>
              <TableCell>{row.shortestGap !== null ? `${row.shortestGap} days` : "N/A"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}