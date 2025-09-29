import { useEffect, useMemo, useState } from "react";
import { HeartPulse, Loader2, RefreshCcw, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useSEO } from "@/lib/seo";
import { buildPrimaryCallSchedule, loadCallSchedule, saveCallSchedule, applyDragAndDrop, type CallSchedule } from "@/lib/call-engine";
import { buildHFSchedule, loadHFSchedule, saveHFSchedule, clearHFSchedule, getEffectiveHFAssignment, type HFSchedule } from "@/lib/hf-engine";
import { buildJeopardySchedule, loadJeopardySchedule, saveJeopardySchedule, clearJeopardySchedule, type JeopardySchedule } from "@/lib/jeopardy-engine";
import { buildClinicSchedule, loadClinicSchedule, saveClinicSchedule, clearClinicSchedule, getClinicAssignmentsForDate, formatClinicAssignments, getClinicNotesForDate, type ClinicSchedule, type ClinicNote } from "@/lib/clinic-engine";
import { loadSchedule, loadSetup, type PGY, type StoredSchedule } from "@/lib/schedule-engine";
import { computeAcademicYearHolidays } from "@/lib/holidays";
import { monthAbbrForIndex } from "@/lib/block-utils";
import { parseISO } from "date-fns";
import PrimaryCallEditDialog from "@/components/PrimaryCallEditDialog";
import HFEditDialog from "@/components/HFEditDialog";
import JeopardyEditDialog from "@/components/JeopardyEditDialog";
import { DraggableBadge } from "@/components/DraggableBadge";
import { DroppableCell } from "@/components/DroppableCell";
import { DroppableCalendarDay } from "@/components/DroppableCalendarDay";
import { 
  DndContext, 
  DragEndEvent, 
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import { useToast } from "@/hooks/use-toast";

export default function CallSchedule() {
  useSEO({
    title: "Primary Call Schedule | Cardiology Scheduler",
    description: "Generate a 365-day primary call schedule with strict eligibility and spacing rules.",
    canonical: window.location.href,
  });

  const setup = loadSetup();
  const fellows = setup?.fellows ?? [];
  const [schedule, setSchedule] = useState<CallSchedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [uncovered, setUncovered] = useState<string[]>([]);
  const [success, setSuccess] = useState<boolean | null>(null);
  const [priorSeeds, setPriorSeeds] = useState<Record<string, string>>({});
  const [editISO, setEditISO] = useState<string | null>(null);
  const [draggedItem, setDraggedItem] = useState<{iso: string; fellowId: string; fellowName: string} | null>(null);
  
  // HF Edit Dialog state
  const [hfEditISO, setHFEditISO] = useState<string | null>(null);
  
  // HF Schedule state
  const [hfSchedule, setHFSchedule] = useState<HFSchedule | null>(null);
  const [hfLoading, setHFLoading] = useState(false);
  const [uncoveredHF, setUncoveredHF] = useState<string[]>([]);
  const [uncoveredHolidays, setUncoveredHolidays] = useState<string[]>([]);
  const [hfSuccess, setHFSuccess] = useState<boolean | null>(null);
  
  // Jeopardy Edit Dialog state
  const [jeopardyEditISO, setJeopardyEditISO] = useState<string | null>(null);
  
  // Jeopardy Schedule state
  const [jeopardySchedule, setJeopardySchedule] = useState<JeopardySchedule | null>(null);
  const [jeopardyLoading, setJeopardyLoading] = useState(false);
  const [uncoveredJeopardy, setUncoveredJeopardy] = useState<string[]>([]);
  const [jeopardySuccess, setJeopardySuccess] = useState<boolean | null>(null);
  
  // Clinic Schedule state
  const [clinicSchedule, setClinicSchedule] = useState<ClinicSchedule | null>(null);
  const [clinicLoading, setClinicLoading] = useState(false);
  const [clinicSuccess, setClinicSuccess] = useState<boolean | null>(null);
  
  const { toast } = useToast();
  const sensors = useSensors(useSensor(PointerSensor, {
    activationConstraint: {
      distance: 8,
    },
  }));

  const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const seedsKey = useMemo(() => (setup?.yearStart ? `cfsa_calls_prior5_v1:${setup.yearStart}` : ""), [setup?.yearStart]);

  const priorDates = useMemo(() => {
    if (!setup?.yearStart) return [] as string[];
    const start = parseISO(setup.yearStart);
    const list: string[] = [];
    for (let i = 5; i >= 1; i--) {
      const d = new Date(start);
      d.setDate(d.getDate() - i);
      list.push(toISO(d));
    }
    return list;
  }, [setup?.yearStart]);

  useEffect(() => {
    const existing = loadCallSchedule();
    if (existing) setSchedule(existing);
    
    const existingHF = loadHFSchedule();
    if (existingHF) setHFSchedule(existingHF);
    
    const existingJeopardy = loadJeopardySchedule();
    if (existingJeopardy) setJeopardySchedule(existingJeopardy);
    
    const existingClinic = loadClinicSchedule();
    if (existingClinic) setClinicSchedule(existingClinic);
  }, []);

  useEffect(() => {
    if (!seedsKey) return;
    try {
      const raw = localStorage.getItem(seedsKey);
      setPriorSeeds(raw ? JSON.parse(raw) : {});
    } catch {
      setPriorSeeds({});
    }
  }, [seedsKey]);

  const updateSeed = (iso: string, fid: string) => {
    const next = { ...priorSeeds, [iso]: fid };
    setPriorSeeds(next);
    try {
      if (seedsKey) localStorage.setItem(seedsKey, JSON.stringify(next));
    } catch {}
  };

  const allDays = useMemo(() => {
    if (!setup?.yearStart) return [] as string[];
    const start = parseISO(setup.yearStart);
    const end = new Date(start.getFullYear() + 1, 5, 30);
    const list: string[] = [];
    let cur = new Date(start);
    while (cur <= end) {
      list.push(toISO(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return list;
  }, [setup?.yearStart]);

  const holidayMap = useMemo(() => {
    if (!setup?.yearStart) return {} as Record<string, string>;
    const map: Record<string, string> = {};
    for (const h of computeAcademicYearHolidays(setup.yearStart)) map[h.date] = h.name;
    return map;
  }, [setup?.yearStart]);

  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const months = useMemo(() => {
    if (!setup?.yearStart) return [] as { label: string; firstWeekday: number; daysInMonth: number; year: number; month: number }[];
    const start = parseISO(setup.yearStart);
    const list: { label: string; firstWeekday: number; daysInMonth: number; year: number; month: number }[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const label = d.toLocaleString(undefined, { month: "long", year: "numeric" });
      const firstWeekday = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      list.push({ label, firstWeekday, daysInMonth, year: d.getFullYear(), month: d.getMonth() });
    }
    return list;
  }, [setup?.yearStart]);
  const fellowById = useMemo(() => Object.fromEntries(fellows.map((f) => [f.id, f] as const)), [fellows]);

  // Assign stable fellow color variants (f1..f15) based on fellows order
  const fellowColorVariants = [
    "f1","f2","f3","f4","f5","f6","f7","f8","f9","f10","f11","f12","f13","f14","f15",
  ] as const;
  const fellowColorById = useMemo(() => {
    const map: Record<string, (typeof fellowColorVariants)[number]> = {};
    fellows.forEach((f, idx) => {
      map[f.id] = fellowColorVariants[idx % fellowColorVariants.length];
    });
    return map;
  }, [fellows]);

  const schedByPGY = useMemo<Record<PGY, StoredSchedule | null>>(
    () => ({
      "PGY-4": loadSchedule("PGY-4"),
      "PGY-5": loadSchedule("PGY-5"),
      "PGY-6": loadSchedule("PGY-6"),
    }),
    []
  );

  const blockKeyForDate = (d: Date) => {
    const abbr = monthAbbrForIndex(d.getMonth());
    const half = d.getDate() <= 15 ? 1 : 2;
    return `${abbr}${half}`;
  };

  const rotationOnDate = (fid?: string, d?: Date) => {
    if (!fid || !d) return undefined;
    const f = fellowById[fid];
    if (!f) return undefined;
    const sched = schedByPGY[f.pgy];
    const row = sched?.byFellow?.[fid];
    if (!row) return undefined;
    return row[blockKeyForDate(d)];
  };

  const isWeekend = (d: Date) => {
    const dow = d.getDay();
    return dow === 0 || dow === 6;
  };

  const lastNameOf = (full?: string) => (full ? full.trim().split(/\s+/).slice(-1)[0] : "");

  const countsSorted = useMemo(() => {
    const entries = Object.entries(schedule?.countsByFellow ?? {});
    return entries
      .map(([fid, n]) => ({
        id: fid,
        n,
        name: fellowById[fid]?.name ?? fid,
        pgy: fellowById[fid]?.pgy ?? "",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [schedule, fellowById]);

  const totalDays = useMemo(() => Object.keys(schedule?.days ?? {}).length, [schedule]);

  const violations = useMemo(() => {
    if (!schedule || !setup) return [] as { iso: string; reason: string; fellow: string }[];
    const list: { iso: string; reason: string; fellow: string }[] = [];
    for (const [iso, fid] of Object.entries(schedule.days)) {
      if (!fid) continue;
      const d = parseISO(iso);
      const rot = rotationOnDate(fid, d);
      const name = fellowById[fid]?.name ?? fid;
      if (rot === "HF") list.push({ iso, reason: "HF rotation assigned to primary", fellow: name });
      const dow = d.getDay();
      if (rot === "EP" && (dow === 2 || dow === 4)) list.push({ iso, reason: "EP rotation assigned on Tue/Thu", fellow: name });
    }
    return list.sort((a, b) => a.iso.localeCompare(b.iso));
  }, [schedule, setup, fellowById, rotationOnDate]);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = buildPrimaryCallSchedule({ priorPrimarySeeds: priorSeeds });
      setSchedule(result.schedule);
      setUncovered(result.uncovered ?? []);
      setSuccess(result.success);
      saveCallSchedule(result.schedule);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setSchedule(null);
    setUncovered([]);
    setSuccess(null);
    try {
      localStorage.removeItem("cfsa_calls_v1");
    } catch {}
  };

  const handleGenerateHF = async () => {
    setHFLoading(true);
    
    // Clear existing schedule to enable reshuffle
    setHFSchedule(null);
    setUncoveredHF([]);
    setUncoveredHolidays([]);
    setHFSuccess(null);
    clearHFSchedule();
    
    try {
      // Get or initialize run counter for this academic year
      const yearKey = `hf_run_counter_${setup?.yearStart || new Date().getFullYear()}`;
      const currentRun = parseInt(localStorage.getItem(yearKey) || "0") + 1;
      localStorage.setItem(yearKey, currentRun.toString());
      
      // Use run counter as seed for randomization on subsequent generations
      const isReshuffle = currentRun > 1;
      
      const result = buildHFSchedule({
        seed: currentRun,
        randomize: isReshuffle,
        attempts: 1
      });
      
      setHFSchedule(result.schedule);
      setUncoveredHF(result.uncovered ?? []);
      setUncoveredHolidays(result.uncoveredHolidays ?? []);
      setHFSuccess(result.success);
      saveHFSchedule(result.schedule);
      
      let errorMessage = "";
      if (result.uncovered.length > 0) {
        errorMessage += `${result.uncovered.length} uncovered weekends`;
      }
      if (result.uncoveredHolidays?.length > 0) {
        if (errorMessage) errorMessage += ", ";
        errorMessage += `${result.uncoveredHolidays.length} uncovered holidays`;
      }
      if (result.mandatoryMissed?.length > 0) {
        if (errorMessage) errorMessage += ", ";
        errorMessage += `${result.mandatoryMissed.length} mandatory assignments missed`;
      }
      
      const actionText = isReshuffle ? "reshuffled" : "generated";
      toast({
        title: result.success ? `HF schedule ${actionText}` : `HF schedule partially ${actionText}`,
        description: result.success 
          ? `Non-holiday weekend coverage ${actionText} successfully. Holiday coverage requires manual assignment.` 
          : `Issues: ${errorMessage}. Holiday coverage requires manual assignment.`,
        variant: result.success ? "default" : "destructive",
      });
      
      // Log mandatory misses for debugging
      if (result.mandatoryMissed?.length > 0) {
        console.warn("Mandatory HF assignments missed:", result.mandatoryMissed);
      }
    } finally {
      setHFLoading(false);
    }
  };

  const handleClearHF = () => {
    setHFSchedule(null);
    setUncoveredHF([]);
    setUncoveredHolidays([]);
    setHFSuccess(null);
    clearHFSchedule();
    toast({
      title: "HF schedule cleared",
      description: "Heart failure coverage has been reset.",
    });
  };

  const handleHFScheduleUpdate = (newSchedule: HFSchedule) => {
    setHFSchedule(newSchedule);
    saveHFSchedule(newSchedule);
    
    // Update coverage summary
    const weekendKeys = Object.keys(newSchedule.weekends);
    const holidayKeys = Object.keys(newSchedule.holidays || {});
    const allWeekends = allDays.filter(d => {
      const date = parseISO(d);
      return date.getDay() === 0 || date.getDay() === 6; // Sunday or Saturday
    });
    const allHolidays = computeAcademicYearHolidays(setup?.yearStart || "");
    const uncoveredWeekends = allWeekends.filter(d => !newSchedule.weekends[d]);
    const uncoveredHols = allHolidays.filter(h => !newSchedule.holidays?.[h.date]).map(h => h.date);
    
    setUncoveredHF(uncoveredWeekends);
    setUncoveredHolidays(uncoveredHols);
    setHFSuccess(uncoveredWeekends.length === 0 && uncoveredHols.length === 0);
    
    toast({
      title: "HF assignment updated",
      description: "Heart failure coverage assignment has been updated.",
    });
  };

  const handleGenerateJeopardy = async () => {
    setJeopardyLoading(true);
    try {
      const result = buildJeopardySchedule();
      setJeopardySchedule(result.schedule);
      setUncoveredJeopardy(result.uncovered);
      setJeopardySuccess(result.success);
      saveJeopardySchedule(result.schedule);
      
      toast({
        title: result.success ? "Jeopardy schedule generated" : "Jeopardy schedule partially generated",
        description: result.success 
          ? "All jeopardy assignments completed successfully." 
          : `${result.uncovered.length} days could not be assigned. Check constraints.`,
        variant: result.success ? "default" : "destructive",
      });
    } finally {
      setJeopardyLoading(false);
    }
  };

  const handleClearJeopardy = () => {
    setJeopardySchedule(null);
    setUncoveredJeopardy([]);
    setJeopardySuccess(null);
    clearJeopardySchedule();
    toast({
      title: "Jeopardy schedule cleared",
      description: "All jeopardy assignments have been reset.",
    });
  };

  const handleJeopardyScheduleUpdate = (newSchedule: JeopardySchedule) => {
    setJeopardySchedule(newSchedule);
    saveJeopardySchedule(newSchedule);
    
    // Update coverage summary
    const assignedDays = Object.keys(newSchedule.days);
    const uncoveredJeopardyDays = allDays.filter(d => !newSchedule.days[d]);
    setUncoveredJeopardy(uncoveredJeopardyDays);
    setJeopardySuccess(uncoveredJeopardyDays.length === 0);
    
    toast({
      title: "Jeopardy assignment updated",
      description: "Jeopardy assignment has been updated.",
    });
  };

  const handleGenerateClinic = async () => {
    setClinicLoading(true);
    setClinicSuccess(null);
    
    try {
      const newSchedule = buildClinicSchedule(schedule, setup);
      if (newSchedule) {
        setClinicSchedule(newSchedule);
        saveClinicSchedule(newSchedule);
        setClinicSuccess(true);
        toast({
          title: "Clinic schedule generated",
          description: "Clinic assignments have been generated successfully.",
        });
      } else {
        setClinicSuccess(false);
        toast({
          title: "Failed to generate clinic schedule",
          description: "Please ensure setup data is complete.",
          variant: "destructive",
        });
      }
    } finally {
      setClinicLoading(false);
    }
  };

  const handleClearClinic = () => {
    setClinicSchedule(null);
    setClinicSuccess(null);
    clearClinicSchedule();
    toast({
      title: "Clinic schedule cleared",
      description: "All clinic assignments have been reset.",
    });
  };

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const [iso, fellowId] = (active.id as string).split('|');
    const fellowName = fellowById[fellowId]?.name ?? fellowId;
    setDraggedItem({ iso, fellowId, fellowName });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setDraggedItem(null);
    
    if (!over || !schedule) return;

    const [sourceISO] = (active.id as string).split('|');
    const targetISO = over.id as string;
    
    if (sourceISO === targetISO) return;

    const result = applyDragAndDrop(schedule, sourceISO, targetISO);
    
    if (result.success && result.schedule) {
      setSchedule(result.schedule);
      saveCallSchedule(result.schedule);
      toast({
        title: "Assignment updated",
        description: "Primary call assignment moved successfully.",
      });
    } else {
      toast({
        title: "Cannot move assignment",
        description: result.error || "The assignment violates scheduling rules.",
        variant: "destructive",
      });
    }
  };

  return (
    <DndContext 
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <main className="min-h-screen bg-background">
        <section className="container mx-auto px-4 py-8">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold font-display flex items-center gap-2">
            <HeartPulse className="h-6 w-6 text-primary" /> Primary Call Schedule
          </h1>
          <div className="flex items-center gap-2">
            <Button onClick={handleGenerate} disabled={loading || !setup}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />} Generate
            </Button>
            <Button variant="outline" onClick={handleClear} disabled={loading}>
              <Trash2 className="h-4 w-4" /> Clear
            </Button>
            <Button onClick={handleGenerateHF} disabled={hfLoading || !setup || !schedule} variant="secondary">
              {hfLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <HeartPulse className="h-4 w-4" />} Generate HF
            </Button>
            <Button variant="outline" onClick={handleClearHF} disabled={hfLoading} size="sm">
              Clear HF
            </Button>
            <Button onClick={handleGenerateJeopardy} disabled={jeopardyLoading || !setup || !schedule} variant="secondary">
              {jeopardyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />} Generate Jeopardy
            </Button>
            <Button variant="outline" onClick={handleClearJeopardy} disabled={jeopardyLoading} size="sm">
              Clear Jeopardy
            </Button>
            <Button onClick={handleGenerateClinic} disabled={clinicLoading || !setup || !schedule} variant="secondary">
              {clinicLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />} Generate Clinics
            </Button>
            <Button variant="outline" onClick={handleClearClinic} disabled={clinicLoading} size="sm">
              Clear Clinics
            </Button>
          </div>
        </header>
        <div className="ecg-trace-static mt-2 mb-6" />

        <Card>
          <CardHeader>
            <CardTitle className="font-display">Coverage Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!setup ? (
              <div className="text-muted-foreground">Please complete Setup and Block schedules first.</div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <div className="text-xs text-muted-foreground">Academic year start</div>
                    <div className="font-medium">{setup.yearStart}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Fellows</div>
                    <div className="font-medium">{fellows.length}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Assigned days</div>
                    <div className="font-medium">{totalDays}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Uncovered days</div>
                    <div className={`font-medium ${success ? "text-primary" : uncovered.length ? "text-destructive" : ""}`}>
                      {uncovered.length}
                    </div>
                  </div>
                </div>
                
                {/* HF Schedule Summary */}
                {hfSchedule && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t">
                    <div>
                      <div className="text-xs text-muted-foreground">HF weekends</div>
                      <div className="font-medium">{Object.keys(hfSchedule.weekends).length}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">HF holidays</div>
                      <div className="font-medium">{Object.keys(hfSchedule.holidays || {}).length}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Uncovered weekends</div>
                      <div className={`font-medium ${uncoveredHF.length ? "text-destructive" : "text-primary"}`}>
                        {uncoveredHF.length}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Uncovered holidays</div>
                      <div className={`font-medium ${uncoveredHolidays.length ? "text-destructive" : "text-primary"}`}>
                        {uncoveredHolidays.length}
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Jeopardy Schedule Summary */}
                {jeopardySchedule && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t">
                    <div>
                      <div className="text-xs text-muted-foreground">Jeopardy days</div>
                      <div className="font-medium">{Object.keys(jeopardySchedule.days).length}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Weekdays</div>
                      <div className="font-medium">{Object.values(jeopardySchedule.weekdayCountsByFellow).reduce((a, b) => a + b, 0)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Weekends</div>
                      <div className="font-medium">{Object.values(jeopardySchedule.weekendCountsByFellow).reduce((a, b) => a + b, 0)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Uncovered</div>
                      <div className={`font-medium ${uncoveredJeopardy.length ? "text-destructive" : "text-primary"}`}>
                        {uncoveredJeopardy.length}
                      </div>
                    </div>
                  </div>
                )}
                {typeof success === "boolean" && (
                  <div className={`text-sm ${success ? "text-primary" : "text-destructive"}`}>
                    {success ? "Complete coverage achieved." : "Some days could not be assigned under strict rules."}
                  </div>
                )}


                {uncovered.length > 0 && (
                  <div className="mt-6">
                    <div className="text-sm font-medium mb-1">Uncovered dates</div>
                    <div className="text-sm text-muted-foreground break-words">
                      {uncovered.join(", ")}
                    </div>
                  </div>
                )}

                {violations.length > 0 && (
                  <div className="mt-6">
                    <div className="text-sm font-medium mb-1 text-destructive">Rule violations</div>
                    <div className="text-sm text-muted-foreground space-y-1">
                      {violations.map((v) => (
                        <div key={`${v.iso}-${v.fellow}`}>{v.iso}: {v.fellow} — {v.reason}</div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="font-display">Prior 5 primary call assignments (pre-seed)</CardTitle>
          </CardHeader>
          <CardContent>
            {!setup ? (
              <div className="text-muted-foreground">Please complete Setup first.</div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {priorDates.map((iso) => (
                  <div key={iso} className="flex items-center gap-3">
                    <div className="w-28 text-sm text-muted-foreground">{iso}</div>
                    <Select value={priorSeeds[iso] ?? ""} onValueChange={(v) => updateSeed(iso, v)}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select fellow" />
                      </SelectTrigger>
                      <SelectContent>
                        {fellows.map((f) => (
                          <SelectItem key={f.id} value={f.id}>
                            {f.name} ({f.pgy})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="font-display">Schedule</CardTitle>
          </CardHeader>
          <CardContent>
            {!setup ? (
              <div className="text-muted-foreground">Please complete Setup first.</div>
            ) : (
              <>
                <Tabs defaultValue="table">
                <TabsList>
                  <TabsTrigger value="table">Table</TabsTrigger>
                  <TabsTrigger value="calendar">Calendar</TabsTrigger>
                </TabsList>
                <TabsContent value="table">
<Table containerClassName="mt-4 max-h-[70vh] overflow-auto">
  <TableHeader>
    <TableRow>
      <TableHead className="sticky top-0 z-[1] bg-background">Date</TableHead>
      <TableHead className="sticky top-0 z-[1] bg-background">Day</TableHead>
      <TableHead className="sticky top-0 z-[1] bg-background">Holiday</TableHead>
      <TableHead className="sticky top-0 z-[1] bg-background">Primary</TableHead>
      <TableHead className="sticky top-0 z-[1] bg-background">Jeopardy</TableHead>
      <TableHead className="sticky top-0 z-[1] bg-background">HF coverage</TableHead>
      <TableHead className="sticky top-0 z-[1] bg-background">HF fellow</TableHead>
      <TableHead className="sticky top-0 z-[1] bg-background">Vacation</TableHead>
      <TableHead className="sticky top-0 z-[1] bg-background">Clinic</TableHead>
      <TableHead className="sticky top-0 z-[1] bg-background">Clinic Notes</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {allDays.map((iso) => {
      const d = parseISO(iso);
      const dow = weekdays[d.getDay()];
      const fid = schedule?.days?.[iso];
      const rot = rotationOnDate(fid, d);
      const hol = holidayMap[iso] ?? "";
      const weekend = isWeekend(d);
      const rowClass = hol
        ? "bg-[hsl(var(--holiday))]"
        : weekend
        ? "bg-muted/70"
        : "";
      const primaryName = fid ? `${fellowById[fid]?.name ?? fid}${rot ? ` (${rot})` : ""}` : "—";
      const blockKey = blockKeyForDate(d);
      // Get HF assignment for this weekend (if it's a weekend)
      const getWeekendStart = (date: Date): string => {
        const day = date.getDay();
        if (day === 6) return toISO(date); // Saturday
        if (day === 0) return toISO(new Date(date.getTime() - 24 * 60 * 60 * 1000)); // Sunday -> previous Saturday
        return ""; // Not a weekend
      };
      
      const weekendStartISO = getWeekendStart(d);
      const hfAssignedId = weekendStartISO && hfSchedule?.weekends?.[weekendStartISO];
      
      const hfIds = fellows
        .filter((f) => schedByPGY[f.pgy]?.byFellow?.[f.id]?.[blockKey] === "HF")
        .map((f) => f.id);
      const vacIds = fellows
        .filter((f) => schedByPGY[f.pgy]?.byFellow?.[f.id]?.[blockKey] === "VAC")
        .map((f) => f.id);
      return (
        <TableRow key={iso} className={rowClass}>
          <TableCell>{iso}</TableCell>
          <TableCell>{dow}</TableCell>
          <TableCell>{hol}</TableCell>
          <DroppableCell id={iso}>
            {schedule ? (
              fid ? (
                <DraggableBadge
                  id={`${iso}|${fid}`}
                  variant={fellowColorById[fid]}
                  onClick={() => setEditISO(iso)}
                >
                  {primaryName}
                </DraggableBadge>
              ) : (
                <Button variant="link" size="sm" onClick={() => setEditISO(iso)}>Assign</Button>
              )
            ) : (
              fid ? <Badge variant={fellowColorById[fid]}>{primaryName}</Badge> : "—"
            )}
          </DroppableCell>
          <TableCell>
            {(() => {
              const jeopardyId = jeopardySchedule?.days?.[iso];
              if (jeopardyId) {
                const jeopardyRot = rotationOnDate(jeopardyId, d);
                return (
                  <Badge 
                    variant={fellowColorById[jeopardyId]} 
                    className="cursor-pointer hover:opacity-80"
                    onClick={() => setJeopardyEditISO(iso)}
                  >
                    {fellowById[jeopardyId]?.name ?? jeopardyId}{jeopardyRot ? ` (${jeopardyRot})` : ""}
                  </Badge>
                );
              }
              return (
                <Button 
                  variant="link" 
                  size="sm" 
                  className="text-xs h-auto p-0"
                  onClick={() => setJeopardyEditISO(iso)}
                >
                  Assign
                </Button>
              );
            })()}
          </TableCell>
          <TableCell>
            {(() => {
              // Get effective HF assignment (considering day overrides)
              const effectiveAssignment = getEffectiveHFAssignment(iso, hfSchedule);
              
              if (effectiveAssignment) {
                const isHoliday = (() => {
                  if (hfSchedule?.holidays) {
                    for (const [blockStart, blockData] of Object.entries(hfSchedule.holidays)) {
                      const [fellowId, ...dates] = blockData;
                      if (dates.includes(iso) && fellowId === effectiveAssignment) {
                        return true;
                      }
                    }
                  }
                  return false;
                })();
                
                const hfRot = rotationOnDate(effectiveAssignment, d);
                return (
                  <Badge 
                    variant={fellowColorById[effectiveAssignment]} 
                    className={`cursor-pointer hover:opacity-80 ${isHoliday ? "bg-red-100 text-red-800 border-red-300" : "bg-orange-100 text-orange-800 border-orange-300"}`}
                    onClick={() => setHFEditISO(iso)}
                  >
                    {fellowById[effectiveAssignment]?.name ?? effectiveAssignment}{hfRot ? ` (${hfRot})` : ""} {isHoliday ? "(Holiday)" : ""}
                  </Badge>
                );
              }
              
              // Show "Assign HF" link for weekends or holidays without coverage
              if (weekend || holidayMap[iso]) {
                return (
                  <Button 
                    variant="link" 
                    size="sm" 
                    className="text-xs h-auto p-0"
                    onClick={() => setHFEditISO(iso)}
                  >
                    Assign HF
                  </Button>
                );
              }
              
              return "";
            })()}
          </TableCell>
          <TableCell>
            {hfIds.length ? (
              <div className="flex flex-wrap gap-1">
                {hfIds.map((id) => (
                  <Badge key={id} variant={fellowColorById[id]}>
                    {fellowById[id]?.name ?? id}
                  </Badge>
                ))}
              </div>
            ) : (
              "—"
            )}
          </TableCell>
          <TableCell>
            {vacIds.length ? (
              <div className="flex flex-wrap gap-1">
                {vacIds.map((id) => (
                  <Badge key={id} variant={fellowColorById[id]}>
                    {fellowById[id]?.name ?? id}
                  </Badge>
                ))}
              </div>
            ) : (
              "—"
            )}
          </TableCell>
          <TableCell>
            {(() => {
              const clinicAssignments = getClinicAssignmentsForDate(clinicSchedule, iso);
              const formattedClinics = formatClinicAssignments(clinicAssignments);
              
              if (formattedClinics) {
                return (
                  <div className="flex flex-wrap gap-1">
                    {clinicAssignments.map((assignment, index) => (
                      <Badge 
                        key={index} 
                        variant={fellowColorById[assignment.fellowId]}
                        className="text-xs"
                      >
                        {fellowById[assignment.fellowId]?.name ?? assignment.fellowId}: {assignment.clinicType === "GENERAL" ? "Gen" : assignment.clinicType === "HEART_FAILURE" ? "HF" : assignment.clinicType === "ACHD" ? "ACHD" : assignment.clinicType === "DEVICE" ? "Dev" : "EP"}
                      </Badge>
                    ))}
                  </div>
                );
              }
              
              return "—";
            })()}
          </TableCell>
          <TableCell>
            {(() => {
              const fellowsWithClinicDays = fellows.map(f => ({
                id: f.id,
                name: f.name,
                pgy: f.pgy,
                preferredClinicDay: f.clinicDay || ''
              }));
              const clinicNotes = getClinicNotesForDate(iso, fellowsWithClinicDays, schedule, clinicSchedule, setup);
              
              if (clinicNotes.length > 0) {
                return (
                  <div className="flex flex-wrap gap-1">
                    {clinicNotes.map((note, index) => (
                      <Badge 
                        key={index} 
                        variant={fellowColorById[note.fellowId]}
                        className="text-xs"
                      >
                        {fellowById[note.fellowId]?.name ?? note.fellowId}: {note.reason}
                      </Badge>
                    ))}
                  </div>
                );
              }
              
              return "—";
            })()}
          </TableCell>
        </TableRow>
      );
    })}
  </TableBody>
</Table>
                </TabsContent>
                <TabsContent value="calendar">
                  <div className="mt-4 grid gap-6">
                    {months.map((m, idx) => (
                      <div key={idx}>
                        <div className="text-sm font-medium mb-2">{m.label}</div>
                        <div className="grid grid-cols-7 gap-2">
                          {Array.from({ length: m.firstWeekday }).map((_, i) => (
                            <div key={`e-${i}`} className="h-20 rounded-md bg-muted/30" />
                          ))}
{Array.from({ length: m.daysInMonth }).map((_, i) => {
  const day = i + 1;
  const iso = toISO(new Date(m.year, m.month, day));
  const fid = schedule?.days?.[iso];
  const name = fid ? (fellowById[fid]?.name ?? fid) : "";
  const last = lastNameOf(name) || "—";
  const hol = holidayMap[iso];
  const weekend = isWeekend(new Date(m.year, m.month, day));
  const cellBg = hol ? "bg-[hsl(var(--holiday))]" : weekend ? "bg-muted/70" : "bg-card";
  const rot = rotationOnDate(fid, new Date(m.year, m.month, day));
  
  // Get HF assignment for this date
  const hfAssignment = hfSchedule ? getEffectiveHFAssignment(iso, hfSchedule) : null;
  const hfFellow = hfAssignment ? fellowById[hfAssignment] : null;
  const hfLastName = hfFellow ? lastNameOf(hfFellow.name) : null;
  
  // Show HF assignment on weekends and holidays
  const showHF = (weekend || hol) && hfSchedule;
  
  return (
    <DroppableCalendarDay key={iso} id={iso} className={`h-20 rounded-md border ${cellBg} p-2 text-xs relative`}>
      <div className="font-medium">{day}</div>
      {hol && <div className="text-[0.65rem] text-red-600 truncate">{hol}</div>}
      
      {/* HF designation in top-right corner */}
      {showHF && (
        <div className="absolute top-1 right-1">
          {hfAssignment ? (
            <Badge 
              variant="outline" 
              className="text-[0.5rem] px-1 py-0 h-4 cursor-pointer hover:bg-primary/10" 
              onClick={() => setHFEditISO(iso)}
            >
              HF:{hfLastName}
            </Badge>
          ) : (
            <Button 
              variant="ghost" 
              size="sm" 
              className="text-[0.5rem] h-4 px-1 py-0 text-muted-foreground hover:text-primary" 
              onClick={() => setHFEditISO(iso)}
            >
              HF:?
            </Button>
          )}
        </div>
      )}
      
      {/* Primary call assignment */}
      {schedule && fid ? (
        <div className="mt-1">
          <DraggableBadge
            id={`${iso}|${fid}`}
            variant={fellowColorById[fid]}
            onClick={() => setEditISO(iso)}
          >
            <span className="text-[0.6rem] px-1 py-0">
              {`${last}${rot ? ` (${rot})` : ""}`}
            </span>
          </DraggableBadge>
        </div>
      ) : schedule ? (
        <Button variant="link" size="sm" className="mt-1 h-4 text-[0.6rem] p-0" onClick={() => setEditISO(iso)}>
          Assign
        </Button>
      ) : (
        fid && (
          <Badge variant={fellowColorById[fid]} className="text-[0.6rem] px-1 py-0 mt-1">
            {`${last}${rot ? ` (${rot})` : ""}`}
          </Badge>
        )
      )}
    </DroppableCalendarDay>
  );
})}
                        </div>
                      </div>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
              {editISO && schedule && (
                <PrimaryCallEditDialog
                  iso={editISO}
                  schedule={schedule}
                  onClose={() => setEditISO(null)}
                  onApply={(updated) => {
                    setSchedule(updated);
                    saveCallSchedule(updated);
                    const newUncovered = allDays.filter((d) => !updated.days[d]);
                    setUncovered(newUncovered);
                    setSuccess(newUncovered.length === 0);
                    setEditISO(null);
                  }}
                />
              )}
              
              {hfEditISO && hfSchedule && (
                <HFEditDialog
                  open={true}
                  onOpenChange={(open) => !open && setHFEditISO(null)}
                  dateISO={hfEditISO}
                  fellows={fellows}
                  schedule={hfSchedule}
                  onUpdate={handleHFScheduleUpdate}
                />
              )}
              
              {jeopardyEditISO && (
                <JeopardyEditDialog
                  iso={jeopardyEditISO}
                  schedule={jeopardySchedule}
                  open={true}
                  onClose={() => setJeopardyEditISO(null)}
                  onApply={handleJeopardyScheduleUpdate}
                />
              )}
              </>
            )}
          </CardContent>
        </Card>

        <DragOverlay>
          {draggedItem ? (
            <Badge variant="default" className="opacity-90">
              {draggedItem.fellowName}
            </Badge>
          ) : null}
        </DragOverlay>
      </section>
    </main>
    </DndContext>
  );
}
