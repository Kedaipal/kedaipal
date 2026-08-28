import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	type Modifier,
} from "@dnd-kit/core";
import {
	arrayMove,
	horizontalListSortingStrategy,
	SortableContext,
	useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Link, useNavigate } from "@tanstack/react-router";
import {
	type ColumnDef,
	type ColumnSizingState,
	flexRender,
	getCoreRowModel,
	getSortedRowModel,
	type Row,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Check, ChevronsUpDown, Pin } from "lucide-react";
import { useMemo } from "react";
import {
	type CsvOrder,
	clampColumnWidth,
	ORDER_COLUMN_MAX_WIDTH,
	ORDER_COLUMN_MIN_WIDTH,
	type OrderColumn,
	orderColumnSortValue,
} from "../../../convex/lib/orderCsv";
import { MASK_PII } from "../../lib/analytics-privacy";
import { cn } from "../../lib/utils";
import { ColumnFilterMenu } from "../ui/column-filter-menu";
import { useSortableSensors } from "../ui/sortable-list";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../ui/table";
import type { OrderColumnFilterBinding } from "./order-column-filters";
import { type OrderStatus, StatusBadge } from "./status-badge";

/**
 * The orders TABLE view (86eyrtz74).
 *
 * Why it exists: sellers were exporting to Excel out of habit rather than need
 * — the inbox already filters and sorts as well as a spreadsheet does, it just
 * didn't LOOK like one. So this renders the same rows the CSV would, from the
 * same column registry (`convex/lib/orderCsv.ts`), which keeps "what I see" and
 * "what I export" the same thing — including left-to-right order, since the
 * seller's own column arrangement feeds the export.
 *
 * **Markup** is the shadcn `Table` primitives (`ui/table.tsx`) over a real
 * `<table>`, matching `customer-list.tsx`. Logic is **@tanstack/react-table**,
 * which was already a dependency. The two are complements, not alternatives:
 * shadcn's table is markup with no logic, TanStack is logic with no markup, and
 * shadcn's own "data table" is exactly this pairing.
 *
 * Column widths come from `<colgroup>` with `table-fixed`, so a long address
 * column can't collapse the rest, and each one is **draggable by its right
 * border** between `ORDER_COLUMN_MIN_WIDTH` and `ORDER_COLUMN_MAX_WIDTH`
 * (double-click the handle to restore the registry default). Widths persist per
 * store beside visibility and order.
 *
 * The header is **sticky from `lg` up, and only there**, because a sticky header
 * needs its scroll container to be bounded — see the `wrapperClassName` note on
 * `ui/table.tsx`. Below `lg` the table would need a nested VERTICAL scroll
 * region on top of its horizontal one to make that work, which is a bad trade on
 * touch, so phones keep one honest page scroll and no sticky header.
 *
 * **Row navigation** follows the house pattern: the row carries an `onClick`
 * and the Order ID cell carries a real `<Link>`. A `<tr>` cannot be an anchor,
 * so the link is what keeps middle-click, cmd-click and keyboard navigation
 * working; the row click is the convenience on top.
 *
 * **Sorting** is client-side and per-column over the window the inbox already
 * holds, so it costs no extra reads. While the table is on it REPLACES the
 * Newest/Due popover — a header you can click is what a spreadsheet user
 * reaches for first. Comparison is typed, not lexical (`orderColumnSortValue`):
 * money and times hand back their underlying number, so "125.00" doesn't sort
 * below "86.00" and "3:30 PM" doesn't sort below "9:00 AM". Empty values always
 * sink, whichever direction is active — a dateless order is unscheduled, not
 * earliest.
 *
 * **Column order** is changed by dragging the HEADERS, where every spreadsheet
 * user expects it — not from a list inside a dropdown.
 *
 * **Pinned orders** lead, and sort within their own group (see the partition
 * below). Pinning is a partition, never a competing sort key.
 *
 * Available at every width: the table scrolls inside its own container, never
 * the page, and its row controls grow to 44px touch targets below `lg`.
 */

/** The row shape: everything the registry reads, plus what the table needs to
 * render rich cells and link out. A structural superset of `CsvOrder`. */
export type TableOrder = CsvOrder & { _id: string };

