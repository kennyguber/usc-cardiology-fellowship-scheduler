import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { loadSetup, type Fellow } from "@/lib/schedule-engine";
import { 
  getEligibleAmbulatoryFellows, 
  getIneligibleAmbulatoryReasons,
  applyAmbulatoryAssignment,
  getBlockKeyForDate,
  getFellowRotationOnDate,
  type ClinicSchedule 
} from "@/lib/clinic-engine";
import { getPrimaryRotation } from "@/lib/rotation-engine";

type AmbulatoryEditDialogProps = {
  iso: string | null;
  schedule: ClinicSchedule | null;
  open: boolean;
  onClose: () => void;
  onApply: (newSchedule: ClinicSchedule) => void;
};

export default function AmbulatoryEditDialog({ iso, schedule, open, onClose, onApply }: AmbulatoryEditDialogProps) {
  const [showIneligible, setShowIneligible] = useState(false);
  const { toast } = useToast();
  
  const setup = loadSetup();
  const fellowById = setup ? Object.fromEntries(setup.fellows.map(f => [f.id, f])) : {};

  // Get block key and calculate ambulatory stats
  const blockKey = iso && setup ? getBlockKeyForDate(iso, setup.yearStart) : null;
  
  const ambulatoryStats = useMemo(() => {
    if (!schedule || !setup) return {};
    
    const stats: Record<string, number> = {};
    setup.fellows.forEach(fellow => {
      stats[fellow.id] = schedule.ambulatoryCountsByFellow?.[fellow.id] ?? 0;
    });
    
    return stats;
  }, [schedule, setup]);

  const eligible = iso && schedule && setup && blockKey ? 
    getEligibleAmbulatoryFellows(blockKey, schedule, setup) : [];
  const ineligible = iso && schedule && setup && blockKey ? 
    getIneligibleAmbulatoryReasons(blockKey, schedule, setup) : [];
  
  const currentAssignment = iso && schedule ? schedule.ambulatoryAssignments?.[iso] : null;
  const currentFellow = currentAssignment ? fellowById[currentAssignment] : null;
  
  const handleAssign = (fellowId: string | null) => {
    if (!iso || !schedule || !setup || !blockKey) return;
    
    const result = applyAmbulatoryAssignment(schedule, blockKey, fellowId, setup);
    if (result.success && result.schedule) {
      onApply(result.schedule);
      toast({
        title: fellowId ? "Ambulatory assignment updated" : "Ambulatory assignment cleared",
        description: fellowId 
          ? `${fellowById[fellowId]?.name} assigned to ${blockKey} block`
          : `Ambulatory assignment cleared for ${blockKey} block`,
      });
    } else {
      toast({
        title: "Assignment failed",
        description: result.error || "Could not update ambulatory assignment",
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

  if (!iso || !blockKey) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Ambulatory Fellow Assignment - {blockKey} Block</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          <div className="text-sm text-muted-foreground">
            {formatDate(iso)} • 2-week block assignment
          </div>

          {/* Current Assignment */}
          <div>
            <h3 className="font-medium mb-2">Current Assignment</h3>
            {currentFellow ? (
              <div className="flex items-center gap-2">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{currentFellow.name} ({currentFellow.pgy})</Badge>
                    <span className="text-xs text-muted-foreground">
                      {ambulatoryStats[currentFellow.id] || 0} Ambulatory Assignments
                    </span>
                  </div>
                  {(() => {
                    const rotation = getFellowRotationOnDate(currentFellow.id, iso);
                    const primary = rotation ? getPrimaryRotation(rotation) : undefined;
                    return primary ? <span className="text-xs text-muted-foreground mt-1">On: {primary}</span> : null;
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
                    className="justify-between h-auto p-3"
                    onClick={() => handleAssign(fellow.id)}
                    disabled={fellow.id === currentAssignment}
                  >
                    <div className="flex flex-col items-start">
                      <div className="font-medium">{fellow.name}</div>
                      <div className="text-sm text-muted-foreground">{fellow.pgy}</div>
                      {(() => {
                        const rotation = getFellowRotationOnDate(fellow.id, iso);
                        const primary = rotation ? getPrimaryRotation(rotation) : undefined;
                        return primary ? <div className="text-xs text-muted-foreground">On: {primary}</div> : null;
                      })()}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {ambulatoryStats[fellow.id] || 0} Assignments
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
                        <div className="flex justify-between items-start mb-1">
                          <div className="font-medium text-sm">
                            {fellow.name} ({fellow.pgy})
                            {(() => {
                              const rotation = getFellowRotationOnDate(fellow.id, iso);
                              const primary = rotation ? getPrimaryRotation(rotation) : undefined;
                              return primary ? <span className="font-normal text-muted-foreground"> - On: {primary}</span> : null;
                            })()}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {ambulatoryStats[fellow.id] || 0} Assignments
                          </div>
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
