import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Trash2, UserPlus } from "lucide-react";
import { format, parseISO } from "date-fns";
import { 
  getEffectiveHFAssignment, 
  getBlockDatesForDate, 
  assignHFCoverage, 
  clearHFCoverage,
  analyzeHFSchedule,
  validateManualHFAssignment,
  type HFSchedule 
} from "@/lib/hf-engine";
import { loadSetup, loadSchedule, type Fellow, type SetupState, type PGY } from "@/lib/schedule-engine";
import { loadCallSchedule } from "@/lib/call-engine";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dateISO: string | null;
  fellows: Fellow[];
  schedule: HFSchedule | null;
  onUpdate: (newSchedule: HFSchedule) => void;
}

export default function HFEditDialog({ 
  open, 
  onOpenChange, 
  dateISO, 
  fellows, 
  schedule, 
  onUpdate 
}: Props) {
  const [selectedFellowId, setSelectedFellowId] = useState<string>("");
  const [actionScope, setActionScope] = useState<'day' | 'block'>('block');
  
  const setup = loadSetup();
  const callSchedule = loadCallSchedule();
  const schedByPGY = {
    "PGY-4": loadSchedule("PGY-4"),
    "PGY-5": loadSchedule("PGY-5"), 
    "PGY-6": loadSchedule("PGY-6")
  };
  const { toast } = useToast();
  
  if (!dateISO || !schedule || !setup) {
    return null;
  }
  
  const date = parseISO(dateISO);
  const currentAssignment = getEffectiveHFAssignment(dateISO, schedule);
  const blockDates = getBlockDatesForDate(dateISO, setup);
  const isMultiDayBlock = blockDates.length > 1;
  
  const currentFellow = currentAssignment 
    ? fellows.find(f => f.id === currentAssignment)
    : null;
  
  const fellowStats = useMemo(() => {
    const analysis = analyzeHFSchedule(schedule, fellows, setup);
    return Object.fromEntries(
      Object.entries(analysis.fellowStats).map(([fellowId, stat]) => [
        fellowId,
        {
          nonHolidayWeekends: stat.weekendCount,
          holidayDays: stat.holidayDayCount
        }
      ])
    );
  }, [schedule, fellows, setup]);

  // Helper to get fellow's rotation on the selected date
  const getRotationOnDate = (fellow: Fellow, date: Date) => {
    const dateToBlockKey = (d: Date): string => {
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const abbr = monthNames[d.getMonth()];
      const half = d.getDate() <= 15 ? 1 : 2;
      return `${abbr.toUpperCase()}${half}`;
    };

    const sched = schedByPGY[fellow.pgy];
    if (!sched || !sched.byFellow) return undefined;
    const row = sched.byFellow[fellow.id] || {};
    const key = dateToBlockKey(date);
    return row[key];
  };
  
  const handleAssign = () => {
    if (!selectedFellowId) return;
    
    // Validate the assignment
    const validation = validateManualHFAssignment(
      dateISO,
      selectedFellowId,
      actionScope,
      setup,
      callSchedule,
      schedByPGY,
      fellows,
      schedule
    );
    
    if (!validation.isValid) {
      toast({
        variant: "destructive",
        title: "Invalid Assignment",
        description: validation.reason,
      });
      return;
    }
    
    const newSchedule = assignHFCoverage(
      dateISO, 
      selectedFellowId, 
      actionScope, 
      schedule, 
      setup
    );
    onUpdate(newSchedule);
    onOpenChange(false);
  };
  
  const handleClear = () => {
    const newSchedule = clearHFCoverage(
      dateISO,
      actionScope,
      schedule,
      setup
    );
    onUpdate(newSchedule);
    onOpenChange(false);
  };
  
  const getBlockDescription = () => {
    if (blockDates.length === 1) {
      return format(date, "EEEE, MMM d, yyyy");
    }
    
    const startDate = parseISO(blockDates[0]);
    const endDate = parseISO(blockDates[blockDates.length - 1]);
    return `${format(startDate, "MMM d")} - ${format(endDate, "MMM d, yyyy")} (${blockDates.length} days)`;
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Edit HF Coverage
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div>
            <h4 className="font-medium mb-2">Selected Date(s)</h4>
            <p className="text-sm text-muted-foreground">
              {getBlockDescription()}
            </p>
          </div>
          
          {currentAssignment && (
            <div>
              <h4 className="font-medium mb-2">Current Assignment</h4>
              <Badge variant="secondary">
                {currentFellow?.name || "Unknown Fellow"}
              </Badge>
            </div>
          )}
          
          {isMultiDayBlock && (
            <div>
              <h4 className="font-medium mb-2">Action Scope</h4>
              <Select 
                value={actionScope} 
                onValueChange={(value: 'day' | 'block') => setActionScope(value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">
                    Individual day only ({format(date, "MMM d")})
                  </SelectItem>
                  <SelectItem value="block">
                    Entire block ({blockDates.length} days)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          
          <div>
            <h4 className="font-medium mb-2">Assign Fellow</h4>
            <Select value={selectedFellowId} onValueChange={setSelectedFellowId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a fellow..." />
              </SelectTrigger>
              <SelectContent>
                {fellows.map(fellow => {
                  const stats = fellowStats[fellow.id] || { nonHolidayWeekends: 0, holidayDays: 0 };
                  const rotation = getRotationOnDate(fellow, date);
                  return (
                    <SelectItem key={fellow.id} value={fellow.id}>
                      <div className="flex justify-between items-center w-full">
                        <div className="flex flex-col items-start">
                          <span>{fellow.name} ({fellow.pgy})</span>
                          {rotation && <span className="text-xs text-muted-foreground">On: {rotation}</span>}
                        </div>
                        <span className="text-xs text-muted-foreground ml-2">
                          {stats.nonHolidayWeekends} HF / {stats.holidayDays} Holiday
                        </span>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex gap-2 pt-4">
            <Button 
              onClick={handleAssign}
              disabled={!selectedFellowId}
              className="flex-1"
            >
              <UserPlus className="h-4 w-4 mr-2" />
              Assign
            </Button>
            
            {currentAssignment && (
              <Button 
                onClick={handleClear}
                variant="destructive"
                className="flex-1"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}