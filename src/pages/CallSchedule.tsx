import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { HeartPulse, Loader2, RefreshCcw, Trash2, CheckCircle, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useSEO } from "@/lib/seo";
import { buildPrimaryCallSchedule, loadCallSchedule, saveCallSchedule, saveCoverageMetadata, loadCoverageMetadata, clearCoverageMetadata, applyDragAndDrop, type CallSchedule } from "@/lib/call-engine";
import { loadSettings } from "@/lib/settings-engine";
import { buildHFSchedule, loadHFSchedule, saveHFSchedule, clearHFSchedule, getEffectiveHFAssignment, analyzeHFSchedule, type HFSchedule } from "@/lib/hf-engine";
import { buildJeopardySchedule, loadJeopardySchedule, saveJeopardySchedule, clearJeopardySchedule, type JeopardySchedule } from "@/lib/jeopardy-engine";
import { buildClinicSchedule, loadClinicSchedule, saveClinicSchedule, clearClinicSchedule, getClinicAssignmentsForDate, formatClinicAssignments, getClinicNotesForDate, checkSpecialtyClinicCoverage, getFellowRotationOnDate, type ClinicSchedule, type ClinicNote, type ClinicCoverageGap } from "@/lib/clinic-engine";
import { getPrimaryRotation } from "@/lib/rotation-engine";
import { loadSchedule, loadSetup, type PGY, type StoredSchedule } from "@/lib/schedule-engine";
import { computeAcademicYearHolidays } from "@/lib/holidays";
import { monthAbbrForIndex } from "@/lib/block-utils";
import { parseISO, format } from "date-fns";
import ExcelJS from 'exceljs';
import PrimaryCallEditDialog from "@/components/PrimaryCallEditDialog";
import HFEditDialog from "@/components/HFEditDialog";
import JeopardyEditDialog from "@/components/JeopardyEditDialog";
import AmbulatoryEditDialog from "@/components/AmbulatoryEditDialog";
import ClinicEditDialog from "@/components/ClinicEditDialog";
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
import { usePersistentTab } from "@/hooks/use-persistent-tab";
import { useTabScrollRestoration } from "@/hooks/use-tab-scroll-restoration";

