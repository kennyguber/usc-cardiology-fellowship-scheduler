import type { Rotation } from "@/lib/rotation-engine";

/**
 * Get a display-friendly name for a rotation
 */
export function getRotationDisplayName(rotation: Rotation): string {
  if (rotation === "VAC") return "Vacation";
  
  if (rotation.startsWith("ELECTIVE (")) {
    const match = rotation.match(/ELECTIVE \((.+)\)/);
    const specialty = match?.[1] || "";
    return `Elective (${specialty})`;
  }
  
  return rotation;
}

/**
 * Get the CSS class variant for a rotation badge
 */
export function getRotationBadgeVariant(rotation: Rotation): string {
  // For elective specializations, use the underlying rotation's style
  if (rotation.startsWith("ELECTIVE (")) {
    const match = rotation.match(/ELECTIVE \((.+)\)/);
    const specialty = match?.[1] || "";
    return getRotationBadgeVariant(specialty as Rotation);
  }
  
  // Map rotation to badge variant
  const rotationToVariant: Record<string, string> = {
    "LAC_CATH": "rot-lac-cath",
    "CCU": "rot-ccu", 
    "LAC_CONSULT": "rot-lac-consult",
    "HF": "rot-hf",
    "KECK_CONSULT": "rot-keck-consult",
    "ECHO1": "rot-echo1",
    "ECHO2": "rot-echo2",
    "EP": "rot-ep",
    "NUCLEAR": "rot-nuclear",
    "NONINVASIVE": "rot-noninvasive",
    "ELECTIVE": "rot-elective",
    "VAC": "secondary"
  };
  
  return rotationToVariant[rotation] || "default";
}

/**
 * Check if a rotation is an elective specialization
 */
export function isElectiveSpecialization(rotation: Rotation): boolean {
  return rotation.startsWith("ELECTIVE (") && rotation !== "ELECTIVE";
}

/**
 * Get the base rotation type from an elective specialization
 */
export function getElectiveSpecializationType(rotation: Rotation): Rotation | null {
  if (!isElectiveSpecialization(rotation)) return null;
  
  const match = rotation.match(/ELECTIVE \((.+)\)/);
  return match ? (match[1] as Rotation) : null;
}