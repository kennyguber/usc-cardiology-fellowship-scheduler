import { useMemo, useRef, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { useToast } from "@/hooks/use-toast";
import { useSEO } from "@/lib/seo";
import { BlockInfo, generateAcademicYearBlocks } from "@/lib/block-utils";
import { HeartPulse, GripVertical } from "lucide-react";
import { computeAcademicYearHolidays } from "@/lib/holidays";
import { loadSettings } from "@/lib/settings-engine";

export type PGY = "PGY-4" | "PGY-5" | "PGY-6";
export type Fellow = { id: string; name: string; pgy: PGY; clinicDay?: "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday"; vacationPrefs: (string | undefined)[] };
export type Holiday = { id: string; date: string; name: string };

const STORAGE_KEY = "cfsa_setup_v1";

type AppSetup = {
  yearStart: string; // ISO date
  fellows: Fellow[];
  holidays: Holiday[];
};

const defaultYearStart = () => {
  const now = new Date();
  const year = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-07-01`;
};

function useSetupState() {
  const [raw, setRaw] = useState<AppSetup>(() => {
    try {
      const item = localStorage.getItem(STORAGE_KEY);
      return item
        ? (JSON.parse(item) as AppSetup)
        : { yearStart: defaultYearStart(), fellows: [], holidays: [] };
    } catch {
      return { yearStart: defaultYearStart(), fellows: [], holidays: [] };
    }
  });

  const save = (next: AppSetup) => {
    setRaw(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  return [raw, save] as const;
}

function FellowRow({
  fellow,
  blocks,
  onChange,
  onRemove,
}: {
  fellow: Fellow;
  blocks: BlockInfo[];
  onChange: (f: Fellow) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: fellow.id });
  
  const monthsJulDec = ["JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const monthsJanJun = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN"];
  const sortByMonth = (arr: BlockInfo[], months: string[]) =>
    arr
      .slice()
      .sort((a, b) => {
        const ma = months.indexOf(a.key.slice(0, 3));
        const mb = months.indexOf(b.key.slice(0, 3));
        if (ma !== mb) return ma - mb;
        return a.half - b.half;
      });
  const firstHalf = sortByMonth(
    blocks.filter((b) => monthsJulDec.includes(b.key.slice(0, 3))),
    monthsJulDec
  );
  const secondHalf = sortByMonth(
    blocks.filter((b) => monthsJanJun.includes(b.key.slice(0, 3))),
    monthsJanJun
  );
  const settings = loadSettings();
  const firstHalfAllowed = firstHalf.filter((b) => {
    const month = b.key.slice(0, 3);
    // Check July restriction from settings
    if (settings.vacation.julyRestriction && month === "JUL") return false;
    // Check PGY-4 August restriction from settings
    if (settings.vacation.pgy4AugustRestriction && fellow.pgy === "PGY-4" && month === "AUG") return false;
    return true;
  });
  const rowTone =
    fellow.pgy === "PGY-4"
      ? "bg-[hsl(var(--pgy4))] hover:bg-[hsl(var(--pgy4))]"
      : fellow.pgy === "PGY-5"
      ? "bg-[hsl(var(--pgy5))] hover:bg-[hsl(var(--pgy5))]"
      : "bg-[hsl(var(--pgy6))] hover:bg-[hsl(var(--pgy6))]";
  return (
    <TableRow 
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={`animate-fade-in ${rowTone} ${isDragging ? 'opacity-60' : ''}`}
    >
      <TableCell className="w-8">
        <div 
          className="cursor-grab active:cursor-grabbing inline-flex items-center justify-center p-1 rounded hover:bg-background/20"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder row"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
      </TableCell>
      <TableCell className="min-w-[260px]">
        <Input
          className="h-10"
          value={fellow.name}
          placeholder="Name"
          onChange={(e) => onChange({ ...fellow, name: e.target.value })}
        />
      </TableCell>
      <TableCell className="min-w-[140px]">
        <Select
          value={fellow.pgy}
          onValueChange={(v) => onChange({ ...fellow, pgy: v as any })}
        >
          <SelectTrigger>
            <SelectValue placeholder="PGY" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PGY-4">PGY-4</SelectItem>
            <SelectItem value="PGY-5">PGY-5</SelectItem>
            <SelectItem value="PGY-6">PGY-6</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="min-w-[140px]">
        <Select
          value={fellow.clinicDay || ""}
          onValueChange={(v) => onChange({ ...fellow, clinicDay: v as any })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Clinic Day" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Monday">Monday</SelectItem>
            <SelectItem value="Tuesday">Tuesday</SelectItem>
            <SelectItem value="Wednesday">Wednesday</SelectItem>
            <SelectItem value="Thursday">Thursday</SelectItem>
            <SelectItem value="Friday">Friday</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      {[0, 1, 2, 3].map((i) => (
        <TableCell key={i} className="min-w-[160px]">
          <Select
            value={fellow.vacationPrefs[i]}
            onValueChange={(v) => {
              const vp = [...fellow.vacationPrefs];
              vp[i] = v;
              onChange({ ...fellow, vacationPrefs: vp });
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={`Pref ${i + 1}`} />
            </SelectTrigger>
            <SelectContent>
              {(i < 2 ? firstHalfAllowed : secondHalf).map((b) => (
                <SelectItem key={b.key} value={b.key}>
                  {b.key} – {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TableCell>
      ))}
      <TableCell className="text-right">
        <Button variant="ghost" onClick={onRemove}>
          Remove
        </Button>
      </TableCell>
    </TableRow>
  );
}

export default function VacationPreferences() {
  useSEO({
    title: "Vacation Preferences | Cardiology Scheduler",
    description:
      "Configure fellows, academic year, and holidays. Offline-first with auto-save and JSON import/export.",
    canonical: window.location.href,
  });

  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [setup, save] = useSetupState();
  const blocks = useMemo(() => generateAcademicYearBlocks(setup.yearStart), [setup.yearStart]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Auto-generate the 13 holidays whenever the start date changes
  useEffect(() => {
    const defaults = computeAcademicYearHolidays(setup.yearStart);
    save({ ...setup, holidays: defaults });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup.yearStart]);

  const addFellow = () => {
    const id = crypto.randomUUID();
    save({
      ...setup,
      fellows: [
        ...setup.fellows,
        { id, name: "", pgy: "PGY-4", clinicDay: undefined, vacationPrefs: [undefined, undefined, undefined, undefined] },
      ],
    });
  };

  const randomizeVacationPrefs = () => {
    if (setup.fellows.length === 0) {
      toast({ variant: "destructive", title: "No fellows", description: "Add fellows first before randomizing." });
      return;
    }

    const monthsJulDec = ["JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const monthsJanJun = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN"];
    
    const getRandomBlocksForHalf = (months: string[], count: number = 2) => {
      const halfBlocks = blocks.filter((b) => months.includes(b.key.slice(0, 3)));
      const shuffled = [...halfBlocks].sort(() => Math.random() - 0.5);
      return shuffled.slice(0, count).map(b => b.key);
    };

    const settings = loadSettings();
    
    const updatedFellows = setup.fellows.map(fellow => {
      const allowedFirstHalfMonths = monthsJulDec.filter(m => {
        // Check July restriction from settings
        if (settings.vacation.julyRestriction && m === "JUL") return false;
        // Check PGY-4 August restriction from settings
        if (settings.vacation.pgy4AugustRestriction && fellow.pgy === "PGY-4" && m === "AUG") return false;
        return true;
      });
      const firstHalfPrefs = getRandomBlocksForHalf(allowedFirstHalfMonths, 2);
      const secondHalfPrefs = getRandomBlocksForHalf(monthsJanJun, 2);
      
      return {
        ...fellow,
        vacationPrefs: [
          firstHalfPrefs[0],
          firstHalfPrefs[1],
          secondHalfPrefs[0],
          secondHalfPrefs[1]
        ]
      };
    });

    save({ ...setup, fellows: updatedFellows });
    toast({ title: "Randomized", description: `Assigned random vacation preferences to ${setup.fellows.length} fellows.` });
  };

  const updateFellow = (id: string, next: Fellow) => {
    save({
      ...setup,
      fellows: setup.fellows.map((f) => (f.id === id ? next : f)),
    });
  };

  const removeFellow = (id: string) => {
    save({ ...setup, fellows: setup.fellows.filter((f) => f.id !== id) });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = setup.fellows.findIndex((f) => f.id === active.id);
    const newIndex = setup.fellows.findIndex((f) => f.id === over.id);

    const reorderedFellows = arrayMove(setup.fellows, oldIndex, newIndex);
    save({ ...setup, fellows: reorderedFellows });
  };


  const updateHoliday = (id: string, data: Partial<Holiday>) => {
    save({
      ...setup,
      holidays: setup.holidays.map((h) => (h.id === id ? { ...h, ...data } : h)),
    });
  };


  const exportJSON = () => {
    const data = JSON.stringify(setup, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vacation-setup.json";
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Exported", description: "Configuration downloaded." });
  };

  const importJSON = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as AppSetup;
        if (!parsed || !("yearStart" in parsed)) throw new Error("Invalid file");
        save(parsed);
        toast({ title: "Imported", description: "Configuration loaded." });
      } catch (e) {
        toast({ variant: "destructive", title: "Import failed", description: "Invalid JSON file." });
      }
    };
    reader.readAsText(file);
  };

  return (
    <main className="min-h-screen bg-background">
      <section className="container mx-auto px-4 py-10">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold font-display flex items-center gap-2">
              <HeartPulse className="h-6 w-6 text-primary" aria-hidden="true" />
              Vacation Preferences
            </h1>
            <div className="ecg-trace-static mt-2" aria-hidden="true" />
          </div>
          <div className="flex gap-2">
            <Input
              type="file"
              accept="application/json"
              ref={fileRef}
              className="hidden"
              onChange={(e) => importJSON(e.target.files?.[0])}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              Import JSON
            </Button>
            <Button onClick={exportJSON}>Export JSON</Button>
            <Link to="/">
              <Button variant="ghost">Home</Button>
            </Link>
          </div>
        </div>

        <Tabs defaultValue="fellows">
          <TabsList>
            <TabsTrigger value="fellows">Fellows</TabsTrigger>
            <TabsTrigger value="holidays">Holidays</TabsTrigger>
          </TabsList>

          <TabsContent value="fellows" className="mt-6 animate-fade-in">
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="font-display">Fellowship Start Date</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="mb-1 block">Fellowship start date</Label>
                    <Input
                      type="date"
                      value={setup.yearStart}
                      onChange={(e) => save({ ...setup, yearStart: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      Generates 24 two-week blocks (e.g., JUL1, JUL2) used throughout scheduling.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="font-display">Fellows and Vacation Preferences</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex justify-between mb-4">
                  <p className="text-sm text-muted-foreground">
                    Add fellows, set PGY level, and choose their top-two vacation preferences within each 6-month block.
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={randomizeVacationPrefs}>
                      Randomize Prefs
                    </Button>
                    <Button onClick={addFellow}>Add Fellow</Button>
                  </div>
                </div>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead className="w-[260px]">Name</TableHead>
                        <TableHead>PGY</TableHead>
                        <TableHead>Clinic Day</TableHead>
                        <TableHead>Pref 1 (Jul–Dec)</TableHead>
                        <TableHead>Pref 2 (Jul–Dec)</TableHead>
                        <TableHead>Pref 3 (Jan–Jun)</TableHead>
                        <TableHead>Pref 4 (Jan–Jun)</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {setup.fellows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center text-muted-foreground">
                            No fellows yet. Click "Add Fellow" to begin.
                          </TableCell>
                        </TableRow>
                      ) : (
                        <DndContext
                          sensors={sensors}
                          collisionDetection={closestCenter}
                          onDragEnd={handleDragEnd}
                        >
                          <SortableContext
                            items={setup.fellows.map((f) => f.id)}
                            strategy={verticalListSortingStrategy}
                          >
                            {setup.fellows.map((f) => (
                              <FellowRow
                                key={f.id}
                                fellow={f}
                                blocks={blocks}
                                onChange={(next) => updateFellow(f.id, next)}
                                onRemove={() => removeFellow(f.id)}
                              />
                            ))}
                          </SortableContext>
                        </DndContext>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>


          <TabsContent value="holidays" className="mt-6 animate-fade-in">
            <Card>
              <CardHeader>
                <CardTitle className="font-display">Holidays</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex justify-between items-center mb-4">
                  <p className="text-sm text-muted-foreground">
                    These 13 holidays are auto-generated from the Fellowship start date. Edit dates as needed. Changing the start date will reset them.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => save({ ...setup, holidays: computeAcademicYearHolidays(setup.yearStart) })}
                  >
                    Reset to defaults
                  </Button>
                </div>

                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Holiday</TableHead>
                        <TableHead style={{ width: 180 }}>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {setup.holidays.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={2} className="text-center text-muted-foreground">
                            Holidays will appear here based on the start date.
                          </TableCell>
                        </TableRow>
                      ) : (
                        setup.holidays
                          .slice()
                          .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
                          .map((h) => (
                            <TableRow key={h.id}>
                              <TableCell className="font-medium">{h.name}</TableCell>
                              <TableCell>
                                <Input
                                  type="date"
                                  value={h.date}
                                  onChange={(e) => updateHoliday(h.id, { date: e.target.value })}
                                />
                              </TableCell>
                            </TableRow>
                          ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </section>
    </main>
  );
}
