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
import { Link } from "@tanstack/react-router";
import {
	type ColumnDef,
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
	type OrderColumn,
	orderColumnSortValue,
} from "../../../convex/lib/orderCsv";
import { MASK_PII } from "../../lib/analytics-privacy";
import { cn } from "../../lib/utils";
import { useSortableSensors } from "../ui/sortable-list";
import { type OrderStatus, StatusBadge } from "./status-badge";

/**
 * The orders TABLE view (86eyrtz74).
 *
 * Why it exists: sellers were exporting to Excel out of habit rather than need
 * — the inbox already filters and sorts as well as a spreadsheet does, it just
 * didn't LOOK like one. So this renders the same rows the CSV would, from the
 * same column registry (`convex/lib/orderCsv.ts`), which is what keeps "what I
 * see" and "what I export" the same thing — including left-to-right order,
 * since the seller's own column arrangement feeds the export.
 *
 * Built on **@tanstack/react-table**, which was already a dependency and
 * already the house pattern in `customer-list.tsx`. Deliberately not shadcn's
 * data-table: that IS this library wrapped in a styling layer we already have
 * our own version of, so adopting it would mean a second set of primitives for
 * no capability we don't get headless. Headless gives us sorting and row
 * pinning; the markup stays ours.
 *
 * **Sorting** is client-side and per-column, over the window the inbox already
 * holds — the same rows the card list sorts, so it costs no extra reads. While
 * the table is on it REPLACES the Newest/Due popover: a header you can click is
 * what a spreadsheet user reaches for first, and keeping both would leave two
 * controls fighting over one ordering. Comparison is typed, not lexical (see
 * `orderColumnSortValue`): money and times hand back their underlying number,
 * so "125.00" doesn't sort below "86.00" and "3:30 PM" doesn't sort below
 * "9:00 AM". Empty values always sink, whichever direction is active — a
 * dateless order is unscheduled, not earliest.
 *
 * **Pinned orders** stay on top of any sort via the table's own row pinning:
 * pinning is a partition, never a competing sort key.
 *
 * Available at every width. It scrolls horizontally inside its OWN container,
 * never the page (`min-w-0` + `overflow-x-auto`), and its row controls grow to
 * 44px touch targets below `lg`.
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
	selectMode: boolean;
	selected: Set<string>;
	onToggleSelect: (id: string) => void;
	onTogglePin: (o: TableOrder) => void;
	pinBusyId?: string | null;
}

/** Cells the registry can't render as plain text — a badge, a masked name.
 * Everything else falls through to `column.value()`, so adding a column to the
 * registry lights it up in the table with no change here. */
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
	const maskable = column.key === "customer" || column.key === "phone";
	return (
		<span
			// Mask only the customer's name + phone in session replay; items,
			// amounts and status are the useful signal (the card view's rule).
			{...(maskable ? MASK_PII : {})}
			className={cn(
				"block truncate",
				column.numeric && "tabular-nums",
				column.key === "shortId" && "font-mono font-semibold",
			)}
			title={text}
		>
			{text}
		</span>
	);
}

/**
 * Headers only travel sideways. `@dnd-kit/modifiers` isn't a dependency and
 * this is the whole of what we'd import from it, so it lives here rather than
 * growing the bundle for two lines.
 */
const horizontalOnly: Modifier = ({ transform }) => ({ ...transform, y: 0 });

/**
 * One column header: a sort button that is also the drag handle.
 *
 * There is no separate grip. The shared sensors (`useSortableSensors`) make
 * that safe — a pointer drag only starts after 8px of movement, and touch after
 * a 250ms hold — so a plain click still falls through to sorting, and the
 * seller drags the thing they actually want to move rather than hunting for a
 * handle. Reordering a table by dragging its headers is the interaction people
 * already know from every spreadsheet; a list in a dropdown is not.
 */
