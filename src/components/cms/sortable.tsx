"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useId, type ReactNode } from "react";
import { GripIcon } from "./primitives";

export interface HandleProps {
  /** Spredes på grebs-knappen. */
  handle: ReactNode;
  isDragging: boolean;
}

/**
 * Sorterbar liste med trækhåndtag (dnd-kit). Trækning sker kun via grebet; tastatur: mellemrum løfter, piletaster flytter,
 * mellemrum slipper, Escape fortryder. Berøring understøttes. Et tyndt guldstreg viser, hvor rækken lander.
 */
export function SortableList<T extends { id: string }>({
  items,
  label,
  itemLabel,
  onReorder,
  renderItem,
  className = "",
}: {
  items: T[];
  /** Beskrivelse til skærmlæsere, fx "spørgsmål" */
  label: string;
  itemLabel: (item: T) => string;
  onReorder: (orderedIds: string[]) => void;
  renderItem: (item: T, h: HandleProps) => ReactNode;
  className?: string;
}) {
  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = items.map((i) => i.id);
  const name = (id: string | number) => {
    const it = items.find((i) => i.id === id);
    return it ? itemLabel(it) : String(id);
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Løftede ${label} «${name(active.id)}». Brug piletaster til at flytte, mellemrum for at slippe og Escape for at fortryde.`,
    onDragOver: ({ active, over }) => (over ? `«${name(active.id)}» er nu over position ${ids.indexOf(String(over.id)) + 1} af ${ids.length}.` : undefined),
    onDragEnd: ({ active, over }) =>
      over ? `«${name(active.id)}» er placeret på position ${ids.indexOf(String(over.id)) + 1} af ${ids.length}.` : `«${name(active.id)}» blev sluppet uden at flytte.`,
    onDragCancel: ({ active }) => `Flytning af «${name(active.id)}» er fortrudt.`,
  };
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    onReorder(next);
  };
  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: `Tryk på mellemrum for at løfte ${label}. Brug piletasterne til at flytte op eller ned. Tryk på mellemrum igen for at slippe, eller Escape for at fortryde.`,
        },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className={className} aria-label={`Rækkefølge af ${label}`}>
          {items.map((item) => (
            <Row key={item.id} id={item.id} label={`${label} «${itemLabel(item)}»`}>
              {(h) => renderItem(item, h)}
            </Row>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function Row({ id, label, children }: { id: string; label: string; children: (h: HandleProps) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isOver, index, activeIndex } = useSortable({ id });
  const showLine = isOver && !isDragging;
  const lineAtTop = activeIndex > index;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative ${isDragging ? "z-10 opacity-70" : ""}`}
    >
      {showLine && <span className={`pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-gold ${lineAtTop ? "-top-px" : "-bottom-px"}`} aria-hidden="true" />}
      {children({
        isDragging,
        handle: (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Flyt ${label}`}
            className="flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center text-slate hover:text-gold-ink focus-visible:text-gold-ink active:cursor-grabbing"
          >
            <GripIcon />
          </button>
        ),
      })}
    </li>
  );
}