export interface OrderTableProps {
	orders: TableOrder[];
	/** Visible columns, in the seller's own order. */
	columns: OrderColumn[];
	/** Resolved status label per order (honours the retailer's custom stage
	 * names) — resolved by the caller, which owns the stage config. */
	statusLabelFor: (o: TableOrder) => string;
	sorting: SortingState;
	onSortingChange: (next: SortingState) => void;
	/** New left-to-right column order, after a header drag. */
	onReorderColumns: (keys: string[]) => void;
	/** Seller-dragged widths, keyed by column. Absent = registry default. */
	columnWidths: ColumnSizingState;
	onColumnWidthsChange: (next: ColumnSizingState) => void;
	/** Header filters, keyed by column (86eyrtz74). A column with no entry
	 * simply doesn't show the funnel — its presence is what tells the seller the
	 * column is filterable. Built by `order-column-filters.ts`; the table stays
	 * presentational and knows nothing about what any filter means. */
	columnFilters?: Map<string, OrderColumnFilterBinding>;
	selectMode: boolean;
	selected: Set<string>;
	onToggleSelect: (id: string) => void;
	onTogglePin: (o: TableOrder) => void;
	pinBusyId?: string | null;
}

/**
 * Headers only travel sideways. `@dnd-kit/modifiers` isn't a dependency and
 * this is the whole of what we'd import from it, so it lives here rather than
 * growing the bundle for two lines.
 */
const horizontalOnly: Modifier = ({ transform }) => ({ ...transform, y: 0 });

/** The select + pin columns, which are not TanStack columns and never resize:
 * 44px each on touch, 40px from `lg`. Counted at the touch size so the width
 * floor is never an under-estimate. */
const CONTROL_COLUMNS_WIDTH = 88;

/** Cells the registry can't render as plain text — a badge, a link, a masked
 * name. Everything else falls through to `column.value()`, so adding a column
 * to the registry lights it up in the table with no change here. */
function Cell({
	column,
	order,
	statusLabel,
}: {
	column: OrderColumn;
	order: TableOrder;
	statusLabel: string;
}) {
	if (column.key === "status") {
		return (
			<StatusBadge status={order.status as OrderStatus} label={statusLabel} />
		);
	}
	const text = column.value(order);
	if (text === "") {
		// An em-dash reads as "nothing here"; an empty cell reads as a rendering
		// bug — and it keeps the row's baseline intact.
		return <span className="text-muted-foreground/40">—</span>;
	}
	if (column.key === "shortId") {
		// The one REAL link in the row (a <tr> can't be an anchor), so
		// middle-click, cmd-click and keyboard navigation all still work.
		return (
			<Link
				to="/app/orders/$shortId"
				params={{ shortId: order.shortId }}
				onClick={(e) => e.stopPropagation()}
				className="block truncate font-mono font-semibold hover:underline"
				title={text}
			>
				{text}
			</Link>
		);
	}
	const maskable = column.key === "customer" || column.key === "phone";
	return (
		<span
			// Mask only the customer's name + phone in session replay; items,
			// amounts and status are the useful signal (the card view's rule).
			{...(maskable ? MASK_PII : {})}
			className={cn("block truncate", column.numeric && "tabular-nums")}
			title={text}
		>
			{text}
		</span>
	);
}

/**
 * One column header: a sort button that is also the drag handle.
 *
 * There is no separate grip. The shared sensors (`useSortableSensors`) make
 * that safe — a pointer drag only starts after 8px of movement, and touch after
 * a 250ms hold — so a plain click still falls through to sorting, and the
 * seller drags the thing they actually want to move.
 */
