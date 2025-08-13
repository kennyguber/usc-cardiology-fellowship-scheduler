import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { listEligiblePrimaryFellows, listIneligiblePrimaryFellows, applyManualPrimaryAssignment, listPrimarySwapSuggestions, applyPrimarySwap, type CallSchedule, type SwapSuggestion } from "@/lib/call-engine";
import { loadSetup } from "@/lib/schedule-engine";
import { useToast } from "@/hooks/use-toast";

export function PrimaryCallEditDialog({
  iso,
  schedule,
  open = true,
  onClose,
  onApply,
}: {
  iso: string;
  schedule: CallSchedule;
  open?: boolean;
  onClose: () => void;
  onApply: (s: CallSchedule) => void;
}) {
  const { toast } = useToast();
  const setup = loadSetup();
  const fellows = setup?.fellows ?? [];
  const fellowById = React.useMemo(() => Object.fromEntries(fellows.map((f) => [f.id, f] as const)), [fellows]);
  const currentId = schedule.days[iso];
  const currentName = currentId ? fellowById[currentId]?.name ?? currentId : undefined;

  const eligible = React.useMemo(() => listEligiblePrimaryFellows(iso, schedule), [iso, schedule]);
  const ineligible = React.useMemo(() => listIneligiblePrimaryFellows(iso, schedule), [iso, schedule]);
  const [showIneligible, setShowIneligible] = React.useState(false);
  const [swapOpen, setSwapOpen] = React.useState(false);
  const [swapSuggestions, setSwapSuggestions] = React.useState<SwapSuggestion[]>([]);

  React.useEffect(() => {
    setSwapSuggestions(listPrimarySwapSuggestions(schedule, iso, 10));
  }, [iso, schedule]);
  const handleAssign = (fid: string | null) => {
    const res = applyManualPrimaryAssignment(schedule, iso, fid);
    if (!res.ok || !res.schedule) {
      toast({
        title: "Assignment failed",
        description: (res.reasons || ["The selected change violates one or more scheduling rules."]).join("; "),
        variant: "destructive",
      });
      return;
    }
    onApply(res.schedule);
    toast({ title: fid ? "Primary call updated" : "Assignment cleared", description: iso });
  };

  const handleSwap = (otherISO: string) => {
    const res = applyPrimarySwap(schedule, iso, otherISO);
    if (!res.ok || !res.schedule) {
      toast({
        title: "Swap failed",
        description: (res.reasons || ["That swap violates scheduling rules."]).join("; "),
        variant: "destructive",
      });
      return;
    }
    onApply(res.schedule);
    toast({ title: "Swap applied", description: `${iso} ↔ ${otherISO}` });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit primary call</DialogTitle>
          <DialogDescription>
            {iso} {currentName ? `— currently ${currentName}` : "— currently unassigned"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <div className="text-sm font-medium mb-2">Reassign to</div>
            {eligible.length ? (
              <ScrollArea className="max-h-64">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pr-2">
                  {eligible.map((f) => (
                    <Button key={f.id} variant="outline" className="justify-start" onClick={() => handleAssign(f.id)}>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{f.pgy}</Badge>
                        <span>{f.name}</span>
                      </div>
                    </Button>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <div className="text-sm text-muted-foreground">No fellows are eligible for this date under current rules.</div>
            )}
          </div>

          {ineligible.length ? (
            <Collapsible open={showIneligible} onOpenChange={setShowIneligible}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Ineligible fellows</div>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm">
                    {showIneligible ? "Hide" : "Show"} ({ineligible.length})
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <div className="mt-2 pr-2 max-h-60 overflow-y-auto">
                  <div className="space-y-2">
                    {ineligible.map((f) => (
                      <div key={f.id} className="rounded-md border p-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{f.pgy}</Badge>
                          <span className="font-medium">{f.name}</span>
                        </div>
                        <ul className="list-disc ml-6 mt-1 text-xs text-muted-foreground">
                          {f.reasons.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          ) : null}

          {currentId ? (
            <div className="pt-2 border-t">
              <Collapsible open={swapOpen} onOpenChange={setSwapOpen}>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Swap suggestions</div>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm">{swapOpen ? "Hide" : "Show"}</Button>
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent>
                  <div className="mt-2 pr-2 max-h-60 overflow-y-auto">
                    {swapSuggestions.length ? (
                      <div className="space-y-2">
                        {swapSuggestions.map((s) => (
                          <div key={s.date} className="rounded-md border p-2 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary">{s.date}</Badge>
                              <span className="text-sm">with {fellowById[s.fellowBId]?.name ?? s.fellowBId}</span>
                            </div>
                            <Button size="sm" onClick={() => handleSwap(s.date)}>Swap</Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">No valid swaps found under current rules.</div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          ) : null}

          <div className="pt-2 border-t">
            <div className="text-sm font-medium mb-2">Other actions</div>
            <Button variant="destructive" onClick={() => handleAssign(null)}>Clear assignment</Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PrimaryCallEditDialog;
