import { Badge } from "@/components/ui/badge";
import { getRotationDisplayName, getRotationBadgeVariant, isElectiveSpecialization } from "@/lib/rotation-utils";
import type { Rotation } from "@/lib/rotation-engine";

interface RotationBadgeProps {
  rotation: Rotation;
  className?: string;
}

export function RotationBadge({ rotation, className }: RotationBadgeProps) {
  const displayName = getRotationDisplayName(rotation);
  const variant = getRotationBadgeVariant(rotation);
  
  return (
    <Badge 
      variant={variant as any}
      className={className}
      title={isElectiveSpecialization(rotation) ? `Elective specialization in ${rotation.match(/\((.+)\)/)?.[1]}` : undefined}
    >
      {displayName}
    </Badge>
  );
}