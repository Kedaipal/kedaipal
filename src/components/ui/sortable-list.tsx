import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The mobile-safe sensor set for all drag-to-reorder lists. Shared so every
 * sortable surface behaves identically on phone + desktop:
 * - PointerSensor (mouse/pen): an 8px drag must elapse before a drag starts, so
 *   clicks on buttons/inputs inside a row aren't misread as drags.
 * - TouchSensor: a 250ms hold disambiguates "drag" from "scroll/tap" — combined
 *   with `touch-none` on the grip handle, the page scrolls normally and a drag
 *   only begins after a deliberate long-press of the handle.
 * - KeyboardSensor: arrow-key reordering for a11y.
 */
export function useSortableSensors() {
	return useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 250, tolerance: 5 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);
}

/**
 * Generic drag-to-reorder vertical list (touch + mouse + keyboard). The caller
 * keeps the ordered `items`; on drop we hand back the **new id order** so the
 * caller can reorder its own state. `renderItem` receives a ready-made grip
 * `handle` to place inside its row — drag listeners live ONLY on the handle, so
 * buttons/inputs elsewhere in the row keep working.
 */
export function SortableList<T>({
	items,
	getId,
	onReorder,
	renderItem,
	className = "flex flex-col gap-2",
}: {
	items: ReadonlyArray<T>;
	getId: (item: T) => string;
	onReorder: (orderedIds: string[]) => void;
	renderItem: (item: T, handle: ReactNode, isDragging: boolean) => ReactNode;
	className?: string;
}) {
	const sensors = useSortableSensors();
	const ids = items.map(getId);

	function handleDragEnd(event: DragEndEvent) {
		const { active, over } = event;
		if (!over || active.id === over.id) return;
		const oldIndex = ids.indexOf(String(active.id));
		const newIndex = ids.indexOf(String(over.id));
		if (oldIndex < 0 || newIndex < 0) return;
		onReorder(arrayMove(ids, oldIndex, newIndex));
	}

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			onDragEnd={handleDragEnd}
		>
			<SortableContext items={ids} strategy={verticalListSortingStrategy}>
				<ul className={className}>
					{items.map((item) => (
						<SortableRow
							key={getId(item)}
							id={getId(item)}
							item={item}
							renderItem={renderItem}
						/>
					))}
				</ul>
			</SortableContext>
		</DndContext>
	);
}

function SortableRow<T>({
	id,
	item,
	renderItem,
}: {
	id: string;
	item: T;
	renderItem: (item: T, handle: ReactNode, isDragging: boolean) => ReactNode;
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id });
	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		zIndex: isDragging ? 10 : undefined,
	};
	// `touch-none` is critical on mobile — without it the page scrolls while the
	// user tries to drag the handle. ≥44px tap target (size-11) for mobile.
	const handle = (
		<button
			type="button"
			aria-label="Drag to reorder"
			{...attributes}
			{...listeners}
			className="flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted active:cursor-grabbing"
		>
			<GripVertical className="size-4" />
		</button>
	);

	return (
		<li ref={setNodeRef} style={style}>
			{renderItem(item, handle, isDragging)}
		</li>
	);
}
