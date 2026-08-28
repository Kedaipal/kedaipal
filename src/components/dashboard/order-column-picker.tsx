import { Check, Columns3 } from "lucide-react";
import {
	ORDER_COLUMN_GROUP_LABELS,
	ORDER_COLUMNS,
	type OrderColumnGroup,
	type OrderColumnKey,
} from "../../../convex/lib/orderCsv";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { cn } from "../../lib/utils";

/**
 * Show/hide columns in the orders table (86eyrtz74).
 *
 * There are 36 columns because the brief was "every field an order has should
 * be reachable in a column" — which is only usable if the seller can put the
 * ten they care about on screen and leave the rest one tap away. Grouped by
 * the registry's own groups so a seller hunting for the address doesn't scan
 * an alphabetical wall.
 *
 * The count on the trigger is the discoverability surface: "7 of 36" is what
 * tells a seller who never opens this that there are 29 more fields available.
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
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					className="h-9 gap-2 rounded-xl px-3 text-[13px] font-medium"
				>
					<Columns3 className="size-4" aria-hidden="true" />
					Columns
					<span className="tabular-nums text-muted-foreground">
						{visibleCount}/{ORDER_COLUMNS.length}
					</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-72 p-0">
				<div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
					<p className="text-[13px] font-semibold">Columns</p>
					{isCustomised ? (
						<button
							type="button"
							onClick={onReset}
							className="text-[12.5px] font-medium text-accent-emphasis hover:underline dark:text-accent"
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
									return (
										<button
											key={c.key}
											type="button"
											role="menuitemcheckbox"
											aria-checked={on}
											onClick={() => onToggle(c.key)}
											className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-muted"
										>
											<span
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
