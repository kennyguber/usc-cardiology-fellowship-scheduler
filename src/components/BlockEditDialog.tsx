import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Rotation } from "@/lib/rotation-engine";

export type BlockEditDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fellowName: string;
  blockKey: string;
  blockLabel: string;
  currentLabel?: string;
  options: Rotation[];
  onApply: (value: { type: "set"; rotation: Rotation } | { type: "clear" }) => void;
};

export function BlockEditDialog({ open, onOpenChange, fellowName, blockKey, blockLabel, currentLabel, options, onApply }: BlockEditDialogProps) {
  const [value, setValue] = React.useState<string>(currentLabel || "");
  React.useEffect(() => {
    setValue(currentLabel || "");
  }, [currentLabel, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit block</DialogTitle>
          <DialogDescription>
            {fellowName} • {blockKey} • {blockLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="text-sm">Change assignment</div>
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger aria-label="Select assignment">
              <SelectValue placeholder="Select an assignment" />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt === "VAC" ? "Vacation" : 
                   opt.startsWith("ELECTIVE (") ? `Elective ${opt.match(/\((.*)\)/)?.[1] || ""}` :
                   opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="outline" onClick={() => onApply({ type: "clear" })}>Clear assignment</Button>
          <Button onClick={() => value && onApply({ type: "set", rotation: value as Rotation })} disabled={!value}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default BlockEditDialog;
