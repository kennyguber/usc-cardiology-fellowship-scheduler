import { useDraggable } from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import { GripVertical } from "lucide-react";

interface DraggableBadgeProps {
  id: string;
  variant: string;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}

export function DraggableBadge({ id, variant, children, onClick, disabled }: DraggableBadgeProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({
    id,
    disabled,
  });

  return (
    <div 
      ref={setNodeRef} 
      className={`inline-flex items-center gap-1 ${isDragging ? 'opacity-50' : ''}`}
      {...attributes}
      {...listeners}
    >
      <Badge 
        variant={variant as any} 
        className="cursor-pointer flex items-center gap-1"
        onClick={onClick}
      >
        <GripVertical className="h-3 w-3 text-muted-foreground" />
        {children}
      </Badge>
    </div>
  );
}