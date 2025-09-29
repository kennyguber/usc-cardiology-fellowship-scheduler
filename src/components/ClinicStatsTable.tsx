import React from "react";
import { parseISO, addDays, isAfter, format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadClinicSchedule, type ClinicSchedule, type ClinicType } from "@/lib/clinic-engine";
import { loadSetup, type Fellow } from "@/lib/schedule-engine";
import { computeAcademicYearHolidays } from "@/lib/holidays";
import type { CallSchedule } from "@/lib/call-engine";

type Props = {
  fellows: Fellow[];
  callSchedule: CallSchedule | null;
};

type ClinicStats = {
  fellowId: string;
  fellowName: string;
  clinicDay: string;
  pgy: string;
  generalClinicCount: number;
  postCallExclusions: number;
  epClinicCount: number;
  achdClinicCount: number;
  hfClinicCount: number;
  cumulativeTotal: number;
};

// Helper functions
function toISODate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function july1ToJune30Window(yearStartISO: string): { start: Date; end: Date; days: Date[] } {
  const start = parseISO(yearStartISO);
  const end = addDays(new Date(start.getFullYear() + 1, 5, 30), 0); // June 30 of next year
  const days: Date[] = [];
  let cur = start;
  while (!isAfter(cur, end)) {
    days.push(cur);
    cur = addDays(cur, 1);
  }
  return { start, end, days };
}

function isHoliday(dateISO: string, setup: any): boolean {
  const holidays = setup.holidays?.length ? setup.holidays : computeAcademicYearHolidays(setup.yearStart);
  return holidays.some((h: any) => h.date === dateISO);
}

function isPostCallDay(fellowId: string, dateISO: string, callSchedule: CallSchedule | null): boolean {
  if (!callSchedule) return false;
  
  // Check if the previous day had this fellow on call
  const date = parseISO(dateISO);
  const prevDay = addDays(date, -1);
  const prevDayISO = toISODate(prevDay);
  
  return callSchedule.days[prevDayISO] === fellowId;
}

export default function ClinicStatsTable({ fellows, callSchedule }: Props) {
  const clinicSchedule = loadClinicSchedule();
  const setup = loadSetup();

  if (!clinicSchedule || !setup) {
    return <div className="text-muted-foreground">No clinic schedule found. Generate a clinic schedule to see statistics.</div>;
  }

  // Calculate statistics for each fellow
  const calculateStats = (): ClinicStats[] => {
    const stats: ClinicStats[] = [];

    for (const fellow of fellows) {
      const fellowId = fellow.id;
      const fellowName = fellow.name;
      const lastName = fellowName.split(' ').pop() || fellowName;
      const clinicDay = fellow.clinicDay || 'N/A';
      const pgy = fellow.pgy;

      // Get clinic assignment counts from clinic schedule
      const clinicCounts = clinicSchedule.countsByFellow[fellowId] || {} as Record<ClinicType, number>;
      const generalClinicCount = clinicCounts.GENERAL || 0;
      const epClinicCount = (clinicCounts.EP || 0) + (clinicCounts.DEVICE || 0);
      const achdClinicCount = clinicCounts.ACHD || 0;
      const hfClinicCount = clinicCounts.HEART_FAILURE || 0;

      // Calculate post-call exclusions
      let postCallExclusions = 0;
      if (fellow.clinicDay && callSchedule) {
        const dayOfWeekMap: Record<string, number> = {
          'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 
          'Thursday': 4, 'Friday': 5, 'Saturday': 6
        };
        const preferredDayOfWeek = dayOfWeekMap[fellow.clinicDay];

        if (preferredDayOfWeek !== undefined) {
          const { days } = july1ToJune30Window(clinicSchedule.yearStart);
          
          for (const date of days) {
            const dayOfWeek = date.getDay();
            const dateISO = date.toISOString().split('T')[0];
            
            // Check if this is the fellow's preferred clinic day
            if (dayOfWeek === preferredDayOfWeek && 
                !isHoliday(dateISO, setup) &&
                isPostCallDay(fellowId, dateISO, callSchedule)) {
              postCallExclusions++;
            }
          }
        }
      }

      const cumulativeTotal = generalClinicCount + epClinicCount + achdClinicCount + hfClinicCount;

      stats.push({
        fellowId,
        fellowName: lastName,
        clinicDay,
        pgy,
        generalClinicCount,
        postCallExclusions,
        epClinicCount,
        achdClinicCount,
        hfClinicCount,
        cumulativeTotal
      });
    }

    // Sort by PGY level, then by name
    return stats.sort((a, b) => {
      const pgyComparison = a.pgy.localeCompare(b.pgy);
      if (pgyComparison !== 0) return pgyComparison;
      return a.fellowName.localeCompare(b.fellowName);
    });
  };

  const stats = calculateStats();

  return (
    <div className="w-full">
      <div className="rounded-md border">
        <Table>
          <TableHeader className="sticky top-0 bg-background">
            <TableRow>
              <TableHead>Fellow</TableHead>
              <TableHead>PGY Level</TableHead>
              <TableHead>Total General Clinic Assignments</TableHead>
              <TableHead>Total Post-Call Exclusions</TableHead>
              <TableHead>Total EP Clinics</TableHead>
              <TableHead>Total ACHD Clinics</TableHead>
              <TableHead>Total HF Clinics</TableHead>
              <TableHead>Cumulative Tally</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.map((stat) => (
              <TableRow key={stat.fellowId}>
                <TableCell className="font-medium">
                  {stat.fellowName} ({stat.clinicDay})
                </TableCell>
                <TableCell>{stat.pgy}</TableCell>
                <TableCell>{stat.generalClinicCount}</TableCell>
                <TableCell>{stat.postCallExclusions}</TableCell>
                <TableCell>{stat.epClinicCount}</TableCell>
                <TableCell>{stat.achdClinicCount}</TableCell>
                <TableCell>{stat.hfClinicCount}</TableCell>
                <TableCell className="font-medium">{stat.cumulativeTotal}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}