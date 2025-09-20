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
            {conflictingFellow ? 
              `${conflictingFellow} already has vacation assigned to block ${blockKey}. Assigning ${fellowName} to vacation in the same block will allow up to 2 fellows on vacation per block.` :
              `Block ${blockKey} would exceed the limit of 2 total fellows on vacation across all PGY levels (including other PGY classes).`
            }
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