import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { loadSetup, loadSchedule, type PGY, type StoredSchedule } from "@/lib/schedule-engine";
import { 
  applyJeopardyAssignmentScoped, 
  getEligibleJeopardyFellows, 
  getEligibleJeopardyFellowsForBlock,
  getIneligibleJeopardyReasons, 
  getIneligibleJeopardyReasonsForBlock,
  getJeopardyBlockForDate,
  type JeopardySchedule 
} from "@/lib/jeopardy-engine";

type JeopardyEditDialogProps = {
  iso: string | null;
  schedule: JeopardySchedule | null;
  open: boolean;
  onClose: () => void;
  onApply: (newSchedule: JeopardySchedule) => void;
};

export default function JeopardyEditDialog({ iso, schedule, open, onClose, onApply }: JeopardyEditDialogProps) {
  const [showIneligible, setShowIneligible] = useState(false);
  const [actionScope, setActionScope] = useState<"single" | "block">("single");
  const { toast } = useToast();
  
  const setup = loadSetup();
  const fellowById = setup ? Object.fromEntries(setup.fellows.map(f => [f.id, f])) : {};
  const schedByPGY: Record<PGY, StoredSchedule | null> = {
    "PGY-4": loadSchedule("PGY-4"),
    "PGY-5": loadSchedule("PGY-5"),
    "PGY-6": loadSchedule("PGY-6"),
  };

  // Helper to get fellow's rotation on a specific date
  const getRotationOnDate = (fellowId: string, dateISO: string) => {
    const fellow = fellowById[fellowId];
    if (!fellow) return undefined;

    const dateToBlockKey = (d: Date): string => {
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const abbr = monthNames[d.getMonth()];
      const half = d.getDate() <= 15 ? 1 : 2;
      return `${abbr.toUpperCase()}${half}`;
    };

    const date = new Date(dateISO + "T00:00:00");
    const sched = schedByPGY[fellow.pgy];
    if (!sched || !sched.byFellow) return undefined;
    const row = sched.byFellow[fellow.id] || {};
    const key = dateToBlockKey(date);
    return row[key];
  };
  
  const jeopardyBlock = iso ? getJeopardyBlockForDate(iso) : null;
  const blockLabel = jeopardyBlock ? 
    (jeopardyBlock.type === "holiday" ? `Holiday Block (${jeopardyBlock.dayCount} days)` :
     jeopardyBlock.type === "weekend" ? `Weekend Block (${jeopardyBlock.dayCount} days)` :
     "Single Day") : "Single Day";
  
  const eligible = iso ? 
    (actionScope === "block" && jeopardyBlock ? getEligibleJeopardyFellowsForBlock(jeopardyBlock) : getEligibleJeopardyFellows(iso)) : [];
  const ineligible = iso ? 
    (actionScope === "block" && jeopardyBlock ? getIneligibleJeopardyReasonsForBlock(jeopardyBlock) : getIneligibleJeopardyReasons(iso)) : [];
  
  const currentAssignment = iso && schedule ? schedule.days[iso] : null;
  const currentFellow = currentAssignment ? fellowById[currentAssignment] : null;
  
  const handleAssign = (fid: string | null) => {
    if (!iso || !schedule) return;
    
    const result = applyJeopardyAssignmentScoped(schedule, iso, fid, actionScope);
    if (result.success && result.schedule) {
      onApply(result.schedule);
      const scopeText = actionScope === "block" && jeopardyBlock ? ` (${blockLabel})` : "";
      toast({
        title: fid ? "Jeopardy assignment updated" : "Jeopardy assignment cleared",
        description: fid 
          ? `${fellowById[fid]?.name} assigned to jeopardy on ${iso}${scopeText}`
          : `Jeopardy assignment cleared for ${iso}${scopeText}`,
      });
    } else {
      toast({
        title: "Assignment failed",
        description: result.error || "Could not update jeopardy assignment",
        variant: "destructive",
      });
    }
  };

  const formatDate = (iso: string) => {
    const date = new Date(iso + "T00:00:00");
    return date.toLocaleDateString(undefined, { 
      weekday: "long", 
      year: "numeric", 
      month: "long", 
      day: "numeric" 
    });
  };

  if (!iso) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Jeopardy Assignment - {formatDate(iso)}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Action Scope */}
          {jeopardyBlock && jeopardyBlock.dayCount > 1 && (
            <div>
              <h3 className="font-medium mb-3">Action Scope</h3>
              <RadioGroup value={actionScope} onValueChange={(value) => setActionScope(value as "single" | "block")}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="single" id="single" />
                  <Label htmlFor="single">Single Day Only</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="block" id="block" />
                  <Label htmlFor="block">{blockLabel}</Label>
                </div>
              </RadioGroup>
            </div>
          )}

          {/* Current Assignment */}
          <div>
            <h3 className="font-medium mb-2">Current Assignment</h3>
            {currentFellow ? (
              <div className="flex items-center gap-2">
                <div className="flex flex-col">
                  <Badge variant="secondary">{currentFellow.name} ({currentFellow.pgy})</Badge>
                  {(() => {
                    const rotation = getRotationOnDate(currentFellow.id, iso);
                    return rotation ? <span className="text-xs text-muted-foreground mt-1">On: {rotation}</span> : null;
                  })()}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAssign(null)}
                >
                  Clear
                </Button>
              </div>
            ) : (
              <div className="text-muted-foreground">No assignment</div>
            )}
          </div>

          {/* Eligible Fellows */}
          <div>
            <h3 className="font-medium mb-2">Reassign to Eligible Fellow</h3>
            {eligible.length > 0 ? (
              <div className="grid grid-cols-1 gap-2">
                {eligible.map((fellow) => (
                  <Button
                    key={fellow.id}
                    variant="outline"
                    className="justify-start h-auto p-3"
                    onClick={() => handleAssign(fellow.id)}
                    disabled={fellow.id === currentAssignment}
                  >
                    <div className="flex flex-col items-start">
                      <div className="font-medium">{fellow.name}</div>
                      <div className="text-sm text-muted-foreground">{fellow.pgy}</div>
                      {(() => {
                        const rotation = getRotationOnDate(fellow.id, iso);
                        return rotation ? <div className="text-xs text-muted-foreground">On: {rotation}</div> : null;
                      })()}
                    </div>
                  </Button>
                ))}
              </div>
            ) : (
              <div className="text-muted-foreground">No eligible fellows available</div>
            )}
          </div>

          {/* Ineligible Fellows */}
          {ineligible.length > 0 && (
            <div>
              <Collapsible open={showIneligible} onOpenChange={setShowIneligible}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="justify-start p-0 h-auto">
                    {showIneligible ? (
                      <ChevronDown className="h-4 w-4 mr-1" />
                    ) : (
                      <ChevronRight className="h-4 w-4 mr-1" />
                    )}
                    <span className="font-medium">
                      Ineligible Fellows ({ineligible.length})
                    </span>
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <div className="space-y-2">
                    {ineligible.map(({ fellow, reasons }) => (
                      <div key={fellow.id} className="border rounded p-3">
                        <div className="font-medium text-sm">
                          {fellow.name} ({fellow.pgy})
                          {(() => {
                            const rotation = getRotationOnDate(fellow.id, iso);
                            return rotation ? <span className="font-normal text-muted-foreground"> - On: {rotation}</span> : null;
                          })()}
                        </div>
                        <div className="mt-1 space-y-1">
                          {reasons.map((reason, idx) => (
                            <div key={idx} className="text-xs text-destructive">
                              • {reason}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}