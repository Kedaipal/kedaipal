import { Check, Columns3, Eye, Plus } from "lucide-react";
import {
	ORDER_COLUMN_GROUP_LABELS,
	ORDER_COLUMNS,
	type OrderColumn,
	type OrderColumnGroup,
	type OrderColumnKey,
} from "../../../convex/lib/orderCsv";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { SortableList } from "../ui/sortable-list";

/**
 * Manage the orders table's columns — which are shown, and in what order
 * (86eyrtz74).
 *
 * Two sections, because they answer different questions:
 *   - **Shown** is an ORDERED, drag-to-reorder list. Order only means something
 *     for columns that are on screen, and the arrangement feeds the CSV export
 *     as well as the table — so this list is literally the shape of the file
 *     the seller gets.
 *   - **Add a column** is everything else, grouped by the registry's own
 *     sections so a seller hunting for the address doesn't scan an alphabetical
 *     wall of 36. Adding appends to the end: a column you just turned on
 *     belongs where you can see it, not slotted invisibly into the middle.
 *
 * Reordering uses the shared `SortableList` (@dnd-kit) — the project's sorting
 * standard, touch-safe, never arrow buttons.
 *
 * The count on the trigger is the discoverability surface: "10/36" is what
 * tells a seller who never opens this that 26 more fields exist.
 */
const GROUP_ORDER: OrderColumnGroup[] = [
	"order",
	"customer",
	"items",
	"money",
	"payment",
	"fulfilment",
];

export function OrderColumnPicker({
	columns,
	isVisible,
	onToggle,
	onReorder,
	onReset,
	visibleCount,
	isCustomised,
}: {
	/** Visible columns, in the seller's order. */
	columns: OrderColumn[];
	isVisible: (key: OrderColumnKey) => boolean;
	onToggle: (key: OrderColumnKey) => void;
	onReorder: (keys: OrderColumnKey[]) => void;
	onReset: () => void;
	visibleCount: number;
	isCustomised: boolean;
}) {
	const hidden = ORDER_COLUMNS.filter((c) => !isVisible(c.key));
	// The last visible column can't be hidden — an empty table is a dead end
	// whose only way back is the panel the seller just emptied. Disabled with a
	// reason beats a control that silently does nothing.
	const canHide = columns.length > 1;

	return (
		<Popover>
			{/* Shaped like a FilterChip, because it sits in the chip row: same h-10
			    pill, same border. The label collapses to just the count on the
			    narrowest screens — "10/36" beside the columns glyph is already
			    unambiguous, and the row has chips to fit. */}
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					aria-label={`Columns: ${visibleCount} of ${ORDER_COLUMNS.length} shown`}
					className="h-10 shrink-0 gap-1.5 rounded-full border-border px-3.5 text-[13px] font-medium"
				>
					<Columns3 className="size-4" aria-hidden="true" />
					<span className="hidden sm:inline">Columns</span>
					<span className="tabular-nums text-muted-foreground">
						{visibleCount}/{ORDER_COLUMNS.length}
					</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 p-0">
				<div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
					<div className="min-w-0">
						<p className="text-[13px] font-semibold">Columns</p>
						<p className="text-[11.5px] text-muted-foreground">
							Drag to reorder — exports follow this order
						</p>
					</div>
					{isCustomised ? (
						<button
							type="button"
							onClick={onReset}
							className="shrink-0 text-[12.5px] font-medium text-accent-emphasis hover:underline dark:text-accent"
						>
							Reset
						</button>
					) : null}
				</div>

				<div className="max-h-[60vh] overflow-y-auto">
					<p className="flex items-center gap-1.5 px-3 pb-1 pt-2.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
						<Eye className="size-3.5" aria-hidden="true" />
						Shown
					</p>
					<div className="px-2 pb-2">
						<SortableList
							items={columns}
							getId={(c) => c.key}
							onReorder={(ids) => onReorder(ids as OrderColumnKey[])}
							className="flex flex-col gap-1"
							renderItem={(col, handle) => (
								<div className="flex items-center gap-1.5 rounded-lg bg-card py-0.5 pr-1">
									{handle}
									<span className="min-w-0 flex-1 truncate text-[13px]">
										{col.label}
									</span>
									<button
										type="button"
										disabled={!canHide}
										onClick={() => onToggle(col.key)}
										aria-label={`Hide ${col.label}`}
										title={
											canHide ? `Hide ${col.label}` : "Keep at least one column"
										}
										className="flex size-8 shrink-0 items-center justify-center rounded-md border border-accent bg-accent text-accent-foreground transition-opacity hover:opacity-80 disabled:opacity-40"
									>
										<Check className="size-3.5" aria-hidden="true" />
									</button>
								</div>
							)}
						/>
					</div>

					{hidden.length > 0 ? (
						<div className="border-t border-border pb-1 pt-2">
							<p className="flex items-center gap-1.5 px-3 pb-1 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
								<Plus className="size-3.5" aria-hidden="true" />
								Add a column
							</p>
							{GROUP_ORDER.map((group) => {
								const cols = hidden.filter((c) => c.group === group);
								if (cols.length === 0) return null;
								return (
									<div key={group} className="py-1">
										<p className="px-3 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/70">
											{ORDER_COLUMN_GROUP_LABELS[group]}
										</p>
										{cols.map((c) => (
											<button
												key={c.key}
												type="button"
												onClick={() => onToggle(c.key)}
												className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-muted"
											>
												<span
													aria-hidden="true"
													className="flex size-4 shrink-0 items-center justify-center rounded border border-border"
												/>
												<span className="truncate">{c.label}</span>
											</button>
										))}
									</div>
								);
							})}
						</div>
					) : null}
				</div>
			</PopoverContent>
		</Popover>
	);
}
