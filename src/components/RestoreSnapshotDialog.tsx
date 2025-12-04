import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScheduleSnapshot } from "@/lib/snapshot-engine";
import { format } from "date-fns";

interface RestoreSnapshotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: ScheduleSnapshot | null;
  onConfirm: () => void;
}

export function RestoreSnapshotDialog({
  open,
  onOpenChange,
  snapshot,
  onConfirm,
}: RestoreSnapshotDialogProps) {
  if (!snapshot) return null;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Restore "{snapshot.name}"?</AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <p>
              This will replace your current schedule with the saved version from{" "}
              <strong>{format(new Date(snapshot.createdAt), "MMM d, yyyy 'at' h:mm a")}</strong>.
            </p>
            <p className="text-destructive font-medium">
              ⚠️ Any unsaved changes to your current schedule will be lost.
            </p>
            <p className="text-sm text-muted-foreground">
              Tip: Save your current schedule first if you want to keep it.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Restore Schedule
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