function SortableHeader({
	id,
	label,
	numeric,
	sortDir,
	onToggleSort,
	onResizeStart,
	onResizeReset,
	onResizeBy,
	width,
	isResizing,
	isLast,
	filter,
}: {
	id: string;
	label: string;
	numeric?: boolean;
	sortDir: false | "asc" | "desc";
	onToggleSort: ((e: unknown) => void) | undefined;
	/** TanStack's resize handler — bound to BOTH mouse and touch starts, which
	 * is the shape it expects; a pointer-only binding leaves touch dragging
	 * dead, because the move/end listeners it attaches are per-input-type. */
	onResizeStart: (e: unknown) => void;
	onResizeReset: () => void;
	/** Nudge by a signed number of px — the keyboard path (see the handle). */
	onResizeBy: (delta: number) => void;
	/** Current rendered width, for `aria-valuenow`. */
	width: number;
	isResizing: boolean;
	/** The right-most column has no neighbour to give width to, so it gets a
	 * divider but no handle — a drag there would just push the table wider with
	 * nothing to show for it. */
	isLast: boolean;
	/** This column's header filter, when it has one. */
	filter?: OrderColumnFilterBinding;
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id });
	const SortIcon =
		sortDir === "asc"
			? ArrowUp
			: sortDir === "desc"
				? ArrowDown
				: ChevronsUpDown;
	return (
		<TableHead
			ref={setNodeRef}
			style={{
				transform: CSS.Transform.toString(transform),
				transition,
			}}
			className={cn(
				// Solid, not translucent: once the header actually sticks (lg+), rows
				// scrolling underneath must not show through it.
				"group/head relative bg-muted",
				isDragging && "z-20 bg-card shadow-lg",
			)}
		>
			{/* The label (sort + drag) and the funnel share the cell. `pr-1.5` keeps
			    the funnel clear of the resize handle straddling the border. */}
			<div
				className={cn(
					"flex min-w-0 items-center gap-1 pr-1.5",
					numeric && "flex-row-reverse",
				)}
			>
				<button
					type="button"
					// `touch-none` is what lets a held header drag instead of scrolling
					// the table sideways under the finger.
					className={cn(
						"flex min-w-0 flex-1 touch-none cursor-grab items-center gap-1 transition-colors hover:text-foreground active:cursor-grabbing",
						numeric && "flex-row-reverse",
						sortDir && "text-foreground",
					)}
					onClick={onToggleSort}
					aria-label={`${label} — click to sort, drag to move`}
					title={`${label} — drag to reorder`}
					{...attributes}
					{...listeners}
				>
					<span className="truncate">{label}</span>
					<SortIcon
						className={cn(
							"size-3 shrink-0 transition-opacity",
							// The neutral glyph stays invisible until the header row is
							// hovered, so ten columns don't read as ten active controls —
							// but it is always in the DOM, so widths never jump.
							sortDir ? "opacity-100" : "opacity-0 group-hover:opacity-40",
						)}
						aria-hidden="true"
					/>
				</button>

				{filter ? (
					<ColumnFilterMenu
						label={filter.label}
						options={filter.options}
						selected={filter.selected}
						onChange={filter.onChange}
						mode={filter.mode}
						emptyHint={filter.emptyHint}
					/>
				) : null}
			</div>

			{/* The column divider IS the resize handle. One element does both jobs:
			    it rules the header into a grid (which is most of what makes a table
			    read as a spreadsheet) and it puts the grab target exactly where
			    every spreadsheet user already aims. Sitting OUTSIDE the sortable
			    button is what keeps a resize from starting a column drag — dnd-kit's
			    listeners are on the button, so they never see this pointer down.

			    The right-most column gets the rule but no handle: it has no
			    neighbour to take width from, so a drag there would push the table
			    wider with nothing to show for it. */}
			{isLast ? (
				<span
					aria-hidden="true"
					className="absolute inset-y-0 right-0 z-10 flex w-4 translate-x-1/2 items-center justify-center"
				>
					<span className="h-1/2 w-px rounded-full bg-border" />
				</span>
			) : (
				// A resizer is ARIA's window-splitter: a FOCUSABLE separator carrying
				// its current and permitted values. Honouring that isn't box-ticking —
				// it is what makes column width reachable at all without a mouse.
				// Arrow keys nudge (Shift for a bigger step); Home restores the
				// default, the same escape hatch the double-click gives.
				// biome-ignore lint/a11y/useSemanticElements: <hr> is the semantic separator for a static rule; this is the FOCUSABLE window-splitter variant, which has to carry tabIndex, aria-value*, and key + pointer handlers, and sit as a positioned overlay inside a <th>. An <hr> can do none of that.
				<span
					role="separator"
					tabIndex={0}
					aria-orientation="vertical"
					aria-label={`Resize ${label}`}
					aria-valuenow={width}
					aria-valuemin={ORDER_COLUMN_MIN_WIDTH}
					aria-valuemax={ORDER_COLUMN_MAX_WIDTH}
					aria-valuetext={`${width} pixels`}
					title="Drag or use ← → to resize · double-click to reset"
					onMouseDown={onResizeStart}
					onTouchStart={onResizeStart}
					onDoubleClick={onResizeReset}
					onKeyDown={(e) => {
						const step = e.shiftKey ? 40 : 8;
						if (e.key === "ArrowLeft") {
							e.preventDefault();
							onResizeBy(-step);
						} else if (e.key === "ArrowRight") {
							e.preventDefault();
							onResizeBy(step);
						} else if (e.key === "Home") {
							e.preventDefault();
							onResizeReset();
						}
					}}
					// `touch-none` is what lets a dragged handle resize instead of
					// scrolling the table sideways under the finger.
					className="absolute inset-y-0 right-0 z-10 flex w-4 translate-x-1/2 cursor-col-resize touch-none items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
				>
					<span
						aria-hidden="true"
						className={cn(
							// Idle it is just a hairline ruling the header into a grid.
							// Hovering the header grows and darkens it — that step is the
							// only thing that says "this is a control", since a 1px line
							// otherwise reads as decoration. `bg-border` on `bg-muted` is
							// deliberately quiet but does resolve at 1:1; it was checked in
							// a browser against the real tokens rather than guessed.
							"h-1/2 w-px rounded-full bg-border transition-all group-hover/head:h-full group-hover/head:bg-muted-foreground/50",
							isResizing && "h-full w-0.5 bg-accent",
						)}
					/>
				</span>
			)}
		</TableHead>
	);
}

