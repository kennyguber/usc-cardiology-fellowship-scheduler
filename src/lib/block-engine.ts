import type { BlockInfo } from "@/lib/block-utils";
import type { Fellow, StoredSchedule } from "@/lib/schedule-engine";
import type { Rotation } from "@/lib/rotation-engine";
import { loadSchedule } from "@/lib/schedule-engine";

export type BlockSwapResult = {
  success: boolean;
  schedule?: StoredSchedule;
  error?: string;
};

type BlockChange = {
  fellowId: string;
  blockKey: string;
  rotation: Rotation | undefined;
};

export function previewBlockScheduleChange(
  currentSchedule: StoredSchedule,
  changes: BlockChange[]
): Record<string, Record<string, string | undefined>> {
  const preview = { ...(currentSchedule.byFellow || {}) };
  
  for (const change of changes) {
    if (!preview[change.fellowId]) {
      preview[change.fellowId] = {};
    }
    preview[change.fellowId] = { ...preview[change.fellowId] };
    
    if (change.rotation === undefined) {
      delete preview[change.fellowId][change.blockKey];
    } else {
      preview[change.fellowId][change.blockKey] = change.rotation;
    }
  }
  
  return preview;
}

export function validateBlockScheduleChange(
  currentSchedule: StoredSchedule,
  changes: BlockChange[],
  blocks: BlockInfo[],
  fellows: Fellow[]
): { success: boolean; error?: string } {
  const previewByFellow = previewBlockScheduleChange(currentSchedule, changes);
  const pgy = currentSchedule.pgy;
  
  // Build helper maps
  const keyToMonth = new Map<string, number>();
  const monthToKeys = new Map<number, string[]>();
  blocks.forEach((b) => {
    keyToMonth.set(b.key, b.monthIndex);
    const arr = monthToKeys.get(b.monthIndex) || [];
    arr.push(b.key);
    monthToKeys.set(b.monthIndex, arr);
  });
  
  const withinJanToJun = (mi: number) => mi >= 6 && mi <= 11;
  const isAdjacentMonth = (a: number, b: number) => Math.abs(a - b) === 1;
  
  // Validate each affected fellow
  const affectedFellows = new Set(changes.map(c => c.fellowId));
  
  for (const fellowId of affectedFellows) {
    const row = previewByFellow[fellowId] || {};
    
    // Vacation validation
    const vacKeys = Object.entries(row)
      .filter(([, v]) => v === "VAC")
      .map(([k]) => k);
    
    // Check vacation conflicts (only one vacation per block across all fellows)
    for (const vacKey of vacKeys) {
      const conflictInBlock = Object.entries(previewByFellow).some(
        ([fid, frow]) => fid !== fellowId && frow?.[vacKey] === "VAC"
      );
      if (conflictInBlock) {
        return { success: false, error: `Vacation conflict: Another fellow already has vacation in block ${vacKey}` };
      }
    }
    
    // Max 2 vacations per fellow
    if (vacKeys.length > 2) {
      return { success: false, error: `Vacation limit: Fellow would have ${vacKeys.length} vacations (max 2 allowed)` };
    }
    
    // Vacation spacing (≥6 blocks apart)
    if (vacKeys.length > 1) {
      const indices = vacKeys
        .map(k => blocks.findIndex(b => b.key === k))
        .filter(i => i >= 0)
        .sort((a, b) => a - b);
      for (let i = 1; i < indices.length; i++) {
        if (indices[i] - indices[i - 1] < 6) {
          return { success: false, error: "Vacations must be at least 6 blocks apart" };
        }
      }
    }
    
    // PGY-specific validations
    if (pgy === "PGY-4") {
      // HF must be full-month in Jan–Jun
      const hfKeys = Object.entries(row).filter(([, v]) => v === "HF").map(([k]) => k);
      const hfByMonth = new Map<number, string[]>();
      for (const k of hfKeys) {
        const mi = keyToMonth.get(k);
        if (mi == null) continue;
        const arr = hfByMonth.get(mi) || [];
        arr.push(k);
        hfByMonth.set(mi, arr);
      }
      
      for (const [mi, arr] of hfByMonth) {
        if (!withinJanToJun(mi)) {
          return { success: false, error: "HF month must be between January and June" };
        }
        if (arr.length !== 2) {
          return { success: false, error: "HF must be a full month (2 consecutive blocks)" };
        }
      }
      
      // CCU months cannot be consecutive
      const ccuMonths = new Set<number>();
      for (const [k, v] of Object.entries(row)) {
        if (v === "CCU") {
          const mi = keyToMonth.get(k);
          if (mi != null) ccuMonths.add(mi);
        }
      }
      const ccuList = Array.from(ccuMonths).sort((a, b) => a - b);
      for (let i = 1; i < ccuList.length; i++) {
        if (isAdjacentMonth(ccuList[i], ccuList[i - 1])) {
          return { success: false, error: "CCU months cannot be consecutive" };
        }
      }
      
      // LAC_CONSULT months cannot be consecutive
      const lacConsMonths = new Set<number>();
      for (const [k, v] of Object.entries(row)) {
        if (v === "LAC_CONSULT") {
          const mi = keyToMonth.get(k);
          if (mi != null) lacConsMonths.add(mi);
        }
      }
      const lacConsList = Array.from(lacConsMonths).sort((a, b) => a - b);
      for (let i = 1; i < lacConsList.length; i++) {
        if (isAdjacentMonth(lacConsList[i], lacConsList[i - 1])) {
          return { success: false, error: "LAC_CONSULT months cannot be consecutive" };
        }
      }
    } else if (pgy === "PGY-5") {
      // KECK_CONSULT must be exactly one full month
      const kcKeys = Object.entries(row).filter(([, v]) => v === "KECK_CONSULT").map(([k]) => k);
      if (kcKeys.length > 0) {
        const kcMonths = new Map<number, number>();
        for (const k of kcKeys) {
          const mi = keyToMonth.get(k);
          if (mi != null) kcMonths.set(mi, (kcMonths.get(mi) || 0) + 1);
        }
        const valid = Array.from(kcMonths.values()).some(c => c === 2) && kcKeys.length === 2 && kcMonths.size === 1;
        if (!valid) {
          return { success: false, error: "KECK_CONSULT must be a full month (2 blocks in same month)" };
        }
      }
      
      // HF must be non-consecutive and not adjacent to CCU
      const sortedBlocks = blocks.slice().sort((a, b) => a.monthIndex - b.monthIndex || a.half - b.half);
      const idxBy = (lab: string) =>
        Object.entries(row)
          .filter(([, v]) => v === lab)
          .map(([k]) => sortedBlocks.findIndex(b => b.key === k))
          .filter(x => x >= 0)
          .sort((a, b) => a - b);
      
      const hfIdx = idxBy("HF");
      const ccuIdx = idxBy("CCU");
      
      for (let i = 1; i < hfIdx.length; i++) {
        if (hfIdx[i] - hfIdx[i - 1] === 1) {
          return { success: false, error: "HF blocks must be non-consecutive" };
        }
      }
      
      for (const i of hfIdx) {
        for (const j of ccuIdx) {
          if (Math.abs(i - j) === 1) {
            return { success: false, error: "HF cannot be adjacent to CCU" };
          }
        }
      }
      
      // Non-consecutive for selected rotations
      const nonConLabels: Rotation[] = ["ECHO2", "EP", "NUCLEAR", "NONINVASIVE", "LAC_CATH"];
      for (const lab of nonConLabels) {
        const idxs = idxBy(lab);
        for (let i = 1; i < idxs.length; i++) {
          if (idxs[i] - idxs[i - 1] === 1) {
            return { success: false, error: `${lab} blocks must be non-consecutive` };
          }
        }
      }
      
      // Cross-PGY overlap validation
      const p4 = loadSchedule("PGY-4");
      if (p4?.byFellow) {
        const cross = new Set<Rotation>(["CCU", "KECK_CONSULT", "LAC_CONSULT", "HF", "EP"]);
        for (const [k, v] of Object.entries(row)) {
          if (!v || !cross.has(v as Rotation)) continue;
          for (const rf of Object.values(p4.byFellow)) {
            if (rf[k] === v) {
              return { success: false, error: `Cross-PGY overlap: ${v} block ${k} already assigned to PGY-4` };
            }
          }
        }
      }
    }
  }
  
  return { success: true };
}

