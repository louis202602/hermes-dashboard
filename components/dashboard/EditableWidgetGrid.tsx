"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EyeOff, GripVertical, Maximize2 } from "lucide-react";
import type { ReactNode } from "react";

import {
  cycleWidgetSize,
  type ResolvedWidgetItem,
  type WidgetSize,
} from "@/lib/dashboard/widgets";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/languages";

const SIZE_SHORT: Record<WidgetSize, string> = {
  small: "S",
  medium: "M",
  large: "L",
};

type Props = {
  items: ResolvedWidgetItem[]; // visible, in order
  renderWidget: (id: string) => ReactNode;
  onReorder: (orderedIds: string[]) => void;
  onResize: (id: string, size: WidgetSize) => void;
  onHide: (id: string) => void;
};

function SortableWidget({
  item,
  children,
  onResize,
  onHide,
}: {
  item: ResolvedWidgetItem;
  children: ReactNode;
  onResize: (id: string, size: WidgetSize) => void;
  onHide: (id: string) => void;
}) {
  const { t } = useI18n();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const canResize = item.supportedSizes.length > 1;
  const name = t(`widget.${item.id}` as MessageKey);

  return (
    <section
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={`dash-widget size-${item.size} is-editing${isDragging ? " is-dragging" : ""}`}
      aria-roledescription={t("edit.widgetRole")}
    >
      <div className="widget-edit-bar">
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="widget-drag-handle"
          aria-label={t("edit.drag", { name })}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} strokeWidth={1.8} aria-hidden />
        </button>
        <span className="widget-edit-name">{name}</span>
        {canResize ? (
          <button
            type="button"
            className="widget-edit-btn"
            aria-label={t("edit.resize", { name, size: item.size })}
            onClick={() => onResize(item.id, cycleWidgetSize(item.id, item.size))}
          >
            <Maximize2 size={14} strokeWidth={1.8} aria-hidden />
            <span>{SIZE_SHORT[item.size]}</span>
          </button>
        ) : null}
        <button
          type="button"
          className="widget-edit-btn"
          aria-label={t("edit.hide", { name })}
          onClick={() => onHide(item.id)}
        >
          <EyeOff size={14} strokeWidth={1.8} aria-hidden />
        </button>
      </div>
      <div className="widget-edit-body" aria-hidden={isDragging}>
        {children}
      </div>
    </section>
  );
}

/**
 * DASH-4C — edit-mode sortable grid. Loaded ONLY when the user enters edit mode
 * (dynamic import), so the dnd-kit bundle never touches the normal dashboard path.
 * Touch uses a long-press activation (250ms) so vertical scroll never conflicts with
 * drag; keyboard reorder via the sortable coordinate getter; pointer needs an 8px
 * move to start. Layout is committed by the parent on drag-end / resize / hide only
 * — never during pointer move.
 */
export default function EditableWidgetGrid({
  items,
  renderWidget,
  onReorder,
  onResize,
  onHide,
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const ids = items.map((it) => it.id);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className="dashboard-widgets is-edit-mode">
          {items.map((item) => (
            <SortableWidget
              key={item.id}
              item={item}
              onResize={onResize}
              onHide={onHide}
            >
              {renderWidget(item.id)}
            </SortableWidget>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
