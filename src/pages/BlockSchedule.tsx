import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { HeartPulse, Download, RefreshCw, Eraser, ChevronUp, ChevronDown } from "lucide-react";
import { DndContext, DragOverlay, DragStartEvent, DragEndEvent } from "@dnd-kit/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSEO } from "@/lib/seo";
import { generateAcademicYearBlocks, type BlockInfo, hasMinSpacing } from "@/lib/block-utils";
import {
  buildVacationScheduleForPGY,
  countByBlock,
  loadSchedule,
  loadSetup,
  saveSchedule,
  type Fellow,
  type PGY,
  type StoredSchedule,
} from "@/lib/schedule-engine";
import { placePGY4Rotations, placePGY5Rotations, placePGY6Rotations } from "@/lib/rotation-engine";
import { useToast } from "@/hooks/use-toast";
import type { Rotation } from "@/lib/rotation-engine";
import BlockEditDialog from "@/components/BlockEditDialog";
import { VacationConflictDialog } from "@/components/VacationConflictDialog";
import { DraggableBadge } from "@/components/DraggableBadge";
import { DroppableCell } from "@/components/DroppableCell";
import { applyBlockDragAndDrop } from "@/lib/block-engine";

export default function BlockSchedule() {
  useSEO({
    title: "Block Schedule | Cardiology Scheduler",
    description: "Build each PGY year schedule. Step 1: place vacations, then rotations.",
    canonical: window.location.href,
  });

  const { toast } = useToast();
  const setup = loadSetup();
  const [activePGY, setActivePGY] = useState<PGY | "TOTAL">("PGY-4");
  const [blocks, setBlocks] = useState<BlockInfo[]>(() =>
    generateAcademicYearBlocks(toAcademicYearJuly1(setup?.yearStart ?? new Date().toISOString().slice(0, 10)))
  );
const fellows: Fellow[] = useMemo(
    () =>
      setup
        ? activePGY === "TOTAL"
          ? setup.fellows
          : setup.fellows.filter((f) => f.pgy === activePGY)
        : [],
    [setup, activePGY]
  );

  const [schedule, setSchedule] = useState<StoredSchedule | null>(() => (activePGY === "TOTAL" ? null : loadSchedule(activePGY as PGY)));
  const [panelOpen, setPanelOpen] = useState(false);
  
  // Vacation conflict dialog state
  const [vacationConflictDialog, setVacationConflictDialog] = useState<{
    open: boolean;
    fellowName: string;
    blockKey: string;
    conflictingFellow: string;
    pendingAction: (() => void) | null;
  }>({
    open: false,
    fellowName: "",
    blockKey: "",
    conflictingFellow: "",
    pendingAction: null,
  });

  // Maps for block <-> month helpers
  const keyToMonth = useMemo(() => {
    const m = new Map<string, number>();
    blocks.forEach((b) => m.set(b.key, b.monthIndex));
    return m;
  }, [blocks]);
  const monthToKeys = useMemo(() => {
    const m = new Map<number, string[]>();
    blocks.forEach((b) => {
      const arr = m.get(b.monthIndex) || [];
      arr.push(b.key);
      m.set(b.monthIndex, arr);
    });
    return m;
  }, [blocks]);

  const withinJanToJun = (mi: number) => mi >= 6 && mi <= 11;
  const isAdjacentMonth = (a: number, b: number) => Math.abs(a - b) === 1;

  // Edit dialog state
  const [edit, setEdit] = useState<{ open: boolean; fid?: string; key?: string }>({ open: false });
  
  // Drag and drop state
  const [dragData, setDragData] = useState<{ fellowId: string; blockKey: string; rotation: string } | null>(null);
const rotationOptions = useMemo<Rotation[]>(
    () =>
      activePGY === "PGY-5"
        ? [
            "VAC",
            "LAC_CATH",
            "CCU",
            "LAC_CONSULT",
            "HF",
            "KECK_CONSULT",
            "ECHO2",
            "EP",
            "NUCLEAR",
            "NONINVASIVE",
            "ELECTIVE",
          ]
        : activePGY === "PGY-6"
        ? [
            "VAC",
            "LAC_CATH",
            "HF",
            "KECK_CONSULT",
            "ECHO2",
            "EP",
            "NUCLEAR",
            "NONINVASIVE",
            "ELECTIVE",
          ]
        : ["VAC", "LAC_CATH", "CCU", "LAC_CONSULT", "HF", "KECK_CONSULT", "ECHO1", "EP", "ELECTIVE"],
    [activePGY]
  );
  const openEdit = (fid: string, key: string) => {
    if (activePGY === "TOTAL") return;
    setEdit({ open: true, fid, key });
  };

  const selectedFellow = useMemo(() => fellows.find((ff) => ff.id === edit.fid), [fellows, edit.fid]);
  const selectedBlock = useMemo(() => blocks.find((b) => b.key === edit.key), [blocks, edit.key]);
  const currentLabelForEdit = useMemo(() => {
    if (!schedule || !edit.fid || !edit.key) return undefined;
    return schedule.byFellow?.[edit.fid]?.[edit.key];
  }, [schedule, edit.fid, edit.key]);

  const applyEdit = (action: { type: "set"; rotation: Rotation } | { type: "clear" }) => {
    if (activePGY === "TOTAL" || !schedule || !edit.fid || !edit.key) {
      setEdit({ open: false });
      return;
    }
    const fid = edit.fid;
    const k = edit.key;
    const mi = keyToMonth.get(k);
    if (mi == null) {
      setEdit({ open: false });
      return;
    }

    const nextByFellow: Record<string, Record<string, string | undefined>> = { ...(schedule.byFellow || {}) };
    const row: Record<string, string | undefined> = { ...(nextByFellow[fid] || {}) };

    if (action.type === "clear") {
      if (row[k] === "HF" && activePGY === "PGY-4") {
        const keys = monthToKeys.get(mi) || [];
        for (const kk of keys) {
          if (row[kk] === "HF") delete row[kk];
        }
      } else if (row[k] === "KECK_CONSULT" && activePGY === "PGY-5") {
        const keys = monthToKeys.get(mi) || [];
        for (const kk of keys) {
          if (row[kk] === "KECK_CONSULT") delete row[kk];
        }
      } else {
        delete row[k];
      }
    } else {
      if (action.rotation === "VAC") {
        // Check for vacation conflicts and offer override option
        const conflictEntry = Object.entries(schedule.byFellow || {}).find(
          ([ofid, orow]) => ofid !== fid && orow?.[k] === "VAC"
        );
        if (conflictEntry) {
          const conflictingFellow = fellows.find(f => f.id === conflictEntry[0])?.name || conflictEntry[0];
          const currentFellow = fellows.find(f => f.id === fid)?.name || fid;
          
          setVacationConflictDialog({
            open: true,
            fellowName: currentFellow,
            blockKey: k,
            conflictingFellow,
            pendingAction: () => applyVacationAssignment(fid, k, action.rotation),
          });
          return;
        }
        // Max 2 vacations per fellow, with >= 6-block spacing
        const existingVacKeys = Object.entries(row)
          .filter(([, v]) => v === "VAC")
          .map(([kk]) => kk);
        const alreadyVacHere = row[k] === "VAC";
        const prospectiveVacKeys = alreadyVacHere ? existingVacKeys : [...existingVacKeys, k];
        if (prospectiveVacKeys.length > 2) {
          toast({ variant: "destructive", title: "Vacation limit", description: "A fellow can have at most two vacations." });
          return;
        }
        if (!hasMinSpacing(sortedBlocks, prospectiveVacKeys, 6)) {
          toast({ variant: "destructive", title: "Vacation spacing", description: "Vacations must be at least 6 blocks apart." });
          return;
        }
        applyVacationAssignment(fid, k, action.rotation);
      } else {
        applyNonVacationAssignment(fid, k, action.rotation);
      }
    }
  };

  const applyVacationAssignment = (fid: string, k: string, rotation: Rotation) => {
    if (!schedule) return;
    
    const row = schedule.byFellow[fid] || {};
    const mi = keyToMonth.get(k) ?? -1;
    
    row[k] = rotation;
    // avoid orphaned single HF in the same month (PGY-4 only)
    if (activePGY === "PGY-4") {
      const keys = monthToKeys.get(mi) || [];
      const other = keys.find((kk) => kk !== k);
      if (other && row[other] === "HF") {
        delete row[other];
      }
    }
    
    const newSchedule: StoredSchedule = {
      ...schedule,
      byFellow: { ...schedule.byFellow, [fid]: row },
    };
    setSchedule(newSchedule);
    saveSchedule(activePGY as PGY, newSchedule);
  };

  const applyNonVacationAssignment = (fid: string, k: string, rotation: Rotation) => {
    if (!schedule) return;
    
    const row = schedule.byFellow[fid] || {};
    const mi = keyToMonth.get(k) ?? -1;
    
    if (rotation === "HF" && activePGY === "PGY-4") {
      if (!withinJanToJun(mi)) {
        toast({ variant: "destructive", title: "Invalid HF placement", description: "HF must be a full month between Jan and Jun." });
        return;
      }
      const keys = monthToKeys.get(mi) || [];
      if (keys.length < 2) {
        toast({ variant: "destructive", title: "Invalid HF placement", description: "HF requires both blocks in the month." });
        return;
      }
      for (const kk of keys) {
        row[kk] = "HF";
      }
    } else if (rotation === "KECK_CONSULT" && activePGY === "PGY-5") {
      const keys = monthToKeys.get(mi) || [];
      if (keys.length < 2) {
        toast({ variant: "destructive", title: "Invalid KECK_CONSULT placement", description: "KECK_CONSULT must be a full month (2 blocks)." });
        return;
      }
      for (const kk of keys) {
        row[kk] = "KECK_CONSULT";
      }
    } else {
      row[k] = rotation;
      // avoid orphaned single HF in the same month (PGY-4 only)
      if (activePGY === "PGY-4") {
        const keys = monthToKeys.get(mi) || [];
        const other = keys.find((kk) => kk !== k);
        if (other && row[other] === "HF") {
          delete row[other];
        }
      }
    }
    
    const newSchedule: StoredSchedule = {
      ...schedule,
      byFellow: { ...schedule.byFellow, [fid]: row },
    };
    setSchedule(newSchedule);
    saveSchedule(activePGY as PGY, newSchedule);
    
    // Validation logic that was originally in applyEdit
    if (activePGY === "PGY-4") {
      // HF must be full-month in Jan–Jun
      const hfKeys = Object.entries(row).filter(([, v]) => v === "HF").map(([kk]) => kk);
      const hfByMonth = new Map<number, string[]>();
      for (const kk of hfKeys) {
        const mii = keyToMonth.get(kk);
        if (mii == null) continue;
        const arr = hfByMonth.get(mii) || [];
        arr.push(kk);
        hfByMonth.set(mii, arr);
      }
      for (const [mii, arr] of hfByMonth) {
        if (!withinJanToJun(mii)) {
          toast({ variant: "destructive", title: "HF rule violation", description: "HF month must be between January and June." });
          return;
        }
        if (arr.length !== 2) {
          toast({ variant: "destructive", title: "HF rule violation", description: "HF must be a full month (2 consecutive blocks)." });
          return;
        }
      }

      // CCU months cannot be consecutive (PGY-4 rule)
      const ccuMonths = new Set<number>();
      for (const [kk, vv] of Object.entries(row)) {
        if (vv === "CCU") {
          const mii = keyToMonth.get(kk);
          if (mii != null) ccuMonths.add(mii);
        }
      }
      const ccuList = Array.from(ccuMonths).sort((a, b) => a - b);
      for (let i = 1; i < ccuList.length; i++) {
        if (isAdjacentMonth(ccuList[i], ccuList[i - 1])) {
          toast({ variant: "destructive", title: "CCU rule violation", description: "CCU months cannot be consecutive." });
          return;
        }
      }

      // LAC_CONSULT months cannot be consecutive
      const lacConsMonths = new Set<number>();
      for (const [kk, vv] of Object.entries(row)) {
        if (vv === "LAC_CONSULT") {
          const mii = keyToMonth.get(kk);
          if (mii != null) lacConsMonths.add(mii);
        }
      }
      const lacConsList = Array.from(lacConsMonths).sort((a, b) => a - b);
      for (let i = 1; i < lacConsList.length; i++) {
        if (isAdjacentMonth(lacConsList[i], lacConsList[i - 1])) {
          toast({ variant: "destructive", title: "LAC_CONSULT rule violation", description: "LAC_CONSULT months cannot be consecutive." });
          return;
        }
      }
    }
    
    if (activePGY === "PGY-5") {
      // KECK_CONSULT must be exactly one full month (2 blocks)
      const kcKeys = Object.entries(row).filter(([, v]) => v === "KECK_CONSULT").map(([kk]) => kk);
      if (kcKeys.length > 0) {
        const kcMonths = new Map<number, number>();
        for (const kk of kcKeys) {
          const mii = keyToMonth.get(kk);
          if (mii != null) kcMonths.set(mii, (kcMonths.get(mii) || 0) + 1);
        }
        const valid = Array.from(kcMonths.values()).some((c) => c === 2) && kcKeys.length === 2 && kcMonths.size === 1;
        if (!valid) {
          toast({ variant: "destructive", title: "KECK_CONSULT rule", description: "KECK_CONSULT must be a full month (2 blocks in same month)." });
          return;
        }
      }

      // HF must be non-consecutive and not adjacent to CCU
      const idxBy = (lab: string) =>
        Object.entries(row)
          .filter(([, v]) => v === lab)
          .map(([kk]) => sortedBlocks.findIndex((b) => b.key === kk))
          .filter((x) => x >= 0)
          .sort((a, b) => a - b);
      const hfIdx = idxBy("HF");
      const ccuIdx = idxBy("CCU");
      for (let i = 1; i < hfIdx.length; i++) if (hfIdx[i] - hfIdx[i - 1] === 1) {
        toast({ variant: "destructive", title: "HF spacing", description: "HF blocks must be non-consecutive." });
        return;
      }
      for (const i of hfIdx) for (const j of ccuIdx) if (Math.abs(i - j) === 1) {
        toast({ variant: "destructive", title: "HF-CCU adjacency", description: "HF cannot be adjacent to CCU." });
        return;
      }

      // Non-consecutive for selected labels
      const nonConLabels: Rotation[] = ["ECHO2", "EP", "NUCLEAR", "NONINVASIVE", "LAC_CATH"];
      for (const lab of nonConLabels) {
        const idxs = idxBy(lab);
        for (let i = 1; i < idxs.length; i++) if (idxs[i] - idxs[i - 1] === 1) {
          toast({ variant: "destructive", title: `${lab} spacing`, description: `${lab} blocks must be non-consecutive.` });
          return;
        }
      }

      // Cross-PGY overlap with PGY-4 for sensitive rotations
      const p4 = loadSchedule("PGY-4");
      if (p4?.byFellow) {
        const cross = new Set<Rotation>(["CCU", "KECK_CONSULT", "LAC_CONSULT", "HF", "EP"]);
        for (const [kk, vv] of Object.entries(row)) {
          if (!vv || !cross.has(vv as Rotation)) continue;
          for (const rf of Object.values(p4.byFellow)) {
            if (rf[kk] === vv) {
              toast({ variant: "destructive", title: "Cross-PGY overlap", description: `${vv} overlaps with PGY-4 at ${kk}.` });
              return;
            }
          }
        }
      }
    }

    const nextByFellow: Record<string, Record<string, string | undefined>> = { ...(schedule.byFellow || {}) };
    nextByFellow[fid] = row;
    const next: StoredSchedule = { version: 1, pgy: activePGY as PGY, byFellow: nextByFellow };
    saveSchedule(activePGY as PGY, next);
    setSchedule(next);
    setEdit({ open: false });
    toast({ title: "Block updated", description: "Assignment updated successfully." });
  };

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const [fellowId, blockKey] = (active.id as string).split("-");
    const rotation = schedule?.byFellow?.[fellowId]?.[blockKey];
    
    if (rotation) {
      setDragData({ fellowId, blockKey, rotation });
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setDragData(null);
    
    console.log("🎯 Drag End - Start", { 
      activeId: active.id, 
      overId: over?.id, 
      activePGY, 
      hasSchedule: !!schedule 
    });
    
    if (!over || !schedule || activePGY === "TOTAL") {
      console.log("❌ Drag End - Early return", { 
        hasOver: !!over, 
        hasSchedule: !!schedule, 
        activePGY 
      });
      return;
    }
    
    const [dragFellowId, dragBlockKey] = (active.id as string).split("-");
    const [dropFellowId, dropBlockKey] = (over.id as string).split("-");
    
    console.log("🎯 Drag End - Parsed IDs", { 
      dragFellowId, 
      dragBlockKey, 
      dropFellowId, 
      dropBlockKey 
    });
    
    if (dragFellowId === dropFellowId && dragBlockKey === dropBlockKey) {
      console.log("⚠️ Drag End - No change needed");
      return; // No change
    }
    
    // Get current rotation being dragged
    const currentRotation = schedule.byFellow?.[dragFellowId]?.[dragBlockKey];
    console.log("🎯 Current rotation being dragged:", currentRotation);
    
    const result = applyBlockDragAndDrop(
      schedule,
      dragFellowId,
      dragBlockKey,
      dropFellowId,
      dropBlockKey,
      blocks,
      fellows
    );
    
    console.log("🎯 Drag Drop Result:", result);
    
    if (result.success && result.schedule) {
      console.log("✅ Successful drag drop, updating state...");
      console.log("📋 Old schedule byFellow:", JSON.stringify(schedule.byFellow, null, 2));
      console.log("📋 New schedule byFellow:", JSON.stringify(result.schedule.byFellow, null, 2));
      
      // Save to localStorage first
      saveSchedule(activePGY as PGY, result.schedule);
      console.log("💾 Saved to localStorage");
      
      // Force state update with new object reference
      setSchedule({ ...result.schedule });
      console.log("🔄 State updated with new schedule");
      
      toast({ 
        title: "Block moved", 
        description: "Assignment updated successfully.",
        duration: 3000
      });
    } else {
      console.log("❌ Failed drag drop:", result.error);
      
      // Check if it's a vacation conflict that can be overridden
      if (result.vacationConflict) {
        const currentFellow = fellows.find(f => f.id === dragFellowId)?.name || dragFellowId;
        setVacationConflictDialog({
          open: true,
          fellowName: currentFellow,
          blockKey: result.vacationConflict.blockKey,
          conflictingFellow: result.vacationConflict.conflictingFellow,
          pendingAction: () => {
            // Retry the drag and drop with vacation conflicts allowed
            const retryResult = applyBlockDragAndDrop(
              schedule,
              dragFellowId,
              dragBlockKey,
              dropFellowId,
              dropBlockKey,
              blocks,
              fellows,
              true // Allow vacation conflicts
            );
            
            if (retryResult.success && retryResult.schedule) {
              saveSchedule(activePGY as PGY, retryResult.schedule);
              setSchedule({ ...retryResult.schedule });
              toast({ 
                title: "Block moved", 
                description: "Vacation conflict overridden. Assignment updated successfully.",
                duration: 3000
              });
            }
          },
        });
      } else {
        toast({ 
          variant: "destructive", 
          title: "Invalid move", 
          description: result.error || "This move violates scheduling rules.",
          duration: 5000
        });
      }
    }
  };

  useEffect(() => {
    setBlocks(
      generateAcademicYearBlocks(toAcademicYearJuly1(setup?.yearStart ?? new Date().toISOString().slice(0, 10)))
    );
  }, [setup?.yearStart]);

  useEffect(() => {
    if (activePGY === "TOTAL") {
      setSchedule(null);
    } else {
      setSchedule(loadSchedule(activePGY as PGY));
    }
  }, [activePGY]);

  const sortedBlocks = useMemo(() => sortJulToJun(blocks), [blocks]);
  const displayByFellow = useMemo(() => {
    console.log("🔄 Recomputing displayByFellow", { activePGY, scheduleExists: !!schedule });
    if (activePGY === "TOTAL") {
      const total: Record<string, Record<string, string | undefined>> = {};
      
      // For TOTAL tab, include ALL fellows from all saved schedules
      // Don't filter by setup, as the schedule data is the source of truth
      (["PGY-4", "PGY-5", "PGY-6"] as PGY[]).forEach((p) => {
        const s = loadSchedule(p);
        if (s && s.byFellow) {
          console.log(`📋 Loading ${p} schedule with ${Object.keys(s.byFellow).length} fellows`);
          Object.entries(s.byFellow).forEach(([fellowId, fellowSchedule]) => {
            // Include all fellows with schedule data
            if (fellowSchedule && Object.keys(fellowSchedule).length > 0) {
              total[fellowId] = fellowSchedule;
              console.log(`✅ Including fellow ${fellowId} from ${p}`);
            } else {
              console.log(`⚠️ Skipping empty schedule for fellow ${fellowId} from ${p}`);
            }
          });
        } else {
          console.log(`❌ No schedule data found for ${p}`);
        }
      });
      console.log(`📊 Total displayByFellow: ${Object.keys(total).length} fellows total`);
      return total;
    }
    const result = schedule?.byFellow ?? {};
    console.log("📊 Current displayByFellow:", result);
    return result;
  }, [activePGY, schedule, schedule?.byFellow]);
  const counts = useMemo(() => countByBlock(displayByFellow), [displayByFellow]);
  const fellowValidations = useMemo(() => {
    return fellows.map((f) => {
      const entries = displayByFellow[f.id] ?? {};
      const vacKeys = Object.entries(entries)
        .filter(([, v]) => v === "VAC")
        .map(([k]) => k);
      return { id: f.id, name: f.name, count: vacKeys.length, spacingOk: hasMinSpacing(sortedBlocks, vacKeys, 6) };
    });
  }, [fellows, sortedBlocks, displayByFellow]);

  const rotationsInUse = useMemo(() => {
    const set = new Set<string>();
    for (const fid of Object.keys(displayByFellow)) {
      const row = displayByFellow[fid] || {};
      for (const v of Object.values(row)) if (v) set.add(v);
    }
    const order = [
      "VAC",
      "LAC_CATH",
      "CCU",
      "LAC_CONSULT",
      "HF",
      "KECK_CONSULT",
      "ECHO1",
      "ECHO2",
      "EP",
      "NUCLEAR",
      "NONINVASIVE",
      "ELECTIVE",
    ];
    return Array.from(set).sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [displayByFellow]);

  const rotationsInUseCombined = useMemo(() => {
    const set = new Set<string>();
    const add = (byF?: Record<string, Record<string, string | undefined>>) => {
      if (!byF) return;
      for (const row of Object.values(byF)) {
        for (const v of Object.values(row)) if (v) set.add(v);
      }
    };
    const p4 = loadSchedule("PGY-4");
    const p5 = loadSchedule("PGY-5");
    const p6 = loadSchedule("PGY-6");
    add(p4?.byFellow);
    add(p5?.byFellow);
    add(p6?.byFellow);
    const order = [
      "VAC",
      "LAC_CATH",
      "CCU",
      "LAC_CONSULT",
      "HF",
      "KECK_CONSULT",
      "ECHO1",
      "ECHO2",
      "EP",
      "NUCLEAR",
      "NONINVASIVE",
      "ELECTIVE",
    ];
    return Array.from(set).sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [schedule, activePGY]);

  const blockRotationCounts = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    for (const b of sortedBlocks) {
      m[b.key] = {};
    }
    const addFrom = (byF?: Record<string, Record<string, string | undefined>>) => {
      if (!byF) return;
      for (const row of Object.values(byF)) {
        for (const [k, v] of Object.entries(row)) {
          if (!v) continue;
          if (!m[k]) m[k] = {};
          m[k][v] = (m[k][v] || 0) + 1;
        }
      }
    };
    const p4 = loadSchedule("PGY-4");
    const p5 = loadSchedule("PGY-5");
    const p6 = loadSchedule("PGY-6");
    addFrom(p4?.byFellow);
    addFrom(p5?.byFellow);
    addFrom(p6?.byFellow);
    return m;
  }, [sortedBlocks, schedule, activePGY]);

  const perFellowCounts = useMemo(() => {
    const res: Record<string, Record<string, number>> = {};
    for (const f of fellows) {
      const row = displayByFellow[f.id] || {};
      const m: Record<string, number> = {};
      for (const v of Object.values(row)) {
        if (!v) continue;
        m[v] = (m[v] || 0) + 1;
      }
      res[f.id] = m;
    }
    return res;
  }, [fellows, displayByFellow]);
const handleBuildVacations = () => {
    if (!setup) {
      toast({ variant: "destructive", title: "No setup found", description: "Please configure fellows first." });
      return;
    }
    if (activePGY === "TOTAL") {
      toast({
        variant: "destructive",
        title: "Select a PGY year",
        description: "Choose PGY-4, PGY-5, or PGY-6 to place vacations.",
      });
      return;
    }
    const result = buildVacationScheduleForPGY(fellows, blocks, { randomize: true });
    if (!result.success) {
      toast({
        variant: "destructive",
        title: "Unable to place vacations",
        description: (result.conflicts && result.conflicts[0]) || "No assignment satisfies all constraints.",
      });
      return;
    }
    const next: StoredSchedule = { version: 1, pgy: activePGY, byFellow: result.byFellow };
    saveSchedule(activePGY, next);
    setSchedule(next);
    toast({ title: "Vacations placed", description: `Draft schedule built for ${activePGY}.` });
  };

const handlePlaceRotations = () => {
    if (!setup) {
      toast({ variant: "destructive", title: "No setup found", description: "Please configure fellows first." });
      return;
    }
    if (activePGY !== "PGY-4") {
      toast({ variant: "destructive", title: "PGY-4 only", description: "Switch to PGY-4 to place rotations." });
      return;
    }
    // Reshuffle from scratch: keep only vacation assignments as the base state
    const baseByFellow = schedule?.byFellow
      ? Object.fromEntries(
          Object.entries(schedule.byFellow).map(([fid, row]) => [
            fid,
            Object.fromEntries(Object.entries(row).filter(([, v]) => v === "VAC")),
          ])
        ) as Record<string, Record<string, string | undefined>>
      : undefined;
    const res = placePGY4Rotations(fellows, blocks, baseByFellow, { randomize: true });
    if (!res.success) {
      toast({ variant: "destructive", title: "Unable to place rotations", description: res.conflicts?.[0] || "No solution found." });
      return;
    }
    const next: StoredSchedule = { version: 1, pgy: activePGY, byFellow: res.byFellow };
    saveSchedule(activePGY, next);
    setSchedule(next);
    toast({ title: "Rotations placed", description: "PGY-4 rotations reshuffled from vacations." });
  };

  const handlePlaceRotationsPGY5 = () => {
    if (!setup) {
      toast({ variant: "destructive", title: "No setup found", description: "Please configure fellows first." });
      return;
    }
    if (activePGY !== "PGY-5") {
      toast({ variant: "destructive", title: "PGY-5 only", description: "Switch to PGY-5 to place rotations." });
      return;
    }
    // Reshuffle from scratch: keep only vacation assignments as the base state
    const baseByFellow = schedule?.byFellow
      ? Object.fromEntries(
          Object.entries(schedule.byFellow).map(([fid, row]) => [
            fid,
            Object.fromEntries(Object.entries(row).filter(([, v]) => v === "VAC")),
          ])
        ) as Record<string, Record<string, string | undefined>>
      : undefined;
    const res = placePGY5Rotations(fellows, blocks, baseByFellow, { randomize: true });
    if (!res.success) {
      toast({ variant: "destructive", title: "Unable to place rotations", description: res.conflicts?.[0] || "No solution found." });
      return;
    }
    const next: StoredSchedule = { version: 1, pgy: activePGY, byFellow: res.byFellow };
    saveSchedule(activePGY, next);
    setSchedule(next);
    toast({ title: "Rotations placed", description: "PGY-5 rotations assigned." });
  };

  const handlePlaceRotationsPGY6 = () => {
    if (!setup) {
      toast({ variant: "destructive", title: "No setup found", description: "Please configure fellows first." });
      return;
    }
    if (activePGY !== "PGY-6") {
      toast({ variant: "destructive", title: "PGY-6 only", description: "Switch to PGY-6 to place rotations." });
      return;
    }
    const baseByFellow = schedule?.byFellow
      ? Object.fromEntries(
          Object.entries(schedule.byFellow).map(([fid, row]) => [
            fid,
            Object.fromEntries(Object.entries(row).filter(([, v]) => v === "VAC")),
          ])
        ) as Record<string, Record<string, string | undefined>>
      : undefined;
    const res = placePGY6Rotations(fellows, blocks, baseByFellow, { randomize: true });
    if (!res.success) {
      toast({ variant: "destructive", title: "Unable to place rotations", description: res.conflicts?.[0] || "No solution found." });
      return;
    }
    const next: StoredSchedule = { version: 1, pgy: activePGY, byFellow: res.byFellow };
    saveSchedule(activePGY, next);
    setSchedule(next);
    toast({ title: "Rotations placed", description: "PGY-6 rotations assigned." });
  };

  const handleClearRotations = () => {
    if (activePGY !== "PGY-4" && activePGY !== "PGY-5" && activePGY !== "PGY-6") return;
    if (!schedule) return;
    const cleaned: Record<string, Record<string, string | undefined>> = {};
    for (const [fid, row] of Object.entries(schedule.byFellow || {})) {
      const nr: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(row)) if (v === "VAC") nr[k] = v;
      cleaned[fid] = nr;
    }
    const next: StoredSchedule = { version: 1, pgy: activePGY, byFellow: cleaned };
    saveSchedule(activePGY, next);
    setSchedule(next);
    toast({ title: "Rotations cleared", description: "Kept vacations; removed other assignments." });
  };

  const exportCSV = () => {
    const header = ["Fellow", ...sortedBlocks.map((b) => b.key)].join(",");
    const rows = fellows.map((f) => {
      const row = sortedBlocks.map((b) => displayByFellow[f.id]?.[b.key] ?? "");
      return [quote(f.name || f.id), ...row.map(quote)].join(",");
    });
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activePGY}_block_schedule.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!setup) {
    return (
      <main className="min-h-screen bg-background">
        <section className="container mx-auto px-4 py-10">
          <h1 className="text-2xl font-semibold font-display flex items-center gap-2">
            <HeartPulse className="h-6 w-6 text-primary" /> Block Schedule
          </h1>
          <div className="ecg-trace-static mt-2 mb-6" />
          <Card>
            <CardHeader>
              <CardTitle>Setup required</CardTitle>
            </CardHeader>
            <CardContent>
              Please configure fellows and vacations first.
              <div className="mt-4">
                <Link to="/setup">
                  <Button>Go to Vacation Preferences</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <section className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-semibold font-display flex items-center gap-2">
          <HeartPulse className="h-6 w-6 text-primary" /> Block Schedule
        </h1>
        <div className="ecg-trace-static mt-2 mb-6" />

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="font-display">Build by PGY year</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-muted-foreground">
                Academic year start: <span className="font-medium text-foreground">{setup.yearStart}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
<Tabs value={activePGY} onValueChange={(v) => setActivePGY(v as PGY | "TOTAL")}>
                  <TabsList>
                    <TabsTrigger value="PGY-4">PGY-4</TabsTrigger>
                    <TabsTrigger value="PGY-5">PGY-5</TabsTrigger>
                    <TabsTrigger value="PGY-6">PGY-6</TabsTrigger>
                    <TabsTrigger value="TOTAL">TOTAL</TabsTrigger>
                  </TabsList>
                </Tabs>
<Button variant="outline" onClick={handleBuildVacations} disabled={activePGY === "TOTAL"}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Place Vacations
                </Button>
                <Button
                  variant="outline"
                  onClick={handlePlaceRotations}
                  disabled={activePGY !== "PGY-4" || fellows.length === 0}
                >
                  <RefreshCw className="mr-2 h-4 w-4" /> Place Rotations (PGY-4)
                </Button>
                <Button
                  variant="outline"
                  onClick={handlePlaceRotationsPGY5}
                  disabled={activePGY !== "PGY-5" || fellows.length === 0}
                >
                  <RefreshCw className="mr-2 h-4 w-4" /> Place Rotations (PGY-5)
                </Button>
                <Button
                  variant="outline"
                  onClick={handlePlaceRotationsPGY6}
                  disabled={activePGY !== "PGY-6" || fellows.length === 0}
                >
                  <RefreshCw className="mr-2 h-4 w-4" /> Place Rotations (PGY-6)
                </Button>
                <Button
                  variant="outline"
                  onClick={handleClearRotations}
                  disabled={(activePGY !== "PGY-4" && activePGY !== "PGY-5" && activePGY !== "PGY-6") || !schedule}
                >
                  <Eraser className="mr-2 h-4 w-4" /> Clear Rotations
                </Button>
                <Button variant="outline" onClick={exportCSV} disabled={fellows.length === 0}>
                  <Download className="mr-2 h-4 w-4" /> Export CSV
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-3">
          <div className={`rounded-md border overflow-x-auto md:col-span-3`}>
            <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
              <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[220px] sticky left-0 bg-background z-10">Fellow</TableHead>
                  <TableHead className="min-w-[200px]">Vacation Preferences</TableHead>
                  {sortedBlocks.map((b) => (
                    <TableHead key={b.key} className="text-center min-w-[90px]">
                      <div className="font-mono text-xs">{b.key}</div>
                      <div className="text-[10px] text-muted-foreground">{b.label}</div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {fellows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2 + sortedBlocks.length} className="text-center text-muted-foreground">
                      No fellows for {activePGY}.
                    </TableCell>
                  </TableRow>
                ) : (
                  fellows.map((f) => (
                    <TableRow key={f.id} className={`${f.pgy === "PGY-4" ? "bg-[hsl(var(--pgy4))] hover:bg-[hsl(var(--pgy4))]" : f.pgy === "PGY-5" ? "bg-[hsl(var(--pgy5))] hover:bg-[hsl(var(--pgy5))]" : "bg-[hsl(var(--pgy6))] hover:bg-[hsl(var(--pgy6))]"}`}>
                      <TableCell className={`min-w-[220px] sticky left-0 z-10 font-medium ${f.pgy === "PGY-4" ? "bg-[hsl(var(--pgy4))]" : f.pgy === "PGY-5" ? "bg-[hsl(var(--pgy5))]" : "bg-[hsl(var(--pgy6))]"}`}>
                        {f.name || <span className="text-muted-foreground">Unnamed fellow</span>}
                      </TableCell>
                      <TableCell className="min-w-[200px]">
                        <div className="flex flex-wrap gap-1">
                          {Array.from(new Set((f.vacationPrefs || []).filter((k): k is string => !!k))).length > 0 ? (
                            Array.from(new Set((f.vacationPrefs || []).filter((k): k is string => !!k))).map((k) => (
                              <Badge key={k} variant={displayByFellow[f.id]?.[k] === "VAC" ? "destructive" : "secondary"}>{k}</Badge>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">No prefs</span>
                          )}
                        </div>
                      </TableCell>
                       {sortedBlocks.map((b) => {
                         const label = displayByFellow[f.id]?.[b.key];
                         return (
                           <DroppableCell
                             key={b.key}
                             id={`${f.id}-${b.key}`}
                             className={`text-center ${activePGY !== "TOTAL" ? "cursor-pointer hover:bg-muted/30" : ""}`}
                           >
                              {label ? (
                                activePGY !== "TOTAL" ? (
                                  <DraggableBadge
                                    id={`${f.id}-${b.key}`}
                                    variant={
                                      label === "VAC"
                                        ? "destructive"
                                        : label === "LAC_CATH"
                                        ? "rot-lac-cath"
                                        : label === "CCU"
                                        ? "rot-ccu"
                                        : label === "LAC_CONSULT"
                                        ? "rot-lac-consult"
                                        : label === "HF"
                                        ? "rot-hf"
                                        : label === "KECK_CONSULT"
                                        ? "rot-keck-consult"
                                        : label === "ECHO1"
                                        ? "rot-echo1"
                                        : label === "ECHO2"
                                        ? "rot-echo2"
                                        : label === "EP"
                                        ? "rot-ep"
                                        : label === "NUCLEAR"
                                        ? "rot-nuclear"
                                        : label === "NONINVASIVE"
                                        ? "rot-noninvasive"
                                        : "rot-elective"
                                    }
                                    onClick={() => openEdit(f.id, b.key)}
                                  >
                                    {label === "VAC" ? "Vacation" : label}
                                  </DraggableBadge>
                                ) : (
                                  <Badge
                                    variant={
                                      label === "VAC"
                                        ? "destructive"
                                        : label === "LAC_CATH"
                                        ? "rot-lac-cath"
                                        : label === "CCU"
                                        ? "rot-ccu"
                                        : label === "LAC_CONSULT"
                                        ? "rot-lac-consult"
                                        : label === "HF"
                                        ? "rot-hf"
                                        : label === "KECK_CONSULT"
                                        ? "rot-keck-consult"
                                        : label === "ECHO1"
                                        ? "rot-echo1"
                                        : label === "ECHO2"
                                        ? "rot-echo2"
                                        : label === "EP"
                                        ? "rot-ep"
                                        : label === "NUCLEAR"
                                        ? "rot-nuclear"
                                        : label === "NONINVASIVE"
                                        ? "rot-noninvasive"
                                        : "rot-elective"
                                    }
                                  >
                                    {label === "VAC" ? "Vacation" : label}
                                  </Badge>
                                )
                              ) : (
                                <div
                                  className="w-full h-full flex items-center justify-center"
                                  onClick={activePGY !== "TOTAL" ? () => openEdit(f.id, b.key) : undefined}
                                  title={activePGY !== "TOTAL" ? "Click to edit" : undefined}
                                >
                                  <span className="text-xs text-muted-foreground">&nbsp;</span>
                                </div>
                              )}
                           </DroppableCell>
                         );
                       })}
                    </TableRow>
                  ))
                )}
               </TableBody>
             </Table>
             <DragOverlay>
               {dragData && (
                 <Badge variant="outline" className="opacity-80">
                   {dragData.rotation === "VAC" ? "Vacation" : dragData.rotation}
                 </Badge>
               )}
             </DragOverlay>
           </DndContext>
         </div>

        </div>

        {activePGY !== "TOTAL" && (
          <>
            <button
              aria-expanded={panelOpen}
              onClick={() => setPanelOpen((v) => !v)}
              className="fixed bottom-4 right-4 z-50 inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground shadow-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <span className="text-sm font-medium">Validation</span>
              {panelOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
            {panelOpen && <div className="h-48" />}
            <aside className={`fixed bottom-0 left-0 right-0 border-t bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 transition-transform duration-300 z-40 ${panelOpen ? "translate-y-0" : "translate-y-full"}`}>
              <div className="container mx-auto px-4 py-3 space-y-3 max-h-[65vh] overflow-y-auto">
                <div className="flex items-center justify-between">
                  <div className="font-display font-semibold">Validation</div>
                  <div className="text-xs text-muted-foreground">Per-block counts and per-fellow overview</div>
                </div>

                  <div className="overflow-x-auto">
                    <div
                      className="grid gap-y-1"
                      style={{ gridTemplateColumns: `64px repeat(${rotationsInUseCombined.length}, minmax(88px,auto))` }}
                    >
                      {sortedBlocks.map((b) => (
                        <div key={b.key} className="contents">
                          <div className="w-16 truncate text-xs text-muted-foreground">{b.key}</div>
                          {rotationsInUseCombined.map((rot) => {
                            const c = blockRotationCounts[b.key]?.[rot] || 0;
                            const variant =
                              rot === "VAC"
                                ? "destructive"
                                : rot === "LAC_CATH"
                                ? "rot-lac-cath"
                                : rot === "CCU"
                                ? "rot-ccu"
                                : rot === "LAC_CONSULT"
                                ? "rot-lac-consult"
                                : rot === "HF"
                                ? "rot-hf"
                                : rot === "KECK_CONSULT"
                                ? "rot-keck-consult"
                                : rot === "ECHO1"
                                ? "rot-echo1"
                                : rot === "ECHO2"
                                ? "rot-echo2"
                                : rot === "EP"
                                ? "rot-ep"
                                : rot === "NUCLEAR"
                                ? "rot-nuclear"
                                : rot === "NONINVASIVE"
                                ? "rot-noninvasive"
                                : "rot-elective";
                            const baseLabel = rot === "VAC" ? "VACATION" : rot === "ELECTIVE" ? "ELECTIVE" : rot;
                            const plural = c === 1 ? "" : baseLabel.endsWith("S") ? "" : "S";
                            return (
                              <div key={rot} className="flex items-center justify-center">
                                {c > 0 ? (
                                  <Badge variant={variant as any} className="text-[10px] px-2 py-0.5">
                                    {c} {baseLabel}
                                    {plural}
                                  </Badge>
                                ) : (
                                  <span className="invisible text-[10px] px-2 py-0.5">0</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>

                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">Per-fellow status</div>
                  <div className="overflow-x-auto">
                    <div
                      className="grid gap-y-1"
                      style={{ gridTemplateColumns: `160px repeat(${rotationsInUseCombined.length}, minmax(88px,auto))` }}
                    >
                      {fellows.map((f) => {
                        const counts = perFellowCounts[f.id] || {};
                        return (
                          <div key={f.id} className="contents">
                            <div className="w-40 truncate text-xs text-muted-foreground">
                              {f.name || "Unnamed fellow"}
                            </div>
                            {rotationsInUseCombined.map((rot) => {
                              const c = counts[rot] || 0;
                              const variant =
                                rot === "VAC"
                                  ? "destructive"
                                  : rot === "LAC_CATH"
                                  ? "rot-lac-cath"
                                  : rot === "CCU"
                                  ? "rot-ccu"
                                  : rot === "LAC_CONSULT"
                                  ? "rot-lac-consult"
                                  : rot === "HF"
                                  ? "rot-hf"
                                  : rot === "KECK_CONSULT"
                                  ? "rot-keck-consult"
                                  : rot === "ECHO1"
                                  ? "rot-echo1"
                                  : rot === "ECHO2"
                                  ? "rot-echo2"
                                  : rot === "EP"
                                  ? "rot-ep"
                                  : rot === "NUCLEAR"
                                  ? "rot-nuclear"
                                  : rot === "NONINVASIVE"
                                  ? "rot-noninvasive"
                                  : "rot-elective";
                              const baseLabel = rot === "VAC" ? "VACATION" : rot === "ELECTIVE" ? "ELECTIVE" : rot;
                              const plural = c === 1 ? "" : baseLabel.endsWith("S") ? "" : "S";
                              return (
                                <div key={rot} className="flex items-center justify-center">
                                  {c > 0 ? (
                                    <Badge variant={variant as any} className="text-[10px] px-2 py-0.5">
                                      {c} {baseLabel}
                                      {plural}
                                    </Badge>
                                  ) : (
                                    <span className="invisible text-[10px] px-2 py-0.5">0</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {Object.keys(displayByFellow).length === 0 && (
                  <div className="text-xs text-muted-foreground">Run "Place Vacations" to generate a draft.</div>
                )}
              </div>
            </aside>
          </>
        )}

        <BlockEditDialog
          open={edit.open}
          onOpenChange={(v) => setEdit((e) => ({ ...e, open: v }))}
          fellowName={selectedFellow?.name || selectedFellow?.id || ""}
          blockKey={selectedBlock?.key || ""}
          blockLabel={selectedBlock?.label || ""}
          currentLabel={currentLabelForEdit}
          options={rotationOptions}
          onApply={(val) => applyEdit(val)}
        />

        <VacationConflictDialog
          open={vacationConflictDialog.open}
          onOpenChange={(open) => 
            setVacationConflictDialog(prev => ({ ...prev, open }))
          }
          onConfirm={() => {
            if (vacationConflictDialog.pendingAction) {
              vacationConflictDialog.pendingAction();
            }
          }}
          fellowName={vacationConflictDialog.fellowName}
          blockKey={vacationConflictDialog.blockKey}
          conflictingFellow={vacationConflictDialog.conflictingFellow}
        />
      </section>
    </main>
  );
}

function quote(s: string) {
  if (s.includes(",") || s.includes("\n") || s.includes('"')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toAcademicYearJuly1(startIso: string): string {
  const d = new Date(startIso);
  if (isNaN(d.getTime())) {
    const y = new Date().getFullYear();
    return `${y}-07-01`;
  }
  const y = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-07-01`;
}

const MONTH_ORDER = [
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
] as const;

function sortJulToJun(blocks: BlockInfo[]): BlockInfo[] {
  const order = new Map<string, number>(MONTH_ORDER.map((m, i) => [m, i] as const));
  return [...blocks].sort((a, b) => {
    const oa = order.get(a.key.slice(0, 3)) ?? 0;
    const ob = order.get(b.key.slice(0, 3)) ?? 0;
    if (oa !== ob) return oa - ob;
    return a.half - b.half;
  });
}
