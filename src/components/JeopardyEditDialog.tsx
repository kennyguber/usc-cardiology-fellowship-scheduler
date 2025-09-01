import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { loadSetup } from "@/lib/schedule-engine";
import { applyJeopardyAssignment, getEligibleJeopardyFellows, getIneligibleJeopardyReasons, type JeopardySchedule } from "@/lib/jeopardy-engine";

type JeopardyEditDialogProps = {
  iso: string | null;
  schedule: JeopardySchedule | null;
  open: boolean;
  onClose: () => void;
  onApply: (newSchedule: JeopardySchedule) => void;
};

export default function JeopardyEditDialog({ iso, schedule, open, onClose, onApply }: JeopardyEditDialogProps) {
  const [showIneligible, setShowIneligible] = useState(false);
  const { toast } = useToast();
  
  const setup = loadSetup();
  const fellowById = setup ? Object.fromEntries(setup.fellows.map(f => [f.id, f])) : {};
  
  const eligible = iso ? getEligibleJeopardyFellows(iso) : [];
  const ineligible = iso ? getIneligibleJeopardyReasons(iso) : [];
  
  const currentAssignment = iso && schedule ? schedule.days[iso] : null;
  const currentFellow = currentAssignment ? fellowById[currentAssignment] : null;
  
  const handleAssign = (fid: string | null) => {
    if (!iso || !schedule) return;
    
    const result = applyJeopardyAssignment(schedule, iso, fid);
    if (result.success && result.schedule) {
      onApply(result.schedule);
      toast({
        title: fid ? "Jeopardy assignment updated" : "Jeopardy assignment cleared",
        description: fid 
          ? `${fellowById[fid]?.name} assigned to jeopardy on ${iso}`
          : `Jeopardy assignment cleared for ${iso}`,
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
          {/* Current Assignment */}
          <div>
            <h3 className="font-medium mb-2">Current Assignment</h3>
            {currentFellow ? (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{currentFellow.name} ({currentFellow.pgy})</Badge>
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