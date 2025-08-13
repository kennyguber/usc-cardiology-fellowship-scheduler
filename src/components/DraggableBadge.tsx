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
    >
      <Badge 
        variant={variant as any} 
        className="cursor-pointer flex items-center gap-1"
        onClick={onClick}
      >
        <div 
          className="flex items-center cursor-grab active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3 w-3 text-muted-foreground" />
        </div>
        <span>{children}</span>
      </Badge>
    </div>
  );
}