import { useMemo } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadHFSchedule } from "@/lib/hf-engine";
import { loadSetup } from "@/lib/schedule-engine";
import { computeAcademicYearHolidays } from "@/lib/holidays";
import type { Fellow } from "@/lib/schedule-engine";

interface Props {
  fellows: Fellow[];
}

export default function HFCoverageStatsTable({ fellows }: Props) {
  const setup = loadSetup();
  const hfSchedule = loadHFSchedule();

  const stats = useMemo(() => {
    if (!hfSchedule || !setup) return [];

    const fellowById = Object.fromEntries(fellows.map(f => [f.id, f]));
    const holidays = setup.holidays?.length ? setup.holidays : computeAcademicYearHolidays(setup.yearStart);
    const holidayDates = new Set(holidays.map(h => h.date));

    const rows: Array<{
      fellow: Fellow;
      nonHolidayWeekends: number;
      holidayDays: number;
      avgGap: number | null;
      shortestGap: number | null;
    }> = [];

    // Process each fellow
    fellows.forEach(fellow => {
      const weekendAssignments: string[] = [];
      let holidayDaysCount = 0;

      // Collect weekend assignments
      Object.entries(hfSchedule.weekends).forEach(([dateISO, fellowId]) => {
        if (fellowId === fellow.id) {
          weekendAssignments.push(dateISO);
        }
      });

      // Collect holiday assignments and count days
      Object.entries(hfSchedule.holidays).forEach(([, fellowAndDates]) => {
        if (Array.isArray(fellowAndDates) && fellowAndDates.length > 0) {
          const [fellowId, ...dates] = fellowAndDates;
          if (fellowId === fellow.id) {
            holidayDaysCount += dates.length;
          }
        }
      });

      // Separate holiday weekends from non-holiday weekends
      const nonHolidayWeekends = weekendAssignments.filter(dateISO => 
        !holidayDates.has(dateISO)
      );

      // Calculate gaps between all weekend coverages (holiday or non-holiday)
      const allWeekendDates = weekendAssignments.map(dateISO => new Date(dateISO)).sort((a, b) => a.getTime() - b.getTime());
      
      let avgGap: number | null = null;
      let shortestGap: number | null = null;

      if (allWeekendDates.length > 1) {
        const gaps: number[] = [];
        for (let i = 1; i < allWeekendDates.length; i++) {
          const gap = Math.floor((allWeekendDates[i].getTime() - allWeekendDates[i-1].getTime()) / (1000 * 60 * 60 * 24));
          gaps.push(gap);
        }
        
        if (gaps.length > 0) {
          avgGap = Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length);
          shortestGap = Math.min(...gaps);
        }
      }

      rows.push({
        fellow,
        nonHolidayWeekends: nonHolidayWeekends.length,
        holidayDays: holidayDaysCount,
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