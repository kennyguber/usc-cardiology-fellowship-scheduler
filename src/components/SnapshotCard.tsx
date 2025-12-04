import { format } from "date-fns";
import { ScheduleSnapshot } from "@/lib/snapshot-engine";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, RotateCcw, Pencil, Download, Trash2, GitCompare } from "lucide-react";

interface SnapshotCardProps {
  snapshot: ScheduleSnapshot;
  onRestore: (snapshot: ScheduleSnapshot) => void;
  onRename: (snapshot: ScheduleSnapshot) => void;
  onExport: (snapshot: ScheduleSnapshot) => void;
  onDelete: (snapshot: ScheduleSnapshot) => void;
  onCompare?: (snapshot: ScheduleSnapshot) => void;
  compareMode?: boolean;
  selected?: boolean;
}

export function SnapshotCard({
  snapshot,
  onRestore,
  onRename,
  onExport,
  onDelete,
  onCompare,
  compareMode,
  selected,
}: SnapshotCardProps) {
  const { stats } = snapshot;

  return (
    <Card className={`transition-all ${selected ? "ring-2 ring-primary" : ""} ${compareMode ? "cursor-pointer hover:ring-2 hover:ring-primary/50" : ""}`}
      onClick={compareMode && onCompare ? () => onCompare(snapshot) : undefined}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">{snapshot.name}</CardTitle>
              {snapshot.autoSaved && (
                <Badge variant="secondary" className="text-xs">Auto</Badge>
              )}
            </div>
            <CardDescription>
              {format(new Date(snapshot.createdAt), "MMM d, yyyy 'at' h:mm a")}
            </CardDescription>
          </div>
          {!compareMode && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onRestore(snapshot)}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Restore
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onRename(snapshot)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onExport(snapshot)}>
                  <Download className="mr-2 h-4 w-4" />
                  Export
                </DropdownMenuItem>
                {onCompare && (
                  <DropdownMenuItem onClick={() => onCompare(snapshot)}>
                    <GitCompare className="mr-2 h-4 w-4" />
                    Compare
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onDelete(snapshot)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {snapshot.description && (
          <p className="text-sm text-muted-foreground mb-3">{snapshot.description}</p>
        )}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Fellows:</span>
            <span className="font-medium">{stats.fellowCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Year:</span>
            <span className="font-medium">{stats.academicYearStart}-{stats.academicYearStart + 1}</span>
          </div>
          <div className="flex justify-between col-span-2">
            <span className="text-muted-foreground">Primary:</span>
            <span className="font-medium">
              {stats.primaryAssigned}/{stats.primaryTotal} ({stats.primaryTotal > 0 ? Math.round((stats.primaryAssigned / stats.primaryTotal) * 100) : 0}%)
            </span>
          </div>
          <div className="flex justify-between col-span-2">
            <span className="text-muted-foreground">HF Weekends:</span>
            <span className="font-medium">
              {stats.hfWeekendsAssigned}/{stats.hfWeekendsTotal} ({stats.hfWeekendsTotal > 0 ? Math.round((stats.hfWeekendsAssigned / stats.hfWeekendsTotal) * 100) : 0}%)
            </span>
          </div>
          <div className="flex justify-between col-span-2">
            <span className="text-muted-foreground">HF Holidays:</span>
            <span className="font-medium">
              {stats.hfHolidaysAssigned}/{stats.hfHolidaysTotal} ({stats.hfHolidaysTotal > 0 ? Math.round((stats.hfHolidaysAssigned / stats.hfHolidaysTotal) * 100) : 0}%)
            </span>
          </div>
          <div className="flex justify-between col-span-2">
            <span className="text-muted-foreground">Jeopardy:</span>
            <span className="font-medium">
              {stats.jeopardyAssigned}/{stats.jeopardyTotal} ({stats.jeopardyTotal > 0 ? Math.round((stats.jeopardyAssigned / stats.jeopardyTotal) * 100) : 0}%)
            </span>
          </div>
          <div className="flex justify-between col-span-2">
            <span className="text-muted-foreground">Uncovered:</span>
            <span className={`font-medium ${stats.uncoveredDays > 0 ? "text-destructive" : "text-green-600"}`}>
              {stats.uncoveredDays} days
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
