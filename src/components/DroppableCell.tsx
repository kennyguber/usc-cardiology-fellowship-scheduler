import { useDroppable } from "@dnd-kit/core";
import { TableCell } from "@/components/ui/table";

interface DroppableCellProps {
  id: string;
  children: React.ReactNode;
  className?: string;
}

export function DroppableCell({ id, children, className }: DroppableCellProps) {
  const { isOver, setNodeRef } = useDroppable({
    id,
  });

  return (
    <TableCell 
      ref={setNodeRef}
      className={`${className} ${isOver ? 'bg-primary/10 border-primary border-2' : ''} transition-colors`}
    >
      {children}
    </TableCell>
  );
}