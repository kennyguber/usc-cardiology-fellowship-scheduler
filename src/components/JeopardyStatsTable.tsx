import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { loadJeopardySchedule, buildJeopardySchedule, saveJeopardySchedule } from "@/lib/jeopardy-engine";
import { loadSetup } from "@/lib/schedule-engine";
import { useToast } from "@/hooks/use-toast";
import type { Fellow } from "@/lib/schedule-engine";

interface Props {
  fellows: Fellow[];
}

export default function JeopardyStatsTable({ fellows }: Props) {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const setup = loadSetup();
  const [jeopardySchedule, setJeopardySchedule] = useState(() => loadJeopardySchedule());

  const stats = useMemo(() => {
    if (!jeopardySchedule || !setup) return [];

    const rows: Array<{
      fellow: Fellow;
      total: number;
      weekday: number;
      weekend: number;
      holiday: number;
    }> = [];

    // Process each fellow
    fellows.forEach(fellow => {
      const weekdayCount = jeopardySchedule.weekdayCountsByFellow[fellow.id] || 0;
      const weekendCount = jeopardySchedule.weekendCountsByFellow[fellow.id] || 0;
      const holidayCount = jeopardySchedule.holidayCountsByFellow[fellow.id] || 0;
      const total = weekdayCount + weekendCount + holidayCount;

      rows.push({
        fellow,
        total,
        weekday: weekdayCount,
        weekend: weekendCount,
        holiday: holidayCount
      });
    });

    // Sort by PGY then by name
    return rows.sort((a, b) => {
      if (a.fellow.pgy !== b.fellow.pgy) {
        return a.fellow.pgy.localeCompare(b.fellow.pgy);
      }
      return a.fellow.name.localeCompare(b.fellow.name);
    });
  }, [fellows, jeopardySchedule, setup]);

  const handleGenerateJeopardy = async () => {
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
      const result = buildJeopardySchedule();
      
      if (result.success) {
        saveJeopardySchedule(result.schedule);
        setJeopardySchedule(result.schedule);
        toast({
          title: "Jeopardy Schedule Generated",
          description: `Successfully assigned jeopardy duties. ${result.uncovered.length} days need manual assignment.`,
        });
      } else {
        saveJeopardySchedule(result.schedule);
        setJeopardySchedule(result.schedule);
        toast({
          title: "Jeopardy Schedule Generated with Issues",
          description: `Partial success: ${result.uncovered.length} days uncovered. Some manual assignment may be needed.`,
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Generation Failed",
        description: "Failed to generate Jeopardy schedule. Please try again.",
        variant: "destructive",
      });
    }
    
    setIsGenerating(false);
  };

  if (!jeopardySchedule) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-medium">Jeopardy Statistics</h3>
          <Button 
            onClick={handleGenerateJeopardy} 
            disabled={isGenerating}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isGenerating ? "Generating..." : "Generate Jeopardy"}
          </Button>
        </div>
        <div className="text-center text-muted-foreground py-8">
          No Jeopardy schedule found. Click "Generate Jeopardy" to create assignments.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Jeopardy Statistics</h3>
        <Button 
          onClick={handleGenerateJeopardy} 
          disabled={isGenerating}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {isGenerating ? "Regenerating..." : "Generate Jeopardy"}
        </Button>
      </div>
      <div className="relative">
        <Table>
          <TableHeader className="sticky top-0 bg-background/95 backdrop-blur-sm">
            <TableRow>
              <TableHead className="font-medium">Fellow</TableHead>
              <TableHead className="font-medium">PGY</TableHead>
              <TableHead className="font-medium">Total Jeopardy Assignments</TableHead>
              <TableHead className="font-medium">Weekday Jeopardy Assignments</TableHead>
              <TableHead className="font-medium">Weekend Jeopardy Assignments</TableHead>
              <TableHead className="font-medium">Holiday Jeopardy Assignments</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.map((row) => (
              <TableRow key={row.fellow.id}>
                <TableCell className="font-medium">{row.fellow.name}</TableCell>
                <TableCell>{row.fellow.pgy}</TableCell>
                <TableCell>{row.total}</TableCell>
                <TableCell>{row.weekday}</TableCell>
                <TableCell>{row.weekend}</TableCell>
                <TableCell>{row.holiday}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}