import { useDroppable } from "@dnd-kit/core";

interface DroppableCalendarDayProps {
  id: string;
  children: React.ReactNode;
  className?: string;
}

export function DroppableCalendarDay({ id, children, className }: DroppableCalendarDayProps) {
  const { isOver, setNodeRef } = useDroppable({
    id,
  });

  return (
    <div 
      ref={setNodeRef}
      className={`${className} ${isOver ? 'ring-2 ring-primary ring-offset-2' : ''} transition-all`}
    >
      {children}
    </div>
  );
}