function SortableHeader({
	id,
	label,
	numeric,
	sortDir,
	onToggleSort,
}: {
	id: string;
	label: string;
	numeric?: boolean;
	sortDir: false | "asc" | "desc";
	onToggleSort: ((e: unknown) => void) | undefined;
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
		<button
			ref={setNodeRef}
			type="button"
			// `touch-none` is what lets a held header drag instead of scrolling the
			// table sideways under the finger.
			className={cn(
				"flex h-[42px] min-w-0 touch-none cursor-grab items-center gap-1 px-2 transition-colors hover:text-foreground active:cursor-grabbing",
				numeric && "flex-row-reverse",
				sortDir && "text-foreground",
				isDragging && "z-20 rounded-md bg-card text-foreground shadow-lg",
			)}
			style={{
				transform: CSS.Transform.toString(transform),
				transition,
				opacity: isDragging ? 0.9 : 1,
			}}
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
					// hovered, so ten columns don't read as ten active controls — but
					// it is always in the DOM, so widths never jump when a sort lands.
					sortDir ? "opacity-100" : "opacity-0 group-hover:opacity-40",
				)}
				aria-hidden="true"
			/>
		</button>
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
}: OrderTableProps) {
	const columnDefs = useMemo<ColumnDef<TableOrder>[]>(
		() =>
			columns.map((c) => ({
				id: c.key,
				header: c.label,
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
		state: { sorting },
		onSortingChange: (updater) =>
			onSortingChange(
				typeof updater === "function" ? updater(sorting) : updater,
			),
		getRowId: (o) => o._id,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
	});

	// Explicit pixel tracks from the registry. Without them a long address column
	// collapses every other column to nothing.
	const cellGrid = columns.map((c) => `${c.width}px`).join(" ");
	const byKey = useMemo(
		() => new Map(columns.map((c) => [c.key as string, c])),
		[columns],
	);

	// Partition the SORTED rows rather than using the table's row pinning:
	// `getTopRows()` returns pinned rows in the order of the pinned-id array, so
	// the pinned block would freeze while the rest of the table re-sorted. Taking
	// the sorted model and splitting it means the active sort applies INSIDE the
	// pinned group and inside the rest — pinning stays a partition, and both
	// halves agree on what "sorted by total" means.
	const sensors = useSortableSensors();
	const columnKeys = useMemo(
		() => columns.map((c) => c.key as string),
		[columns],
	);

	function handleHeaderDragEnd(event: DragEndEvent) {
		const { active, over } = event;
		if (!over || active.id === over.id) return;
		const from = columnKeys.indexOf(String(active.id));
		const to = columnKeys.indexOf(String(over.id));
		if (from < 0 || to < 0) return;
		onReorderColumns(arrayMove(columnKeys, from, to));
	}

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
		const cells = row.getVisibleCells().map((cell) => (
			<span
				key={cell.id}
				className={cn(
					"min-w-0 px-2 text-[13px]",
					byKey.get(cell.column.id)?.numeric && "text-right",
				)}
			>
				{flexRender(cell.column.columnDef.cell, cell.getContext())}
			</span>
		));
		return (
			<li
				key={row.id}
				className={cn(
					"flex h-[52px] items-center border-b border-border/60 last:border-b-0 transition-colors",
					// One accent hairline where the pinned run ends. The pinned rows
					// themselves are NOT tinted: pins never auto-clear, so a permanent
					// block of coloured rows at the top of every view becomes noise the
					// seller stops seeing — exactly the failure the nav-badge fix
					// (86eyjfazz) was written to avoid. A boundary states it once.
					endsPinnedRun && "border-t-2 border-t-accent",
					isSel ? "bg-accent/10" : "hover:bg-muted/40",
				)}
			>
				<span className="flex w-11 shrink-0 items-center justify-center lg:w-10">
					{selectMode ? (
						<button
							type="button"
							aria-pressed={isSel}
							aria-label={`Select order ${o.shortId}`}
							onClick={() => onToggleSelect(o._id)}
							// The BUTTON carries the 44px touch target; the box inside
							// stays 18px. Growing the box itself would give a phone a
							// giant empty square instead of a checkbox.
							className="flex size-11 items-center justify-center rounded-lg transition-colors hover:bg-muted lg:size-8"
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
				</span>

				<span className="flex w-11 shrink-0 items-center justify-center lg:w-10">
					<button
						type="button"
						aria-pressed={isPinned}
						aria-label={
							isPinned ? `Unpin order ${o.shortId}` : `Pin order ${o.shortId}`
						}
						title={isPinned ? "Unpin" : "Pin to top"}
						disabled={pinBusyId === o._id}
						onClick={() => onTogglePin(o)}
						className={cn(
							"flex size-11 items-center justify-center rounded-lg transition-colors disabled:opacity-50 lg:size-8",
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
				</span>

				{selectMode ? (
					// In select mode the row must not navigate — a stray click while
					// ticking twenty rows would throw the seller out of the selection
					// they were building.
					<button
						type="button"
						onClick={() => onToggleSelect(o._id)}
						aria-label={`Select order ${o.shortId}`}
						className="grid h-full flex-1 items-center text-left"
						style={{ gridTemplateColumns: cellGrid }}
					>
						{cells}
					</button>
				) : (
					<Link
						to="/app/orders/$shortId"
						params={{ shortId: o.shortId }}
						className="grid h-full flex-1 items-center"
						style={{ gridTemplateColumns: cellGrid }}
					>
						{cells}
					</Link>
				)}
			</li>
		);
	}

	return (
		<div className="min-w-0 overflow-x-auto rounded-2xl border border-border">
			<div className="min-w-max">
				{/* Header. `sticky` keeps it under the seller's eye through a long
				    scroll — the single biggest thing a spreadsheet does that a card
				    list doesn't. Every header is also its column's sort control. */}
				<div className="group sticky top-0 z-10 flex h-[42px] items-center border-b border-border bg-muted/70 text-[11px] font-bold uppercase tracking-wider text-muted-foreground backdrop-blur-sm">
					<span className="w-11 shrink-0 lg:w-10" aria-hidden="true" />
					<span
						className="flex w-11 shrink-0 items-center justify-center lg:w-10"
						title="Pinned"
					>
						<Pin className="size-3.5" aria-hidden="true" />
						<span className="sr-only">Pinned</span>
					</span>
					<DndContext
						sensors={sensors}
						collisionDetection={closestCenter}
						modifiers={[horizontalOnly]}
						onDragEnd={handleHeaderDragEnd}
					>
						<SortableContext
							items={columnKeys}
							strategy={horizontalListSortingStrategy}
						>
							<div
								className="grid flex-1 items-center"
								style={{ gridTemplateColumns: cellGrid }}
							>
								{table.getHeaderGroups()[0]?.headers.map((header) => {
									const col = byKey.get(header.column.id);
									return (
										<SortableHeader
											key={header.id}
											id={header.column.id}
											label={col?.label ?? header.column.id}
											numeric={col?.numeric}
											sortDir={header.column.getIsSorted()}
											onToggleSort={header.column.getToggleSortingHandler()}
										/>
									);
								})}
							</div>
						</SortableContext>
					</DndContext>
				</div>

				<ul>
					{topRows.map((row) => renderRow(row, false))}
					{restRows.map((row, i) =>
						renderRow(row, i === 0 && topRows.length > 0),
					)}
				</ul>
			</div>
		</div>
	);
}
