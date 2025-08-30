import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { loadHFSchedule, analyzeHFSchedule, buildHFSchedule, saveHFSchedule } from "@/lib/hf-engine";
import { loadSetup } from "@/lib/schedule-engine";
import { useToast } from "@/hooks/use-toast";
import type { Fellow } from "@/lib/schedule-engine";

interface Props {
  fellows: Fellow[];
}

export default function HFCoverageStatsTable({ fellows }: Props) {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const setup = loadSetup();
  const [hfSchedule, setHfSchedule] = useState(() => loadHFSchedule());

  const stats = useMemo(() => {
    if (!hfSchedule || !setup) return [];

    const analysis = analyzeHFSchedule(hfSchedule, fellows, setup);
    
    const rows: Array<{
      fellow: Fellow;
      nonHolidayWeekends: number;
      holidayDays: number;
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

  const handleGenerateHF = async () => {
    if (!setup) {
      toast({
        title: "Error",
        description: "Setup data not found. Please configure settings first.",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    
    try {
      const result = buildHFSchedule({ 
        randomize: true, 
        attempts: 3,
        seed: Date.now() 
      });
      
      if (result.success) {
        saveHFSchedule(result.schedule);
        setHfSchedule(result.schedule);
        toast({
          title: "HF Schedule Generated",
          description: `Successfully assigned ${Object.keys(result.schedule.weekends).length} non-holiday weekends. ${result.uncoveredHolidays.length} holiday blocks need manual assignment.`,
        });
      } else {
        saveHFSchedule(result.schedule);
        setHfSchedule(result.schedule);
        const issues = [
          ...(result.uncovered.length > 0 ? [`${result.uncovered.length} non-holiday weekends uncovered`] : []),
          ...(result.mandatoryMissed.length > 0 ? [`${result.mandatoryMissed.length} mandatory assignments missed`] : [])
        ];
        toast({
          title: "HF Schedule Generated with Issues",
          description: `Partial success: ${issues.join(", ")}. Holiday blocks (${result.uncoveredHolidays.length}) need manual assignment.`,
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Generation Failed",
        description: "Failed to generate HF schedule. Please try again.",
        variant: "destructive",
      });
    }
    
    setIsGenerating(false);
  };

  if (!hfSchedule) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-medium">HF Coverage Statistics</h3>
          <Button 
            onClick={handleGenerateHF} 
            disabled={isGenerating}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isGenerating ? "Generating..." : "Generate HF"}
          </Button>
        </div>
        <div className="text-center text-muted-foreground py-8">
          No HF schedule found. Click "Generate HF" to create non-holiday weekend assignments.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">HF Coverage Statistics</h3>
        <Button 
          onClick={handleGenerateHF} 
          disabled={isGenerating}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {isGenerating ? "Regenerating..." : "Generate HF"}
        </Button>
      </div>
      <div className="relative">
      <Table>
        <TableHeader className="sticky top-0 bg-background/95 backdrop-blur-sm">
          <TableRow>
            <TableHead className="font-medium">Fellow</TableHead>
            <TableHead className="font-medium">PGY</TableHead>
            <TableHead className="font-medium">HF Non-Holiday Weekends</TableHead>
            <TableHead className="font-medium">HF Holidays (Total Days Covered)</TableHead>
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
    </div>
  );
}