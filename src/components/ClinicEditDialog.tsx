import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { loadSetup, type Fellow } from "@/lib/schedule-engine";
import { 
  getEligibleFellowsForClinic, 
  getIneligibleClinicReasons,
  applyClinicAssignmentChange,
  getFellowRotationOnDate,
  type ClinicSchedule,
  type ClinicType,
  type ClinicAssignment
} from "@/lib/clinic-engine";
import { getPrimaryRotation } from "@/lib/rotation-engine";
import type { CallSchedule } from "@/lib/call-engine";

type ClinicEditDialogProps = {
  iso: string | null;
  assignmentIndex: number | null;
  schedule: ClinicSchedule | null;
  callSchedule: CallSchedule | null;
  open: boolean;
  onClose: () => void;
  onApply: (newSchedule: ClinicSchedule) => void;
  mode: 'edit' | 'add';
};

export default function ClinicEditDialog({ 
  iso, 
  assignmentIndex, 
  schedule, 
  callSchedule,
  open, 
  onClose, 
  onApply,
  mode 
}: ClinicEditDialogProps) {
  const [showIneligible, setShowIneligible] = useState(false);
  const [selectedFellowId, setSelectedFellowId] = useState<string | null>(null);
  const [selectedClinicType, setSelectedClinicType] = useState<ClinicType | null>(null);
  const { toast } = useToast();
  
  const setup = loadSetup();
  const fellowById = setup ? Object.fromEntries(setup.fellows.map(f => [f.id, f])) : {};

  const currentAssignment = iso && schedule && assignmentIndex !== null && mode === 'edit'
    ? schedule.days[iso]?.[assignmentIndex]
    : null;

  const currentFellow = currentAssignment ? fellowById[currentAssignment.fellowId] : null;
  const currentClinicType = currentAssignment?.clinicType || null;

  // Calculate clinic stats
  const clinicStats = useMemo(() => {
    if (!schedule || !setup) return {};
    return schedule.countsByFellow;
  }, [schedule, setup]);

  // Get eligible fellows for the selected or current clinic type
  const targetClinicType = selectedClinicType || currentClinicType || 'GENERAL';
  const eligible = iso && schedule && setup ? 
    getEligibleFellowsForClinic(iso, targetClinicType, schedule, callSchedule, setup) : [];
  const ineligible = iso && schedule && setup ? 
    getIneligibleClinicReasons(iso, targetClinicType, schedule, callSchedule, setup) : [];

  const handleRemove = () => {
    if (!iso || !schedule || assignmentIndex === null) return;
    
    const result = applyClinicAssignmentChange(schedule, iso, 'remove', assignmentIndex, null);
    if (result.success && result.schedule) {
      onApply(result.schedule);
      toast({
        title: "Clinic assignment removed",
        description: "The clinic assignment has been removed successfully.",
      });
      onClose();
    } else {
      toast({
        title: "Removal failed",
        description: result.error || "Could not remove clinic assignment",
        variant: "destructive",
      });
    }
  };

  const handleApply = () => {
    if (!iso || !schedule) return;

    let newAssignment: ClinicAssignment | null = null;
    
    if (mode === 'add') {
      // Add mode: need both fellow and clinic type
      if (!selectedFellowId || !selectedClinicType) {
        toast({
          title: "Incomplete selection",
          description: "Please select both a fellow and a clinic type",
          variant: "destructive",
        });
        return;
      }
      
      const date = new Date(iso + "T00:00:00");
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      
      newAssignment = {
        fellowId: selectedFellowId,
        clinicType: selectedClinicType,
        dayOfWeek: dayNames[date.getDay()]
      };
      
      const result = applyClinicAssignmentChange(schedule, iso, 'add', null, newAssignment);
      if (result.success && result.schedule) {
        onApply(result.schedule);
        toast({
          title: "Clinic assignment added",
          description: `${fellowById[selectedFellowId]?.name} assigned to ${selectedClinicType} clinic`,
        });
        onClose();
      } else {
        toast({
          title: "Assignment failed",
          description: result.error || "Could not add clinic assignment",
          variant: "destructive",
        });
      }
    } else {
      // Edit mode: can change fellow, clinic type, or both
      const targetFellowId = selectedFellowId || currentAssignment?.fellowId;
      const targetClinicType = selectedClinicType || currentAssignment?.clinicType;
      
      if (!targetFellowId || !targetClinicType) return;
      
      const date = new Date(iso + "T00:00:00");
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      
      newAssignment = {
        fellowId: targetFellowId,
        clinicType: targetClinicType,
        dayOfWeek: dayNames[date.getDay()]
      };
      
      const result = applyClinicAssignmentChange(schedule, iso, 'edit', assignmentIndex, newAssignment);
      if (result.success && result.schedule) {
        onApply(result.schedule);
        toast({
          title: "Clinic assignment updated",
          description: `Updated to ${fellowById[targetFellowId]?.name} - ${targetClinicType}`,
        });
        onClose();
      } else {
        toast({
          title: "Update failed",
          description: result.error || "Could not update clinic assignment",
          variant: "destructive",
        });
      }
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

  const getClinicTypeLabel = (type: ClinicType) => {
    switch (type) {
      case 'GENERAL': return 'General Clinic';
      case 'HEART_FAILURE': return 'Heart Failure Clinic';
      case 'ACHD': return 'ACHD Clinic';
      case 'DEVICE': return 'Device Clinic';
      case 'EP': return 'EP Clinic';
    }
  };

  if (!iso) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === 'edit' ? 'Edit Clinic Assignment' : 'Add Clinic Assignment'} - {formatDate(iso)}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Current Assignment (Edit mode only) */}
          {mode === 'edit' && currentFellow && currentClinicType && (
            <div>
              <h3 className="font-medium mb-2">Current Assignment</h3>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">
                  {currentFellow.name} ({currentFellow.pgy}) - {getClinicTypeLabel(currentClinicType)}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {clinicStats[currentFellow.id]?.[currentClinicType] || 0} total
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRemove}
                >
                  Remove
                </Button>
              </div>
            </div>
          )}

          {/* Clinic Type Selection */}
          <div>
            <h3 className="font-medium mb-2">
              {mode === 'add' ? 'Select Clinic Type' : 'Change Clinic Type (Optional)'}
            </h3>
            <RadioGroup 
              value={selectedClinicType || ''} 
              onValueChange={(value) => setSelectedClinicType(value as ClinicType)}
            >
              <div className="space-y-2">
                {(['GENERAL', 'HEART_FAILURE', 'ACHD', 'DEVICE', 'EP'] as ClinicType[]).map((type) => (
                  <div key={type} className="flex items-center space-x-2">
                    <RadioGroupItem value={type} id={`clinic-${type}`} />
                    <Label htmlFor={`clinic-${type}`} className="flex-1 cursor-pointer">
                      {getClinicTypeLabel(type)}
                      {mode === 'edit' && type === currentClinicType && ' (current)'}
                    </Label>
                  </div>
                ))}
              </div>
            </RadioGroup>
          </div>

          {/* Eligible Fellows */}
          <div>
            <h3 className="font-medium mb-2">
              {mode === 'add' ? 'Select Fellow' : 'Reassign to Different Fellow (Optional)'}
            </h3>
            {eligible.length > 0 ? (
              <div className="grid grid-cols-1 gap-2">
                {eligible.map((fellow) => {
                  const isCurrentAssignment = mode === 'edit' && fellow.id === currentAssignment?.fellowId;
                  const rotation = getFellowRotationOnDate(fellow.id, iso);
                  const primary = rotation ? getPrimaryRotation(rotation) : undefined;
                  const stats = clinicStats[fellow.id] || {};
                  const currentCount = stats[targetClinicType] || 0;
                  
                  return (
                    <Button
                      key={fellow.id}
                      variant={selectedFellowId === fellow.id ? "default" : "outline"}
                      className="justify-between h-auto p-3"
                      onClick={() => setSelectedFellowId(fellow.id)}
                      disabled={isCurrentAssignment}
                    >
                      <div className="flex flex-col items-start">
                        <div className="font-medium">
                          {fellow.name}
                          {isCurrentAssignment && ' (current)'}
                        </div>
                        <div className="text-sm text-muted-foreground">{fellow.pgy}</div>
                        {primary && <div className="text-xs text-muted-foreground">On: {primary}</div>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {currentCount} {getClinicTypeLabel(targetClinicType)}
                      </div>
                    </Button>
                  );
                })}
              </div>
            ) : (
              <div className="text-muted-foreground text-sm">
                No eligible fellows available for {getClinicTypeLabel(targetClinicType)}
              </div>
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
                    {ineligible.map(({ fellow, reasons }) => {
                      const rotation = getFellowRotationOnDate(fellow.id, iso);
                      const primary = rotation ? getPrimaryRotation(rotation) : undefined;
                      const stats = clinicStats[fellow.id] || {};
                      const currentCount = stats[targetClinicType] || 0;
                      
                      return (
                        <div key={fellow.id} className="border rounded p-3">
                          <div className="flex justify-between items-start mb-1">
                            <div className="font-medium text-sm">
                              {fellow.name} ({fellow.pgy})
                              {primary && <span className="font-normal text-muted-foreground"> - On: {primary}</span>}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {currentCount} assignments
                            </div>
                          </div>
                          <div className="mt-1 space-y-1">
                            {reasons.map((reason, idx) => (
                              <div key={idx} className="text-xs text-destructive flex items-start gap-1">
                                <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                                {reason}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleApply}>
            {mode === 'add' ? 'Add Assignment' : 'Apply Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