export function OrderTable({
	orders,
	columns,
	statusLabelFor,
	sorting,
	onSortingChange,
	onReorderColumns,
	selectMode,
	selected,
	onToggleSelect,
	onTogglePin,
	pinBusyId,
	columnWidths,
	onColumnWidthsChange,
	columnFilters,
}: OrderTableProps) {
	const navigate = useNavigate();

	const columnDefs = useMemo<ColumnDef<TableOrder>[]>(
		() =>
			columns.map((c) => ({
				id: c.key,
				header: c.label,
				// The registry width is the DEFAULT size; a seller-dragged width in
				// `columnWidths` overrides it, and clearing that entry restores this.
				size: c.width,
				// The registry IS the accessor: one definition drives the cell, the
				// CSV and the sort, so the three can't disagree about a column.
				accessorFn: (o: TableOrder) => orderColumnSortValue(c, o),
				sortUndefined: "last",
				cell: ({ row }) => (
					<Cell
						column={c}
						order={row.original}
						statusLabel={statusLabelFor(row.original)}
					/>
				),
			})),
		[columns, statusLabelFor],
	);

	const table = useReactTable({
		data: orders,
		columns: columnDefs,
		state: { sorting, columnSizing: columnWidths },
		onSortingChange: (updater) =>
			onSortingChange(
				typeof updater === "function" ? updater(sorting) : updater,
			),
		enableColumnResizing: true,
		// "onChange" = the column follows the pointer. "onEnd" would only commit on
		// release, which is cheaper but means dragging a border does nothing
		// visible until you let go — the opposite of what a spreadsheet does.
		columnResizeMode: "onChange",
		defaultColumn: {
			minSize: ORDER_COLUMN_MIN_WIDTH,
			maxSize: ORDER_COLUMN_MAX_WIDTH,
		},
		onColumnSizingChange: (updater) =>
			onColumnWidthsChange(
				typeof updater === "function" ? updater(columnWidths) : updater,
			),
		getRowId: (o) => o._id,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
	});

	const leafColumns = table.getVisibleLeafColumns();
	// The table's own width, so `table-fixed` honours the colgroup EXACTLY once
	// the columns overflow their container. As a floor rather than a fixed width:
	// under-filled (two or three columns shown) the table still spans the box and
	// the browser stretches proportionally, which beats a strip of dead space.
	const contentWidth =
		CONTROL_COLUMNS_WIDTH +
		leafColumns.reduce((sum, c) => sum + c.getSize(), 0);

	const byKey = useMemo(
		() => new Map(columns.map((c) => [c.key as string, c])),
		[columns],
	);
	const sensors = useSortableSensors();
	const columnKeys = useMemo(
		() => columns.map((c) => c.key as string),
		[columns],
	);

	/** Double-clicking a handle drops the stored width, so `getSize()` falls back
	 * to the registry default — the spreadsheet convention, and the only way back
	 * from a width the seller regrets short of resetting the whole layout. */
	function resetColumnWidth(id: string) {
		if (columnWidths[id] === undefined) return;
		const next = { ...columnWidths };
		delete next[id];
		onColumnWidthsChange(next);
	}

	/** Keyboard nudge. Clamped here as well as on read, so holding an arrow key
	 * can't walk a column past its bounds. */
	function nudgeColumnWidth(id: string, from: number, delta: number) {
		onColumnWidthsChange({
			...columnWidths,
			[id]: clampColumnWidth(from + delta),
		});
	}

	function handleHeaderDragEnd(event: DragEndEvent) {
		const { active, over } = event;
		if (!over || active.id === over.id) return;
		const from = columnKeys.indexOf(String(active.id));
		const to = columnKeys.indexOf(String(over.id));
		if (from < 0 || to < 0) return;
		onReorderColumns(arrayMove(columnKeys, from, to));
	}

	// Partition the SORTED rows rather than using the table's row pinning:
	// `getTopRows()` returns pinned rows in the order of the pinned-id array, so
	// the pinned block would freeze while the rest of the table re-sorted. Taking
	// the sorted model and splitting it means the active sort applies INSIDE the
	// pinned group and inside the rest — pinning stays a partition, and both
	// halves agree on what "sorted by total" means.
	const sortedRows = table.getSortedRowModel().rows;
	const topRows: Row<TableOrder>[] = [];
	const restRows: Row<TableOrder>[] = [];
	for (const row of sortedRows) {
		(row.original.pinnedAt !== undefined ? topRows : restRows).push(row);
	}

	function renderRow(row: Row<TableOrder>, endsPinnedRun: boolean) {
		const o = row.original;
		const isSel = selected.has(o._id);
		const isPinned = o.pinnedAt !== undefined;
		return (
			<TableRow
				key={row.id}
				data-state={isSel ? "selected" : undefined}
				onClick={() =>
					selectMode
						? onToggleSelect(o._id)
						: navigate({
								to: "/app/orders/$shortId",
								params: { shortId: o.shortId },
							})
				}
				className={cn(
					"h-[52px] cursor-pointer",
					// One accent hairline where the pinned run ends. The pinned rows
					// themselves are NOT tinted: pins never auto-clear, so a permanent
					// block of coloured rows at the top of every view becomes noise the
					// seller stops seeing — exactly the failure the nav-badge fix
					// (86eyjfazz) was written to avoid. A boundary states it once.
					endsPinnedRun && "border-t-2 border-t-accent",
				)}
			>
				<TableCell className="w-11 px-0 text-center lg:w-10">
					{selectMode ? (
						<button
							type="button"
							aria-pressed={isSel}
							aria-label={`Select order ${o.shortId}`}
							onClick={(e) => {
								e.stopPropagation();
								onToggleSelect(o._id);
							}}
							// The BUTTON carries the 44px touch target; the box inside
							// stays 18px. Growing the box itself would give a phone a giant
							// empty square instead of a checkbox.
							className="mx-auto flex size-11 items-center justify-center rounded-lg transition-colors hover:bg-muted lg:size-8"
						>
							<span
								aria-hidden="true"
								className={cn(
									"flex size-[18px] items-center justify-center rounded-md border transition-colors",
									isSel
										? "border-accent bg-accent text-accent-foreground"
										: "border-border bg-background",
								)}
							>
								{isSel ? <Check className="size-3" /> : null}
							</span>
						</button>
					) : null}
				</TableCell>

				<TableCell className="w-11 px-0 text-center lg:w-10">
					<button
						type="button"
						aria-pressed={isPinned}
						aria-label={
							isPinned ? `Unpin order ${o.shortId}` : `Pin order ${o.shortId}`
						}
						title={isPinned ? "Unpin" : "Pin to top"}
						disabled={pinBusyId === o._id}
						onClick={(e) => {
							e.stopPropagation();
							onTogglePin(o);
						}}
						className={cn(
							"mx-auto flex size-11 items-center justify-center rounded-lg transition-colors disabled:opacity-50 lg:size-8",
							isPinned
								? "text-accent hover:bg-accent/10"
								: // Always rendered, never hover-only: a control the seller
									// has to discover by hovering is one they never find.
									"text-muted-foreground/25 hover:bg-muted hover:text-muted-foreground",
						)}
					>
						<Pin
							className="size-4"
							fill={isPinned ? "currentColor" : "none"}
							aria-hidden="true"
						/>
					</button>
				</TableCell>

				{row.getVisibleCells().map((cell) => (
					<TableCell
						key={cell.id}
						className={cn(byKey.get(cell.column.id)?.numeric && "text-right")}
					>
						{flexRender(cell.column.columnDef.cell, cell.getContext())}
					</TableCell>
				))}
			</TableRow>
		);
	}

	return (
		<div className="min-w-0 overflow-hidden rounded-2xl border border-border">
			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				modifiers={[horizontalOnly]}
				onDragEnd={handleHeaderDragEnd}
			>
				<Table
					className="table-fixed"
					style={{ minWidth: `${contentWidth}px` }}
					// The bounded height is what MAKES the sticky header work: the
					// wrapper is already a scroll container on both axes (overflow-x
					// forces overflow-y), so without a cap it never scrolls vertically
					// and a sticky header silently rides away with the page. `lg` and up
					// only — a nested vertical scroll on top of the horizontal one is a
					// bad trade on touch. Don't remove this without removing the sticky.
					wrapperClassName="lg:max-h-[70dvh]"
				>
					{/* Fixed widths live here, not on each cell: without them a long
					    address column collapses every other column to nothing. Driven by
					    `getSize()`, so a dragged border moves the whole column. */}
					<colgroup>
						<col className="w-11 lg:w-10" />
						<col className="w-11 lg:w-10" />
						{leafColumns.map((c) => (
							<col key={c.id} style={{ width: `${c.getSize()}px` }} />
						))}
					</colgroup>
					{/* Sticky keeps the header under the seller's eye through a long
					    scroll — the single biggest thing a spreadsheet does that a card
					    list doesn't. */}
					<TableHeader className="group z-10 lg:sticky lg:top-0">
						<TableRow className="border-b-border hover:bg-transparent">
							<TableHead className="bg-muted" />
							<TableHead className="bg-muted text-center" title="Pinned">
								<Pin className="mx-auto size-3.5" aria-hidden="true" />
								<span className="sr-only">Pinned</span>
							</TableHead>
							<SortableContext
								items={columnKeys}
								strategy={horizontalListSortingStrategy}
							>
								{table.getHeaderGroups()[0]?.headers.map((header, i, all) => {
									const col = byKey.get(header.column.id);
									return (
										<SortableHeader
											key={header.id}
											id={header.column.id}
											label={col?.label ?? header.column.id}
											numeric={col?.numeric}
											sortDir={header.column.getIsSorted()}
											onToggleSort={header.column.getToggleSortingHandler()}
											onResizeStart={header.getResizeHandler()}
											onResizeReset={() => resetColumnWidth(header.column.id)}
											onResizeBy={(delta) =>
												nudgeColumnWidth(
													header.column.id,
													header.column.getSize(),
													delta,
												)
											}
											width={header.column.getSize()}
											isResizing={header.column.getIsResizing()}
											isLast={i === all.length - 1}
											filter={columnFilters?.get(header.column.id)}
										/>
									);
								})}
							</SortableContext>
						</TableRow>
					</TableHeader>
					<TableBody>
						{topRows.map((row) => renderRow(row, false))}
						{restRows.map((row, i) =>
							renderRow(row, i === 0 && topRows.length > 0),
						)}
					</TableBody>
				</Table>
			</DndContext>
		</div>
	);
}
