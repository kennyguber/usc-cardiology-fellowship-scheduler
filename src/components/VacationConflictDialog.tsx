import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

interface VacationConflictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  fellowName: string;
  blockKey: string;
  conflictingFellow: string;
}

export function VacationConflictDialog({ 
  open, 
  onOpenChange, 
  onConfirm, 
  fellowName, 
  blockKey, 
  conflictingFellow 
}: VacationConflictDialogProps) {
  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Vacation Conflict</AlertDialogTitle>
          <AlertDialogDescription>
            {conflictingFellow} already has vacation assigned to block {blockKey}. 
            Assigning {fellowName} to vacation in the same block will override the normal 
            "one vacation per block" rule.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm}>
            Override and Assign
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}