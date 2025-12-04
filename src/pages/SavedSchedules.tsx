import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { SnapshotCard } from "@/components/SnapshotCard";
import { SaveSnapshotDialog } from "@/components/SaveSnapshotDialog";
import { RestoreSnapshotDialog } from "@/components/RestoreSnapshotDialog";
import { RenameSnapshotDialog } from "@/components/RenameSnapshotDialog";
import {
  ScheduleSnapshot,
  loadSnapshots,
  saveSnapshot,
  restoreSnapshot,
  deleteSnapshot,
  renameSnapshot,
  exportSnapshot,
  exportAllSnapshots,
  importSnapshot,
  getStorageUsage,
} from "@/lib/snapshot-engine";
import { useSEO } from "@/lib/seo";
import { Save, Upload, Download, Archive } from "lucide-react";

type FilterType = "all" | "manual" | "auto";
type SortType = "date-desc" | "date-asc" | "name";

export default function SavedSchedules() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [snapshots, setSnapshots] = useState<ScheduleSnapshot[]>([]);
  const [filter, setFilter] = useState<FilterType>("all");
  const [sort, setSort] = useState<SortType>("date-desc");
  const [search, setSearch] = useState("");
  const [storageUsage, setStorageUsage] = useState({ used: 0, total: 0, percentage: 0 });

  // Dialog states
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [restoreDialogSnapshot, setRestoreDialogSnapshot] = useState<ScheduleSnapshot | null>(null);
  const [renameDialogSnapshot, setRenameDialogSnapshot] = useState<ScheduleSnapshot | null>(null);
  const [deleteDialogSnapshot, setDeleteDialogSnapshot] = useState<ScheduleSnapshot | null>(null);

  useSEO({
    title: "Saved Schedules | Cardiology Fellowship Scheduler",
    description: "Manage saved schedule versions",
  });

  useEffect(() => {
    refreshSnapshots();
  }, []);

  const refreshSnapshots = () => {
    setSnapshots(loadSnapshots());
    setStorageUsage(getStorageUsage());
  };

  const filteredSnapshots = snapshots
    .filter((s) => {
      if (filter === "manual") return !s.autoSaved;
      if (filter === "auto") return s.autoSaved;
      return true;
    })
    .filter((s) => {
      if (!search) return true;
      const searchLower = search.toLowerCase();
      return (
        s.name.toLowerCase().includes(searchLower) ||
        s.description?.toLowerCase().includes(searchLower)
      );
    })
    .sort((a, b) => {
      if (sort === "date-desc") {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      if (sort === "date-asc") {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      return a.name.localeCompare(b.name);
    });

  const handleSave = (name: string, description?: string) => {
    saveSnapshot(name, description, false);
    refreshSnapshots();
    toast({ title: "Snapshot saved", description: `"${name}" has been saved.` });
  };

  const handleRestore = () => {
    if (!restoreDialogSnapshot) return;
    const success = restoreSnapshot(restoreDialogSnapshot.id);
    if (success) {
      toast({
        title: "Schedule restored",
        description: `"${restoreDialogSnapshot.name}" has been restored. Refresh pages to see changes.`,
      });
      setRestoreDialogSnapshot(null);
      // Navigate to setup page to see restored data
      navigate("/setup");
    } else {
      toast({ title: "Restore failed", variant: "destructive" });
    }
  };

  const handleRename = (name: string, description?: string) => {
    if (!renameDialogSnapshot) return;
    renameSnapshot(renameDialogSnapshot.id, name, description);
    refreshSnapshots();
    toast({ title: "Snapshot renamed" });
  };

  const handleDelete = () => {
    if (!deleteDialogSnapshot) return;
    deleteSnapshot(deleteDialogSnapshot.id);
    refreshSnapshots();
    toast({ title: "Snapshot deleted" });
    setDeleteDialogSnapshot(null);
  };

  const handleExport = (snapshot: ScheduleSnapshot) => {
    exportSnapshot(snapshot.id);
    toast({ title: "Snapshot exported" });
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      await importSnapshot(file);
      refreshSnapshots();
      toast({ title: "Snapshot imported" });
    } catch (error) {
      toast({
        title: "Import failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }

    // Reset input
    e.target.value = "";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Saved Schedules</h1>
          <p className="text-muted-foreground">
            Save and restore complete schedule versions
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setSaveDialogOpen(true)}>
            <Save className="mr-2 h-4 w-4" />
            Save Current
          </Button>
          <Button variant="outline" asChild>
            <label className="cursor-pointer">
              <Upload className="mr-2 h-4 w-4" />
              Import
              <input
                type="file"
                accept=".json"
                onChange={handleImport}
                className="hidden"
              />
            </label>
          </Button>
          {snapshots.length > 0 && (
            <Button variant="outline" onClick={exportAllSnapshots}>
              <Download className="mr-2 h-4 w-4" />
              Export All
            </Button>
          )}
        </div>
      </div>

      {/* Storage usage */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Storage used</span>
          <span className="text-muted-foreground">
            {(storageUsage.used / 1024).toFixed(1)} KB / {(storageUsage.total / 1024 / 1024).toFixed(0)} MB
            ({storageUsage.percentage}%)
          </span>
        </div>
        <Progress value={storageUsage.percentage} className="h-2" />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          placeholder="Search snapshots..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-xs"
        />
        <Select value={filter} onValueChange={(v) => setFilter(v as FilterType)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="manual">Manual only</SelectItem>
            <SelectItem value="auto">Auto-saves</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as SortType)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="date-desc">Newest first</SelectItem>
            <SelectItem value="date-asc">Oldest first</SelectItem>
            <SelectItem value="name">Name</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Snapshots grid */}
      {filteredSnapshots.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Archive className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No saved schedules</h3>
          <p className="text-muted-foreground mt-1">
            {snapshots.length === 0
              ? "Save your first schedule to get started"
              : "No snapshots match your filters"}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredSnapshots.map((snapshot) => (
            <SnapshotCard
              key={snapshot.id}
              snapshot={snapshot}
              onRestore={setRestoreDialogSnapshot}
              onRename={setRenameDialogSnapshot}
              onExport={handleExport}
              onDelete={setDeleteDialogSnapshot}
            />
          ))}
        </div>
      )}

      {/* Dialogs */}
      <SaveSnapshotDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        onSave={handleSave}
      />

      <RestoreSnapshotDialog
        open={!!restoreDialogSnapshot}
        onOpenChange={(open) => !open && setRestoreDialogSnapshot(null)}
        snapshot={restoreDialogSnapshot}
        onConfirm={handleRestore}
      />

      <RenameSnapshotDialog
        open={!!renameDialogSnapshot}
        onOpenChange={(open) => !open && setRenameDialogSnapshot(null)}
        snapshot={renameDialogSnapshot}
        onRename={handleRename}
      />

      <AlertDialog
        open={!!deleteDialogSnapshot}
        onOpenChange={(open) => !open && setDeleteDialogSnapshot(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete snapshot?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{deleteDialogSnapshot?.name}". This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