export default function CallSchedule() {
  const location = useLocation();
  
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
  
  // Cache block schedules to improve dialog performance
  const [cachedSchedules, setCachedSchedules] = useState<Record<PGY, StoredSchedule | null> | null>(null);
  
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
  
  // Ambulatory Edit Dialog state
  const [ambulatoryEditISO, setAmbulatoryEditISO] = useState<string | null>(null);
  
  // Clinic Edit Dialog state
  const [clinicEditISO, setClinicEditISO] = useState<string | null>(null);
  const [clinicEditIndex, setClinicEditIndex] = useState<number | null>(null);
  const [clinicEditMode, setClinicEditMode] = useState<'edit' | 'add'>('edit');
  
  // Jeopardy Schedule state
  const [jeopardySchedule, setJeopardySchedule] = useState<JeopardySchedule | null>(null);
  const [jeopardyLoading, setJeopardyLoading] = useState(false);
  const [uncoveredJeopardy, setUncoveredJeopardy] = useState<string[]>([]);
  const [jeopardySuccess, setJeopardySuccess] = useState<boolean | null>(null);
  
  // Clinic Schedule state
  const [clinicSchedule, setClinicSchedule] = useState<ClinicSchedule | null>(null);
  const [clinicLoading, setClinicLoading] = useState(false);
  const [clinicSuccess, setClinicSuccess] = useState<boolean | null>(null);
  const [clinicCheckLoading, setClinicCheckLoading] = useState(false);
  const [clinicCoverageGaps, setClinicCoverageGaps] = useState<ClinicCoverageGap[]>([]);
  const [exporting, setExporting] = useState(false);
  
  const { toast } = useToast();
  const [activeScheduleView, setActiveScheduleView] = usePersistentTab('callSchedule-view', 'table');
  
  useTabScrollRestoration(location.pathname, activeScheduleView);
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
    
    const metadata = loadCoverageMetadata();
    if (metadata) {
      setUncovered(metadata.uncovered);
      setSuccess(metadata.success);
    }
    
    const existingHF = loadHFSchedule();
    if (existingHF) setHFSchedule(existingHF);
    
    const existingJeopardy = loadJeopardySchedule();
    if (existingJeopardy) setJeopardySchedule(existingJeopardy);
    
    const existingClinic = loadClinicSchedule();
    if (existingClinic) setClinicSchedule(existingClinic);
    
    // Load block schedules once for performance optimization
    setCachedSchedules({
      "PGY-4": loadSchedule("PGY-4"),
      "PGY-5": loadSchedule("PGY-5"),
      "PGY-6": loadSchedule("PGY-6"),
    });
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

  // Calculate HF uncovered state when schedule loads or changes
  useEffect(() => {
    if (!hfSchedule || !setup?.yearStart || allDays.length === 0) return;
    
    // Get all Saturdays (weekend starts)
    const allWeekendStarts = allDays.filter(d => {
      const date = parseISO(d);
      return date.getDay() === 6; // Saturday
    });
    const uncoveredWeekends = allWeekendStarts.filter(d => !hfSchedule.weekends[d]);
    
    // Calculate uncovered holidays
    const allHolidays = computeAcademicYearHolidays(setup.yearStart);
    const uncoveredHols = allHolidays.filter(h => !hfSchedule.holidays?.[h.date]).map(h => h.date);
    
    setUncoveredHF(uncoveredWeekends);
    setUncoveredHolidays(uncoveredHols);
    setHFSuccess(uncoveredWeekends.length === 0 && uncoveredHols.length === 0);
  }, [hfSchedule, setup?.yearStart, allDays]);

  // Calculate Jeopardy uncovered state when schedule loads or changes
  useEffect(() => {
    if (!jeopardySchedule || allDays.length === 0) return;
    
    const uncoveredDays = allDays.filter(d => !jeopardySchedule.days[d]);
    setUncoveredJeopardy(uncoveredDays);
    setJeopardySuccess(uncoveredDays.length === 0);
  }, [jeopardySchedule, allDays]);

  // Calculate Clinic coverage gaps when schedule loads or changes
  useEffect(() => {
    if (!clinicSchedule || !setup) return;
    
    const result = checkSpecialtyClinicCoverage(clinicSchedule, setup);
    setClinicCoverageGaps(result.gaps);
    setClinicSuccess(result.success);
  }, [clinicSchedule, setup]);

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
    
    // Load settings to check configured exclusions
    const settings = loadSettings();
    const list: { iso: string; reason: string; fellow: string }[] = [];
    
    for (const [iso, fid] of Object.entries(schedule.days)) {
      if (!fid) continue;
      const d = parseISO(iso);
      const rot = rotationOnDate(fid, d);
      const name = fellowById[fid]?.name ?? fid;
      
      // Check if this rotation is in the excluded rotations list
      if (settings.primaryCall.excludeRotations.includes(rot)) {
        list.push({ 
          iso, 
          reason: `${rot} rotation assigned to primary call`, 
          fellow: name 
        });
      }
      
      // Check EP-specific day exclusions
      const dow = d.getDay();
      if (rot === "EP" && settings.primaryCall.excludeEPOnDays.includes(dow)) {
        const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        list.push({ 
          iso, 
          reason: `EP rotation assigned on ${dayNames[dow]}`, 
          fellow: name 
        });
      }
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
      saveCoverageMetadata({ uncovered: result.uncovered ?? [], success: result.success });
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
      clearCoverageMetadata();
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

  const handleAmbulatoryScheduleUpdate = (newSchedule: ClinicSchedule) => {
    setClinicSchedule(newSchedule);
    saveClinicSchedule(newSchedule);
    setAmbulatoryEditISO(null);
    toast({
      title: "Ambulatory assignment updated",
      description: "The ambulatory fellow assignment has been updated successfully.",
    });
  };

  const handleClinicScheduleUpdate = (newSchedule: ClinicSchedule) => {
    setClinicSchedule(newSchedule);
    saveClinicSchedule(newSchedule);
    
    // Recalculate coverage gaps after edit
    if (setup) {
      const result = checkSpecialtyClinicCoverage(newSchedule, setup);
      setClinicCoverageGaps(result.gaps);
      setClinicSuccess(result.success);
    }
    
    setClinicEditISO(null);
    setClinicEditIndex(null);
  };

  const handleClinicEdit = (iso: string, index: number) => {
    setClinicEditISO(iso);
    setClinicEditIndex(index);
    setClinicEditMode('edit');
  };

  const handleClinicAdd = (iso: string) => {
    setClinicEditISO(iso);
    setClinicEditIndex(null);
    setClinicEditMode('add');
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
    setClinicCoverageGaps([]);
    clearClinicSchedule();
    toast({
      title: "Clinic schedule cleared",
      description: "All clinic assignments have been reset.",
    });
  };

  const handleCheckClinic = () => {
    if (!clinicSchedule) {
      toast({
        title: "No clinic schedule",
        description: "Please generate clinic assignments first.",
        variant: "destructive",
      });
      return;
    }

    setClinicCheckLoading(true);
    
    try {
      const result = checkSpecialtyClinicCoverage(clinicSchedule, setup);
      setClinicCoverageGaps(result.gaps);
      
      if (result.success) {
        toast({
          title: "All specialty clinics covered",
          description: "All required specialty clinic assignments are in place.",
        });
      } else {
        const clinicTypeNames = {
          ACHD: "ACHD",
          HEART_FAILURE: "HF", 
          DEVICE: "Device",
          EP: "EP",
          GENERAL: "General",
          AMBULATORY_FELLOW: "Ambulatory Fellow"
        };
        
        // Group gaps by clinic type and show specific dates
        const gapsByType = result.gaps.reduce((acc, gap) => {
          const typeName = clinicTypeNames[gap.clinicType];
          if (!acc[typeName]) {
            acc[typeName] = [];
          }
          acc[typeName].push(gap.date);
          return acc;
        }, {} as Record<string, string[]>);
        
        const gapMessages = Object.entries(gapsByType).map(([type, dates]) => {
          const formattedDates = dates.map(dateISO => {
            const date = parseISO(dateISO);
            return date.toLocaleDateString('en-US', { 
              weekday: 'short', 
              month: 'short', 
              day: 'numeric' 
            });
          }).join(", ");
          return `${type} clinic missing on: ${formattedDates}`;
        });
        
        toast({
          title: "Coverage gaps found",
          description: gapMessages.join(" | "),
          variant: "destructive",
        });
      }
    } finally {
      setClinicCheckLoading(false);
    }
  };

  const handleExportExcel = async () => {
    if (!schedule || !setup) {
      toast({
        title: "Export Error",
        description: "No schedule data available to export.",
        variant: "destructive",
      });
      return;
    }

    setExporting(true);
    try {
      // Helper functions
      const hslToHex = (h: number, s: number, l: number): string => {
        l /= 100;
        const a = s * Math.min(l, 1 - l) / 100;
        const f = (n: number) => {
          const k = (n + h / 30) % 12;
          const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
          return Math.round(255 * color).toString(16).padStart(2, '0');
        };
        return `${f(0)}${f(8)}${f(4)}`;
      };

      // Extract real fellowship colors from CSS variables
      const getFellowshipColor = (variant: string): string => {
        const fellowColorMap: Record<string, string> = {
          'f1': hslToHex(0, 75, 80),      // --fellow-1 
          'f2': hslToHex(20, 80, 80),     // --fellow-2
          'f3': hslToHex(35, 85, 80),     // --fellow-3
          'f4': hslToHex(50, 85, 78),     // --fellow-4
          'f5': hslToHex(70, 65, 78),     // --fellow-5
          'f6': hslToHex(90, 55, 78),     // --fellow-6
          'f7': hslToHex(120, 55, 78),    // --fellow-7
          'f8': hslToHex(150, 55, 78),    // --fellow-8
          'f9': hslToHex(170, 60, 78),    // --fellow-9
          'f10': hslToHex(190, 65, 80),   // --fellow-10
          'f11': hslToHex(210, 70, 80),   // --fellow-11
          'f12': hslToHex(230, 70, 80),   // --fellow-12
          'f13': hslToHex(250, 70, 80),   // --fellow-13
          'f14': hslToHex(270, 65, 80),   // --fellow-14
          'f15': hslToHex(300, 70, 80),   // --fellow-15
        };
        return fellowColorMap[variant] || 'E2E8F0';
      };

      // Create workbook
      const workbook = new ExcelJS.Workbook();
      
      // Tab 1: Primary Call Schedule
      const scheduleSheet = workbook.addWorksheet('Primary Call Schedule');
      scheduleSheet.columns = [
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Day', key: 'day', width: 10 },
        { header: 'Holiday', key: 'holiday', width: 15 },
        { header: 'Primary', key: 'primary', width: 20 },
        { header: 'Jeopardy', key: 'jeopardy', width: 20 },
        { header: 'HF Coverage', key: 'hfCoverage', width: 15 },
        { header: 'HF Fellow', key: 'hfFellow', width: 20 },
        { header: 'Vacation', key: 'vacation', width: 30 },
        { header: 'Clinic', key: 'clinic', width: 30 },
        { header: 'Clinic Notes', key: 'clinicNotes', width: 20 },
        { header: 'Ambulatory Fellow', key: 'ambulatoryFellow', width: 20 }
      ];

      // Style headers
      scheduleSheet.getRow(1).font = { bold: true };
      scheduleSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2E8F0' } };

      // Add schedule data
      const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const holidayMap = computeAcademicYearHolidays(setup.yearStart).reduce((acc, h) => {
        acc[h.date] = h.name;
        return acc;
      }, {} as Record<string, string>);

      allDays.forEach((iso, index) => {
        const d = parseISO(iso);
        const dow = weekdays[d.getDay()];
        const fid = schedule.days?.[iso];
        const holiday = holidayMap[iso] ?? "";
        const weekend = d.getDay() === 0 || d.getDay() === 6;
        
        const primaryFellow = fid ? fellowById[fid] : null;
        const jeopardyId = jeopardySchedule?.days?.[iso];
        const jeopardyFellow = jeopardyId ? fellowById[jeopardyId] : null;
        
        // Get HF assignment - use the same weekend detection logic as UI
        const getWeekendStart = (date: Date): string => {
          const day = date.getDay();
          if (day === 6) return iso; // Saturday
          if (day === 0) return format(new Date(date.getTime() - 24 * 60 * 60 * 1000), 'yyyy-MM-dd'); // Sunday -> previous Saturday
          return ""; // Not a weekend
        };
        const weekendStartISO = getWeekendStart(d);
        const hfAssignedId = weekendStartISO && hfSchedule?.weekends?.[weekendStartISO];
        const hfFellow = hfAssignedId ? fellowById[hfAssignedId] : null;

        // Get vacation fellows - use proper block key calculation
        const blockKey = blockKeyForDate(d);
        const vacationFellows = fellows.filter(f => {
          const schedPGY = schedByPGY[f.pgy];
          return schedPGY?.byFellow?.[f.id]?.[blockKey] === "VAC";
        }).map(f => f.name);

        // Get clinic assignments
        const clinicAssignments = clinicSchedule?.days?.[iso] || [];
        const clinicText = clinicAssignments.map(a => {
          const fellow = fellowById[a.fellowId];
          return `${fellow?.name || a.fellowId} (${a.clinicType})`;
        }).join(', ');

        // Get clinic notes
        const fellowsWithClinicDays = fellows.map(f => ({
          id: f.id,
          name: f.name,
          pgy: f.pgy,
          preferredClinicDay: f.clinicDay || ''
        }));
        const clinicNotes = getClinicNotesForDate(iso, fellowsWithClinicDays, schedule, clinicSchedule, setup);
        const clinicNotesText = clinicNotes.map(note => {
          const fellow = fellowById[note.fellowId];
          return `${fellow?.name}: ${note.reason}`;
        }).join('; ');

        const row = scheduleSheet.addRow({
          date: iso,
          day: dow,
          holiday: holiday,
          primary: primaryFellow ? primaryFellow.name : '—',
          jeopardy: jeopardyFellow ? jeopardyFellow.name : '—',
          hfCoverage: (() => {
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
              const fellow = fellowById[effectiveAssignment];
              return fellow ? `${fellow.name}${isHoliday ? ' (Holiday)' : ''}` : effectiveAssignment;
            }
            return '—';
          })(),
          hfFellow: (() => {
            const hfIds = fellows
              .filter((f) => schedByPGY[f.pgy]?.byFellow?.[f.id]?.[blockKey] === "HF")
              .map((f) => f.id);
            return hfIds.length ? hfIds.map(id => fellowById[id]?.name ?? id).join(', ') : '—';
          })(),
          vacation: vacationFellows.join(', '),
          clinic: clinicText,
          clinicNotes: clinicNotesText,
          ambulatoryFellow: (() => {
            const ambulatoryFellowId = clinicSchedule?.ambulatoryAssignments?.[iso];
            return ambulatoryFellowId ? (fellowById[ambulatoryFellowId]?.name ?? ambulatoryFellowId) : '—';
          })()
        });

        // Apply colors and formatting
        if (holiday) {
          row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEE2E2' } }; // Red background for holidays
        } else if (weekend) {
          row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } }; // Light background for weekends
        }

        // Color primary fellow cell
        if (primaryFellow && fellowColorById[primaryFellow.id]) {
          const colorHex = getFellowshipColor(fellowColorById[primaryFellow.id]);
          row.getCell('primary').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorHex } };
        }

        // Color jeopardy fellow cell
        if (jeopardyFellow && fellowColorById[jeopardyFellow.id]) {
          const colorHex = getFellowshipColor(fellowColorById[jeopardyFellow.id]);
          row.getCell('jeopardy').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorHex } };
        }

        // Color HF fellow cell
        if (hfFellow && fellowColorById[hfFellow.id]) {
          const colorHex = getFellowshipColor(fellowColorById[hfFellow.id]);
          row.getCell('hfFellow').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorHex } };
        }

        // Color ambulatory fellow cell
        const ambulatoryFellowId = clinicSchedule?.ambulatoryAssignments?.[iso];
        if (ambulatoryFellowId && fellowColorById[ambulatoryFellowId]) {
          const colorHex = getFellowshipColor(fellowColorById[ambulatoryFellowId]);
          row.getCell('ambulatoryFellow').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorHex } };
        }
      });

      // Add borders to all cells
      scheduleSheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        });
      });

      // Tab 2: Primary Call Statistics
      const primaryStatsSheet = workbook.addWorksheet('Primary Call Statistics');
      primaryStatsSheet.columns = [
        { header: 'Fellow', key: 'fellow', width: 20 },
        { header: 'PGY', key: 'pgy', width: 8 },
        { header: 'Total Calls', key: 'total', width: 12 },
        { header: 'Weekday Calls', key: 'weekday', width: 15 },
        { header: 'Weekday Distribution', key: 'distribution', width: 30 },
        { header: 'Weekend Calls', key: 'weekend', width: 15 },
        { header: 'Holiday Calls', key: 'holiday', width: 15 },
        { header: 'Average Days Between Call', key: 'avgGap', width: 25 },
        { header: 'Longest Gap Between Call', key: 'longestGap', width: 25 },
        { header: 'Longest Call Gap Dates', key: 'longestGapDates', width: 30 },
        { header: '4-Day Call Frequency', key: 'fourDayFreq', width: 18 },
        { header: 'Most Calls in a Month', key: 'mostCallsMonth', width: 20 },
        { header: 'Calls During CCU', key: 'ccuCalls', width: 18 }
      ];

      // Calculate primary stats using exact logic from PrimaryCallStatsTable
      const order = ["M", "T", "W", "Th", "F", "Sa", "Su"] as const;
      const blockKeyForISO = (iso: string) => blockKeyForDate(new Date(iso + "T00:00:00Z"));
      const monthLabel = (m: number) => new Date(Date.UTC(2000, m, 1)).toLocaleString(undefined, { month: "long" });
      const daysBetween = (a: Date, b: Date) => {
        const ms = a.getTime() - b.getTime();
        return Math.round(ms / (1000 * 60 * 60 * 24));
      };

      type Acc = {
        id: string;
        name: string;
        pgy: any;
        total: number;
        weekday: number;
        weekend: number;
        holiday: number;
        dow: Record<(typeof order)[number], number>;
        dates: string[]; // ISO dates of calls
      };

      const byFellow: Record<string, Acc> = {};

      for (const [iso, fid] of Object.entries(schedule.days)) {
        if (!fid) continue;
        const fellow = fellowById[fid];
        if (!fellow) continue;

        const acc = (byFellow[fid] ||= {
          id: fid,
          name: fellow.name,
          pgy: fellow.pgy,
          total: 0,
          weekday: 0,
          weekend: 0,
          holiday: 0,
          dow: { M: 0, T: 0, W: 0, Th: 0, F: 0, Sa: 0, Su: 0 },
          dates: [],
        });

        acc.total += 1;
        acc.dates.push(iso);

        const d = new Date(iso + "T00:00:00Z"); // force UTC to avoid TZ shifts
        const dow = d.getUTCDay(); // 0=Sun ... 6=Sat in UTC
        const isHoliday = holidayMap[iso];

        // Weekday distribution (always count toward day of week)
        const label =
          dow === 0 ? "Su" :
          dow === 1 ? "M" :
          dow === 2 ? "T" :
          dow === 3 ? "W" :
          dow === 4 ? "Th" :
          dow === 5 ? "F" : "Sa";
        acc.dow[label as typeof order[number]] += 1;

        // Mutually exclusive buckets for Weekday/Weekend/Holiday
        if (isHoliday) acc.holiday += 1;
        else if (dow === 0 || dow === 6) acc.weekend += 1;
        else acc.weekday += 1;
      }

      const primaryStats = Object.values(byFellow).map((acc) => {
        const sorted = [...acc.dates].sort();
        const gaps: number[] = [];
        let longest: number | null = null;
        let longestPair: { start: string; end: string } | null = null;
        let fourDay = 0;
        for (let i = 1; i < sorted.length; i++) {
          const gap = daysBetween(new Date(sorted[i]), new Date(sorted[i - 1]));
          gaps.push(gap);
          if (longest === null || gap > longest) {
            longest = gap;
            longestPair = { start: sorted[i - 1], end: sorted[i] };
          }
          if (gap <= 4) fourDay += 1;
        }
        const avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;

        // Most calls in a month
        const monthCounts: Record<number, number> = {};
        for (const iso of sorted) {
          const d = new Date(iso + "T00:00:00Z");
          const m = d.getUTCMonth();
          monthCounts[m] = (monthCounts[m] ?? 0) + 1;
        }
        let maxCount = 0;
        let maxMonth: number | null = null;
        for (const [mStr, count] of Object.entries(monthCounts)) {
          const c = count as number;
          const m = Number(mStr);
          if (c > maxCount) {
            maxCount = c;
            maxMonth = m;
          }
        }
        const mostLabel = maxMonth != null && maxCount > 0 ? `${maxCount} (${monthLabel(maxMonth)})` : null;

        // Calls during CCU
        let ccuCount = 0;
        const pgy = acc.pgy as PGY;
        const sched = schedByPGY[pgy];
        const rowMap = sched?.byFellow?.[acc.id] || {};
        for (const iso of sorted) {
          const key = blockKeyForISO(iso);
          if (rowMap[key] === "CCU") ccuCount += 1;
        }

        const fmtDist = `M: ${acc.dow.M}; T: ${acc.dow.T}; W: ${acc.dow.W}; Th: ${acc.dow.Th}; F: ${acc.dow.F}; Sa: ${acc.dow.Sa}; Su: ${acc.dow.Su}`;

        return {
          fellow: acc.name,
          pgy: acc.pgy,
          total: acc.total,
          weekday: acc.weekday,
          weekend: acc.weekend,
          holiday: acc.holiday,
          distribution: fmtDist,
          avgGap: avg !== null ? avg.toFixed(1) : 'N/A',
          longestGap: longest !== null ? longest.toString() : 'N/A',
          longestGapDates: longestPair ? `${longestPair.start} to ${longestPair.end}` : 'N/A',
          fourDayFreq: fourDay,
          mostCallsMonth: mostLabel ?? 'N/A',
          ccuCalls: ccuCount
        };
      });

      // Include fellows with zero calls as well
      for (const f of fellows) {
        if (!byFellow[f.id]) {
          primaryStats.push({
            fellow: f.name,
            pgy: f.pgy,
            total: 0,
            weekday: 0,
            weekend: 0,
            holiday: 0,
            distribution: 'M: 0; T: 0; W: 0; Th: 0; F: 0; Sa: 0; Su: 0',
            avgGap: 'N/A',
            longestGap: 'N/A',
            longestGapDates: 'N/A',
            fourDayFreq: 0,
            mostCallsMonth: 'N/A',
            ccuCalls: 0
          });
        }
      }

      // Sort by PGY then by name
      const pgyOrder = (p: any) => {
        if (typeof p === "number") return p;
        const m = String(p).match(/(\d+)/);
        return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
      };
      primaryStats.sort((a, b) => {
        const ap = pgyOrder(a.pgy);
        const bp = pgyOrder(b.pgy);
        if (ap !== bp) return ap - bp;
        return a.fellow.localeCompare(b.fellow);
      });

      primaryStatsSheet.getRow(1).font = { bold: true };
      primaryStatsSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2E8F0' } };

      primaryStats.forEach(stat => {
        const row = primaryStatsSheet.addRow({
          fellow: stat.fellow,
          pgy: stat.pgy,
          total: stat.total,
          weekday: stat.weekday,
          distribution: stat.distribution,
          weekend: stat.weekend,
          holiday: stat.holiday,
          avgGap: stat.avgGap,
          longestGap: stat.longestGap,
          longestGapDates: stat.longestGapDates,
          fourDayFreq: stat.fourDayFreq,
          mostCallsMonth: stat.mostCallsMonth,
          ccuCalls: stat.ccuCalls
        });
        
        const fellowRecord = fellows.find(f => f.name === stat.fellow);
        if (fellowRecord && fellowColorById[fellowRecord.id]) {
          const colorHex = getFellowshipColor(fellowColorById[fellowRecord.id]);
          row.getCell('fellow').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorHex } };
        }
      });

      // Add borders to primary stats
      primaryStatsSheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        });
      });

      // Tab 3: HF Coverage Statistics
      if (hfSchedule) {
        const hfStatsSheet = workbook.addWorksheet('HF Coverage Statistics');
        hfStatsSheet.columns = [
          { header: 'Fellow', key: 'fellow', width: 20 },
          { header: 'PGY', key: 'pgy', width: 8 },
          { header: 'Non-Holiday Weekends', key: 'weekends', width: 20 },
          { header: 'Holiday Days', key: 'holidays', width: 15 },
          { header: 'Average Gap', key: 'avgGap', width: 15 },
          { header: 'Shortest Gap', key: 'shortestGap', width: 15 }
        ];

        hfStatsSheet.getRow(1).font = { bold: true };
        hfStatsSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2E8F0' } };

        const hfAnalysis = analyzeHFSchedule(hfSchedule, fellows, setup);
        fellows.forEach(fellow => {
          const analysis = hfAnalysis.fellowStats[fellow.id];
          const row = hfStatsSheet.addRow({
            fellow: fellow.name,
            pgy: fellow.pgy,
            weekends: analysis?.weekendCount || 0,
            holidays: analysis?.holidayDayCount || 0,
            avgGap: analysis?.avgGapDays ? `${analysis.avgGapDays.toFixed(1)} days` : 'N/A',
            shortestGap: analysis?.minGapDays ? `${analysis.minGapDays} days` : 'N/A'
          });

          if (fellowColorById[fellow.id]) {
            const colorHex = getFellowshipColor(fellowColorById[fellow.id]);
            row.getCell('fellow').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorHex } };
          }
        });

        // Add borders to HF stats
        hfStatsSheet.eachRow((row) => {
          row.eachCell((cell) => {
            cell.border = {
              top: { style: 'thin' },
              left: { style: 'thin' },
              bottom: { style: 'thin' },
              right: { style: 'thin' }
            };
          });
        });
      }

      // Tab 4: Jeopardy Statistics
      if (jeopardySchedule) {
        const jeopardyStatsSheet = workbook.addWorksheet('Jeopardy Statistics');
        jeopardyStatsSheet.columns = [
          { header: 'Fellow', key: 'fellow', width: 20 },
          { header: 'PGY', key: 'pgy', width: 8 },
          { header: 'Total Jeopardy', key: 'total', width: 15 },
          { header: 'Weekday Jeopardy', key: 'weekday', width: 18 },
          { header: 'Weekend Jeopardy', key: 'weekend', width: 18 },
          { header: 'Holiday Jeopardy', key: 'holiday', width: 18 }
        ];

        jeopardyStatsSheet.getRow(1).font = { bold: true };
        jeopardyStatsSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2E8F0' } };

        fellows.forEach(fellow => {
          const weekdayCount = jeopardySchedule.weekdayCountsByFellow[fellow.id] || 0;
          const weekendCount = jeopardySchedule.weekendCountsByFellow[fellow.id] || 0;
          const holidayCount = jeopardySchedule.holidayCountsByFellow[fellow.id] || 0;

          const row = jeopardyStatsSheet.addRow({
            fellow: fellow.name,
            pgy: fellow.pgy,
            total: weekdayCount + weekendCount + holidayCount,
            weekday: weekdayCount,
            weekend: weekendCount,
            holiday: holidayCount
          });

          if (fellowColorById[fellow.id]) {
            const colorHex = getFellowshipColor(fellowColorById[fellow.id]);
            row.getCell('fellow').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorHex } };
          }
        });

        // Add borders to jeopardy stats
        jeopardyStatsSheet.eachRow((row) => {
          row.eachCell((cell) => {
            cell.border = {
              top: { style: 'thin' },
              left: { style: 'thin' },
              bottom: { style: 'thin' },
              right: { style: 'thin' }
            };
          });
        });
      }

      // Tab 5: Clinic Statistics  
      if (clinicSchedule) {
        const clinicStatsSheet = workbook.addWorksheet('Clinic Statistics');
        clinicStatsSheet.columns = [
          { header: 'Fellow', key: 'fellow', width: 20 },
          { header: 'PGY Level', key: 'pgy', width: 12 },
          { header: 'General Clinic (Half Days)', key: 'general', width: 25 },
          { header: 'General Clinic (Post-Call Exclusions)', key: 'postCall', width: 30 },
          { header: 'Specialty Clinic (Half Days)', key: 'specialty', width: 25 },
          { header: 'Specialty Clinic (Post-Call Exclusions)', key: 'specialtyPostCall', width: 30 },
          { header: 'Total Clinic (Half Days)', key: 'totalHalfDays', width: 22 },
          { header: 'Total Clinic (Post-Call Exclusions)', key: 'totalPostCall', width: 30 },
          { header: 'Cumulative Clinic + Post-Call Exclusions', key: 'cumulative', width: 35 }
        ];

        clinicStatsSheet.getRow(1).font = { bold: true };
        clinicStatsSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2E8F0' } };

        // Helper function to check if a day is a holiday
        const isHoliday = (dateISO: string): boolean => {
          return !!holidayMap[dateISO];
        };

        // Helper function to check if it's a post-call day
        const isPostCallDay = (fellowId: string, dateISO: string): boolean => {
          if (!schedule) return false;
          const date = parseISO(dateISO);
          const prevDay = new Date(date.getTime() - 24 * 60 * 60 * 1000);
          const prevDayISO = format(prevDay, 'yyyy-MM-dd');
          return schedule.days[prevDayISO] === fellowId;
        };

        // Calculate clinic statistics using exact logic from ClinicStatsTable
        fellows.forEach(fellow => {
          const counts = clinicSchedule.countsByFellow[fellow.id] || {
            GENERAL: 0,
            EP: 0,
            ACHD: 0,
            HEART_FAILURE: 0,
            DEVICE: 0
          };
          
          const generalClinicCount = counts.GENERAL || 0;
          const epClinicCount = (counts.EP || 0) + (counts.DEVICE || 0);
          const achdClinicCount = counts.ACHD || 0;
          const hfClinicCount = counts.HEART_FAILURE || 0;
          const specialtyTotal = epClinicCount + achdClinicCount + hfClinicCount;

          // Calculate post-call exclusions
          let postCallExclusions = 0;
          let specialtyPostCallExclusions = 0;
          
          if (fellow.clinicDay && schedule) {
            const dayOfWeekMap: Record<string, number> = {
              'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 
              'Thursday': 4, 'Friday': 5, 'Saturday': 6
            };
            const preferredDayOfWeek = dayOfWeekMap[fellow.clinicDay];

            if (preferredDayOfWeek !== undefined) {
              // Calculate for the academic year
              const start = parseISO(clinicSchedule.yearStart);
              const end = new Date(start.getFullYear() + 1, 5, 30); // June 30 of next year
              let cur = start;
              
              while (cur <= end) {
                const dayOfWeek = cur.getDay();
                const dateISO = format(cur, 'yyyy-MM-dd');
                
                if (dayOfWeek === preferredDayOfWeek && 
                    !isHoliday(dateISO) &&
                    isPostCallDay(fellow.id, dateISO)) {
                  postCallExclusions++;
                  // For simplicity, assume all post-call exclusions affect general clinic
                }
                
                cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
              }
            }
          }

          const totalHalfDays = generalClinicCount + specialtyTotal;
          const totalPostCallExclusions = postCallExclusions + specialtyPostCallExclusions;
          const cumulativeTotal = totalHalfDays + totalPostCallExclusions;

          const row = clinicStatsSheet.addRow({
            fellow: fellow.name.split(' ').pop() || fellow.name, // Last name only like in UI
            pgy: fellow.pgy,
            general: generalClinicCount,
            postCall: postCallExclusions,
            specialty: specialtyTotal,
            specialtyPostCall: specialtyPostCallExclusions,
            totalHalfDays: totalHalfDays,
            totalPostCall: totalPostCallExclusions,
            cumulative: cumulativeTotal
          });

          if (fellowColorById[fellow.id]) {
            const colorHex = getFellowshipColor(fellowColorById[fellow.id]);
            row.getCell('fellow').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorHex } };
          }
        });

        // Add borders to clinic stats
        clinicStatsSheet.eachRow((row) => {
          row.eachCell((cell) => {
            cell.border = {
              top: { style: 'thin' },
              left: { style: 'thin' },
              bottom: { style: 'thin' },
              right: { style: 'thin' }
            };
          });
        });
      }

      // Generate and download file
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `primary_call_report_${setup.yearStart}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: "Export Complete",
        description: "Primary call report has been downloaded successfully.",
      });

    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: "Export Failed",
        description: "Failed to export Excel file. Please try again.",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
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
      
      // Recalculate uncovered days after drag
      const newUncovered = allDays.filter((d) => !result.schedule!.days[d]);
      setUncovered(newUncovered);
      const newSuccess = newUncovered.length === 0;
      setSuccess(newSuccess);
      saveCoverageMetadata({ uncovered: newUncovered, success: newSuccess });
      
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

  const handleRefreshCoverage = () => {
    // Recalculate primary call uncovered
    if (schedule) {
      const newUncovered = allDays.filter((d) => !schedule.days[d]);
      setUncovered(newUncovered);
      const newSuccess = newUncovered.length === 0;
      setSuccess(newSuccess);
      saveCoverageMetadata({ uncovered: newUncovered, success: newSuccess });
    }
    
    // Recalculate HF uncovered
    if (hfSchedule && setup?.yearStart) {
      const allWeekends = allDays.filter(d => {
        const date = parseISO(d);
        return date.getDay() === 6;
      });
      const newUncoveredHF = allWeekends.filter(d => !hfSchedule.weekends[d]);
      setUncoveredHF(newUncoveredHF);
      
      const allHolidays = computeAcademicYearHolidays(setup.yearStart);
      const newUncoveredHols = allHolidays.filter(h => !hfSchedule.holidays?.[h.date]).map(h => h.date);
      setUncoveredHolidays(newUncoveredHols);
      setHFSuccess(newUncoveredHF.length === 0 && newUncoveredHols.length === 0);
    }
    
    // Recalculate Jeopardy uncovered
    if (jeopardySchedule) {
      const newUncoveredJeopardy = allDays.filter(d => !jeopardySchedule.days[d]);
      setUncoveredJeopardy(newUncoveredJeopardy);
      setJeopardySuccess(newUncoveredJeopardy.length === 0);
    }
    
    // Recalculate Clinic gaps
    if (clinicSchedule && setup) {
      const result = checkSpecialtyClinicCoverage(clinicSchedule, setup);
      setClinicCoverageGaps(result.gaps);
      setClinicSuccess(result.success);
    }
    
    toast({
      title: "Coverage refreshed",
      description: "All uncovered dates have been recalculated.",
    });
  };

  return (
    <DndContext 
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <main className="min-h-screen bg-background">
        <section className="container mx-auto px-4 py-8">
        <header className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
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
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={handleCheckClinic} disabled={clinicCheckLoading || !clinicSchedule} variant="outline" size="sm">
              {clinicCheckLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />} Check Clinics
            </Button>
            <Button onClick={handleRefreshCoverage} variant="outline" size="sm" title="Recalculate all coverage status">
              <RefreshCcw className="h-4 w-4" /> Refresh
            </Button>
            <Button onClick={handleExportExcel} disabled={exporting || !schedule} variant="outline">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export Excel
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
                <Tabs value={activeScheduleView} onValueChange={setActiveScheduleView}>
                <TabsList>
                  <TabsTrigger value="table">Table</TabsTrigger>
                  <TabsTrigger value="calendar">Calendar</TabsTrigger>
                  <TabsTrigger value="clinic-calendar">Clinic Calendar</TabsTrigger>
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
      <TableHead className="sticky top-0 z-[1] bg-background">Ambulatory Fellow</TableHead>
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
                  <div className="flex flex-wrap gap-1 items-center">
                    {clinicAssignments.map((assignment, index) => (
                      <Badge 
                        key={index} 
                        variant={fellowColorById[assignment.fellowId]}
                        className="text-xs cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => handleClinicEdit(iso, index)}
                      >
                        {fellowById[assignment.fellowId]?.name ?? assignment.fellowId}: {assignment.clinicType === "GENERAL" ? "Gen" : assignment.clinicType === "HEART_FAILURE" ? "HF" : assignment.clinicType === "ACHD" ? "ACHD" : assignment.clinicType === "DEVICE" ? "Dev" : "EP"}
                      </Badge>
                    ))}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => handleClinicAdd(iso)}
                    >
                      + Clinic
                    </Button>
                  </div>
                );
              }
              
              return (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => handleClinicAdd(iso)}
                >
                  + Clinic
                </Button>
              );
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
          <TableCell>
            {(() => {
              const ambulatoryFellowId = clinicSchedule?.ambulatoryAssignments?.[iso];
              if (ambulatoryFellowId) {
                const ambulatoryFellow = fellowById[ambulatoryFellowId];
                const rotation = getFellowRotationOnDate(ambulatoryFellowId, iso);
                const primaryRotation = rotation ? getPrimaryRotation(rotation) : undefined;
                const rotationDisplay = primaryRotation ? ` (${primaryRotation})` : '';
                return (
                  <Badge 
                    variant={fellowColorById[ambulatoryFellowId]} 
                    className="text-xs cursor-pointer hover:opacity-80"
                    onClick={() => setAmbulatoryEditISO(iso)}
                  >
                    {ambulatoryFellow?.name ?? ambulatoryFellowId}{rotationDisplay}
                  </Badge>
                );
              }
              return (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-6 text-xs"
                  onClick={() => setAmbulatoryEditISO(iso)}
                >
                  Assign
                </Button>
              );
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
                <TabsContent value="clinic-calendar">
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
                            const hol = holidayMap[iso];
                            const weekend = isWeekend(new Date(m.year, m.month, day));
                            const cellBg = hol ? "bg-[hsl(var(--holiday))]" : weekend ? "bg-muted/70" : "bg-card";
                            
                            // Get clinic assignments for this date
                            const clinicAssignments = getClinicAssignmentsForDate(clinicSchedule, iso);
                            
                            return (
                              <div key={iso} className={`h-20 rounded-md border ${cellBg} p-2 text-xs relative overflow-y-auto`}>
                                <div className="font-medium">{day}</div>
                                {hol && <div className="text-[0.65rem] text-red-600 truncate">{hol}</div>}
                                
                                {/* Clinic assignments */}
                                {clinicAssignments.length > 0 && (
                                  <div className="mt-1 space-y-1">
                                    {clinicAssignments.map((assignment, index) => (
                                      <Badge 
                                        key={index}
                                        variant={fellowColorById[assignment.fellowId]}
                                        className="text-[0.55rem] px-1 py-0 h-auto block w-full"
                                      >
                                        <div className="truncate">
                                          {lastNameOf(fellowById[assignment.fellowId]?.name ?? assignment.fellowId)}:
                                          {assignment.clinicType === "GENERAL" ? "Gen" : 
                                           assignment.clinicType === "HEART_FAILURE" ? "HF" : 
                                           assignment.clinicType === "ACHD" ? "ACHD" : 
                                           assignment.clinicType === "DEVICE" ? "Dev" : "EP"}
                                        </div>
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </div>
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
                  cachedSchedules={cachedSchedules ?? undefined}
                  onClose={() => setEditISO(null)}
                  onApply={(updated) => {
                    setSchedule(updated);
                    saveCallSchedule(updated);
                    const newUncovered = allDays.filter((d) => !updated.days[d]);
                    setUncovered(newUncovered);
                    const newSuccess = newUncovered.length === 0;
                    setSuccess(newSuccess);
                    saveCoverageMetadata({ uncovered: newUncovered, success: newSuccess });
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
              
              {ambulatoryEditISO && clinicSchedule && (
                <AmbulatoryEditDialog
                  iso={ambulatoryEditISO}
                  schedule={clinicSchedule}
                  open={true}
                  onClose={() => setAmbulatoryEditISO(null)}
                  onApply={handleAmbulatoryScheduleUpdate}
                />
              )}
              
              {clinicEditISO && clinicSchedule && (
                <ClinicEditDialog
                  iso={clinicEditISO}
                  assignmentIndex={clinicEditIndex}
                  schedule={clinicSchedule}
                  callSchedule={schedule}
                  open={true}
                  onClose={() => {
                    setClinicEditISO(null);
                    setClinicEditIndex(null);
                  }}
                  onApply={handleClinicScheduleUpdate}
                  mode={clinicEditMode}
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
