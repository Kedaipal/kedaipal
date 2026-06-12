import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	DragOverlay,
	KeyboardSensor,
	MeasuringStrategy,
	type Modifier,
	PointerSensor,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	rectSortingStrategy,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS, getEventCoordinates } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { type ReactNode, useState } from "react";

/**
 * Vertically centre the floating overlay on the cursor — measured from the
 * OVERLAY's own (compact) rect. Rows collapse to a short form while dragging, so
 * the overlay is much shorter than the card you grabbed; without this the overlay
 * anchors to the tall source's geometry and drifts off the cursor (worse for the
 * taller QR cards). We snap only the Y axis (the drift is vertical) and leave the
 * horizontal transform natural, so the full-width row stays in its column instead
 * of sliding sideways. Derived from dnd-kit's `snapCenterToCursor`.
 */
const snapVerticalCenterToCursor: Modifier = ({
	activatorEvent,
	draggingNodeRect,
	transform,
}) => {
	if (draggingNodeRect && activatorEvent) {
		const coords = getEventCoordinates(activatorEvent);
		if (!coords) return transform;
		const offsetY = coords.y - draggingNodeRect.top;
		return {
			...transform,
			y: transform.y + offsetY - draggingNodeRect.height / 2,
		};
	}
	return transform;
};

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

/** State passed to a sortable row's `renderItem` so it can adapt while dragging. */
export type SortableItemState = {
	/** This specific row is the one being dragged (its in-list slot). */
	isDragging: boolean;
	/** A drag is in progress in this list — render a compact row. */
	isSorting: boolean;
	/** This render is the floating `DragOverlay` copy following the cursor. */
	isOverlay: boolean;
};

/**
 * Generic drag-to-reorder vertical list (touch + mouse + keyboard). The caller
 * keeps the ordered `items`; on drop we hand back the **new id order** so the
 * caller can reorder its own state. `renderItem` receives a ready-made grip
 * `handle` (drag listeners live ONLY on the handle, so buttons/inputs elsewhere
 * keep working) and a `state`:
 * - `state.isSorting` — a drag is active; collapse rows to a compact one-line
 *   form so a tall list stays easy to rearrange.
 * - `state.isOverlay` — this is the floating copy following the cursor.
 *
 * The moving card renders in a **`DragOverlay`** (a portal) so it tracks the
 * cursor independently of the list reflow — without it, collapsing rows above
 * the dragged one would shift the layout and the card would drift off the
 * cursor. The in-list slot of the dragged item is hidden (opacity 0) while the
 * overlay shows the moving copy. `MeasuringStrategy.Always` re-measures as rows
 * collapse so drop positions stay correct.
 */
export function SortableList<T>({
	items,
	getId,
	onReorder,
	renderItem,
	className = "flex flex-col gap-2",
	strategy = "list",
}: {
	items: ReadonlyArray<T>;
	getId: (item: T) => string;
	onReorder: (orderedIds: string[]) => void;
	renderItem: (
		item: T,
		handle: ReactNode,
		state: SortableItemState,
	) => ReactNode;
	className?: string;
	/**
	 * `"list"` — vertical single column (default). `"grid"` — a responsive grid
	 * (rows reflow in 2D); the caller supplies grid classes via `className`.
	 */
	strategy?: "list" | "grid";
}) {
	const sensors = useSortableSensors();
	const [activeId, setActiveId] = useState<string | null>(null);
	const ids = items.map(getId);
	const activeItem =
		activeId !== null
			? (items.find((i) => getId(i) === activeId) ?? null)
			: null;

	function handleDragEnd(event: DragEndEvent) {
		setActiveId(null);
		const { active, over } = event;
		if (!over || active.id === over.id) return;
		const oldIndex = ids.indexOf(String(active.id));
		const newIndex = ids.indexOf(String(over.id));
		if (oldIndex < 0 || newIndex < 0) return;
		onReorder(arrayMove(ids, oldIndex, newIndex));
	}

	// A non-interactive grip for the overlay copy (the real handle has the drag
	// listeners; the overlay just needs the same visual).
	const overlayHandle = (
		<span className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground">
			<GripVertical className="size-4" />
		</span>
	);

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
			onDragStart={(event) => setActiveId(String(event.active.id))}
			onDragCancel={() => setActiveId(null)}
			onDragEnd={handleDragEnd}
		>
			<SortableContext
				items={ids}
				strategy={
					strategy === "grid"
						? rectSortingStrategy
						: verticalListSortingStrategy
				}
			>
				<ul className={className}>
					{items.map((item) => (
						<SortableRow
							key={getId(item)}
							id={getId(item)}
							item={item}
							isSorting={activeId !== null}
							renderItem={renderItem}
						/>
					))}
				</ul>
			</SortableContext>
			<DragOverlay modifiers={[snapVerticalCenterToCursor]}>
				{activeItem
					? renderItem(activeItem, overlayHandle, {
							isDragging: true,
							isSorting: true,
							isOverlay: true,
						})
					: null}
			</DragOverlay>
		</DndContext>
	);
}

function SortableRow<T>({
	id,
	item,
	isSorting,
	renderItem,
}: {
	id: string;
	item: T;
	isSorting: boolean;
	renderItem: (
		item: T,
		handle: ReactNode,
		state: SortableItemState,
	) => ReactNode;
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
		// Hide the in-list slot of the dragged item — the DragOverlay renders the
		// moving copy. The slot still occupies (compact) space so the gap is right.
		opacity: isDragging ? 0 : undefined,
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
			{renderItem(item, handle, { isDragging, isSorting, isOverlay: false })}
		</li>
	);
}
