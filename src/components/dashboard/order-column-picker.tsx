import { Columns3 } from "lucide-react";
import {
	ORDER_COLUMN_GROUP_LABELS,
	ORDER_COLUMNS,
	type OrderColumnGroup,
	type OrderColumnKey,
} from "../../../convex/lib/orderCsv";
import { BulkSelectRow } from "../ui/bulk-select-row";
import { Button } from "../ui/button";
import { FilterOptionRow } from "../ui/filter-option-row";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

/**
 * Choose WHICH columns the orders table shows (86eyrtz74).
 *
 * Show/hide only. **Reordering and resizing happen on the table headers** —
 * drag a header to move it, drag its right border to resize it — where every
 * spreadsheet user already expects them; a reorder list buried in a dropdown is
 * not somewhere anyone thinks to look. This panel just names the 36 available
 * columns, grouped by the registry's own sections so a seller hunting for the
 * address doesn't scan an alphabetical wall.
 *
 * **Bulk selection is part of the design, not an extra.** With 36 columns,
 * ticking them one at a time is the whole interaction, so there are three
 * levels of the SAME control: all columns, one group, one column. The first two
 * are TRI-STATE — a parent that read "unchecked" while three of its seven
 * children were on would be telling the seller something false — and carry
 * `aria-checked="mixed"` so a screen reader hears it too.
 *
 * The count on the trigger is the discoverability surface: "22/36" is what
 * tells a seller who never opens this that 14 more fields exist.
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
	isVisible,
	onToggle,
	onSetMany,
	onReset,
	visibleCount,
	isCustomised,
}: {
	isVisible: (key: OrderColumnKey) => boolean;
	onToggle: (key: OrderColumnKey) => void;
	onSetMany: (keys: readonly OrderColumnKey[], visible: boolean) => void;
	onReset: () => void;
	visibleCount: number;
	isCustomised: boolean;
}) {
	const allKeys = ORDER_COLUMNS.map((c) => c.key);

	return (
		<Popover>
			{/* Shaped like a FilterChip, because it sits in the chip row: same h-10
			    pill, same border. The label collapses to just the count on the
			    narrowest screens — "22/36" beside the columns glyph is already
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
			<PopoverContent align="end" className="w-72 p-0">
				<div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2.5">
					<div className="min-w-0">
						<p className="text-[13px] font-semibold">Columns</p>
						<p className="text-[11.5px] leading-snug text-muted-foreground">
							Drag a header to reorder, its edge to resize — exports follow
						</p>
					</div>
					{isCustomised ? (
						<button
							type="button"
							onClick={onReset}
							title="Restore the default columns, order and widths"
							className="shrink-0 text-[12.5px] font-medium text-accent-emphasis hover:underline dark:text-accent"
						>
							Reset
						</button>
					) : null}
				</div>

				{/* Select-all sits ABOVE the list rather than in the header, so it
				    reads as the first row of the same hierarchy — all → group →
				    column — instead of competing with Reset, which does a different
				    job (defaults, including order and widths). */}
				<div className="border-b border-border px-1.5 py-1">
					<BulkSelectRow
						tone="master"
						label="All columns"
						unit="columns"
						selected={visibleCount}
						total={ORDER_COLUMNS.length}
						onToggle={(selectAll) => onSetMany(allKeys, selectAll)}
					/>
					{visibleCount === 1 ? (
						// Says the constraint where the seller is clicking, rather than
						// letting a click quietly do nothing.
						<p className="px-2.5 pb-1 pt-0.5 text-[11px] text-muted-foreground">
							At least one column stays — the table needs something to show.
						</p>
					) : null}
				</div>

				<div className="max-h-[52vh] overflow-y-auto px-1.5 py-1">
					{GROUP_ORDER.map((group) => {
						const cols = ORDER_COLUMNS.filter((c) => c.group === group);
						if (cols.length === 0) return null;
						const keys = cols.map((c) => c.key);
						const shown = keys.filter(isVisible).length;
						return (
							<div key={group} className="pb-1">
								<BulkSelectRow
									label={ORDER_COLUMN_GROUP_LABELS[group]}
									unit="columns"
									selected={shown}
									total={cols.length}
									onToggle={(selectAll) => onSetMany(keys, selectAll)}
								/>
								{cols.map((c) => (
									<div key={c.key} className="pl-4">
										<FilterOptionRow
											label={c.label}
											selected={isVisible(c.key)}
											// Most columns are ON by default here, so a tint would
											// stripe the panel rather than mark anything out.
											tintSelected={false}
											onToggle={() => onToggle(c.key)}
										/>
									</div>
								))}
							</div>
						);
					})}
				</div>
			</PopoverContent>
		</Popover>
	);
}