export function applyBlockDragAndDrop(
  currentSchedule: StoredSchedule,
  dragFellowId: string,
  dragBlockKey: string,
  dropFellowId: string,
  dropBlockKey: string,
  blocks: BlockInfo[],
  fellows: Fellow[]
): BlockSwapResult {
  console.log("🔧 Block Engine - applyBlockDragAndDrop called", {
    dragFellowId,
    dragBlockKey,
    dropFellowId,
    dropBlockKey,
    currentScheduleKeys: Object.keys(currentSchedule.byFellow || {}),
    fellowsCount: fellows.length
  });

  if (!currentSchedule.byFellow) {
    console.log("❌ No schedule data available");
    return { success: false, error: "No schedule data available" };
  }
  
  const dragRotation = currentSchedule.byFellow[dragFellowId]?.[dragBlockKey];
  const dropRotation = currentSchedule.byFellow[dropFellowId]?.[dropBlockKey];
  
  console.log("🎯 Rotations:", { dragRotation, dropRotation });
  
  // If dragging to an empty cell, it's a move operation
  if (dragFellowId === dropFellowId && !dropRotation) {
    console.log("📱 Same fellow move operation (to empty cell)");
    const changes: BlockChange[] = [
      { fellowId: dragFellowId, blockKey: dragBlockKey, rotation: undefined },
      { fellowId: dropFellowId, blockKey: dropBlockKey, rotation: dragRotation as Rotation }
    ];
    
    console.log("📝 Move changes:", changes);
    
    const validation = validateBlockScheduleChange(currentSchedule, changes, blocks, fellows);
    console.log("✅ Move validation result:", validation);
    
    if (!validation.success) {
      console.log("❌ Move validation failed:", validation.error);
      return { success: false, error: validation.error };
    }
    
    const newByFellow = previewBlockScheduleChange(currentSchedule, changes);
    console.log("🔄 New byFellow after move:", newByFellow);
    
    const newSchedule: StoredSchedule = {
      ...currentSchedule,
      byFellow: newByFellow
    };
    
    console.log("✅ Move operation successful");
    return { success: true, schedule: newSchedule };
  }
  
  // Otherwise, it's a swap operation
  console.log("🔄 Swap operation");
  const changes: BlockChange[] = [
    { fellowId: dragFellowId, blockKey: dragBlockKey, rotation: dropRotation as Rotation },
    { fellowId: dropFellowId, blockKey: dropBlockKey, rotation: dragRotation as Rotation }
  ];
  
  console.log("📝 Swap changes:", changes);
  
  const validation = validateBlockScheduleChange(currentSchedule, changes, blocks, fellows);
  console.log("✅ Swap validation result:", validation);
  
  if (!validation.success) {
    console.log("❌ Swap validation failed:", validation.error);
    return { success: false, error: validation.error };
  }
  
  const newByFellow = previewBlockScheduleChange(currentSchedule, changes);
  console.log("🔄 New byFellow after swap:", newByFellow);
  
  const newSchedule: StoredSchedule = {
    ...currentSchedule,
    byFellow: newByFellow
  };
  
  console.log("✅ Swap operation successful");
  return { success: true, schedule: newSchedule };
}
