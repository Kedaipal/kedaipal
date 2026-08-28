import { Check, Columns3 } from "lucide-react";
import {
	ORDER_COLUMN_GROUP_LABELS,
	ORDER_COLUMNS,
	type OrderColumnGroup,
	type OrderColumnKey,
} from "../../../convex/lib/orderCsv";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

/**
 * Choose WHICH columns the orders table shows (86eyrtz74).
 *
 * Show/hide only. **Reordering happens by dragging the table headers**, where
 * every spreadsheet user already expects it — a reorder list buried inside a
 * dropdown is not somewhere anyone thinks to look for it. This panel just names
 * the 36 available columns, grouped by the registry's own sections so a seller
 * hunting for the address doesn't scan an alphabetical wall.
 *
 * Turning a column on appends it to the right-hand end, where the seller can
 * see what they just added rather than having it slotted invisibly into the
 * middle — then they drag it where they want it.
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
	isVisible,
	onToggle,
	onReset,
	visibleCount,
	isCustomised,
}: {
	isVisible: (key: OrderColumnKey) => boolean;
	onToggle: (key: OrderColumnKey) => void;
	onReset: () => void;
	visibleCount: number;
	isCustomised: boolean;
}) {
	// The last visible column can't be hidden — an empty table is a dead end
	// whose only way back is the panel the seller just emptied. Disabled with a
	// reason beats a control that silently does nothing.
	const canHide = visibleCount > 1;

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
			<PopoverContent align="end" className="w-72 p-0">
				<div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
					<div className="min-w-0">
						<p className="text-[13px] font-semibold">Columns</p>
						<p className="text-[11.5px] text-muted-foreground">
							Drag the table headers to reorder — exports follow
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

				<div className="max-h-[60vh] overflow-y-auto py-1">
					{GROUP_ORDER.map((group) => {
						const cols = ORDER_COLUMNS.filter((c) => c.group === group);
						if (cols.length === 0) return null;
						return (
							<div key={group} className="py-1">
								<p className="px-3 py-1 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
									{ORDER_COLUMN_GROUP_LABELS[group]}
								</p>
								{cols.map((c) => {
									const on = isVisible(c.key);
									// Only the LAST remaining column locks, and only against
									// hiding — turning columns on is never blocked.
									const locked = on && !canHide;
									return (
										<button
											key={c.key}
											type="button"
											role="menuitemcheckbox"
											aria-checked={on}
											disabled={locked}
											title={locked ? "Keep at least one column" : undefined}
											onClick={() => onToggle(c.key)}
											className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-muted disabled:opacity-50"
										>
											<span
												aria-hidden="true"
												className={cn(
													"flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
													on
														? "border-accent bg-accent text-accent-foreground"
														: "border-border",
												)}
											>
												{on ? <Check className="size-3" /> : null}
											</span>
											<span className="truncate">{c.label}</span>
										</button>
									);
								})}
							</div>
						);
					})}
				</div>
			</PopoverContent>
		</Popover>
	);
}
