import { Check, Columns3, Minus } from "lucide-react";
import {
	ORDER_COLUMN_GROUP_LABELS,
	ORDER_COLUMNS,
	type OrderColumnGroup,
	type OrderColumnKey,
} from "../../../convex/lib/orderCsv";
import { cn } from "../../lib/utils";
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

type TriState = "none" | "some" | "all";

function triStateOf(total: number, shown: number): TriState {
	if (shown === 0) return "none";
	return shown === total ? "all" : "some";
}

/**
 * A parent checkbox over a set of columns. Deliberately the same silhouette as
 * the option rows beneath it — same box, same row height — but bolder and
 * tinted when active, so it reads as their heading rather than as a sibling.
 */
function BulkRow({
	label,
	state,
	shown,
	total,
	onToggle,
	tone = "group",
}: {
	label: string;
	state: TriState;
	shown: number;
	total: number;
	onToggle: () => void;
	tone?: "group" | "master";
}) {
	const on = state !== "none";
	return (
		// A REAL checkbox, visually replaced. `indeterminate` is a DOM property,
		// not an attribute, so it is set through a ref — and it is what makes a
		// screen reader announce "partially checked" natively, which is stronger
		// than role="checkbox" + aria-checked="mixed" and is what the linter is
		// right to push for.
		<label
			className={cn(
				"flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-muted has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
				tone === "master" && "bg-muted/50 hover:bg-muted",
			)}
		>
			<input
				type="checkbox"
				className="sr-only"
				checked={state === "all"}
				aria-label={`${label} — ${shown} of ${total} columns shown`}
				ref={(el) => {
					if (el) el.indeterminate = state === "some";
				}}
				onChange={onToggle}
			/>
			<span
				aria-hidden="true"
				className={cn(
					"flex size-[17px] shrink-0 items-center justify-center rounded-[5px] border transition-colors",
					on
						? "border-accent bg-accent text-accent-foreground"
						: "border-border bg-background",
				)}
			>
				{state === "all" ? (
					<Check className="size-3" />
				) : state === "some" ? (
					// A dash, never a tick: "some" and "all" must not look alike.
					<Minus className="size-3" />
				) : null}
			</span>
			<span
				className={cn(
					"min-w-0 flex-1 truncate",
					tone === "master"
						? "text-[13px] font-semibold"
						: "text-[11px] font-bold uppercase tracking-wider text-muted-foreground",
				)}
			>
				{label}
			</span>
			<span className="shrink-0 tabular-nums text-[11.5px] text-muted-foreground">
				{shown}/{total}
			</span>
		</label>
	);
}

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
	const masterState = triStateOf(ORDER_COLUMNS.length, visibleCount);

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
					<BulkRow
						tone="master"
						label="All columns"
						state={masterState}
						shown={visibleCount}
						total={ORDER_COLUMNS.length}
						onToggle={() => onSetMany(allKeys, masterState !== "all")}
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
						const state = triStateOf(cols.length, shown);
						return (
							<div key={group} className="pb-1">
								<BulkRow
									label={ORDER_COLUMN_GROUP_LABELS[group]}
									state={state}
									shown={shown}
									total={cols.length}
									onToggle={() => onSetMany(keys, state !== "all")}
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
