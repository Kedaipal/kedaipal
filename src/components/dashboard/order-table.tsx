import { Link } from "@tanstack/react-router";
import { Check, Pin } from "lucide-react";
import type { CsvOrder, OrderColumn } from "../../../convex/lib/orderCsv";
import { MASK_PII } from "../../lib/analytics-privacy";
import { cn } from "../../lib/utils";
import { type OrderStatus, StatusBadge } from "./status-badge";

/**
 * The orders TABLE view (86eyrtz74).
 *
 * Why it exists: sellers were exporting to Excel out of habit rather than need
 * — the inbox already filters and sorts as well as a spreadsheet does, it just
 * didn't LOOK like one. So this renders the same rows the CSV would, from the
 * same column registry (`convex/lib/orderCsv.ts`), which is what keeps "what I
 * see" and "what I export" the same thing.
 *
 * Available at EVERY width (owner call, 28 Aug — the first build gated it to
 * `lg` and up). A seller away from their desk still wants the scan-many-orders
 * view, so instead of withholding it on a phone the table:
 *   - scrolls horizontally inside its OWN container, never the page (the design
 *     system's hard rule for wide content), with `min-w-0` on the wrapper so a
 *     flex parent can't let it push the body wide;
 *   - grows both row controls to 44px touch targets below `lg`, dropping to
 *     compact 32px at `lg` and up where the touch floor doesn't apply.
 *
 * Layout is flex-then-grid, not one grid: the two control columns are fixed
 * flex children and the data cells live in an inner grid that the header
 * repeats verbatim. One shared template string is what guarantees the header
 * and every row stay aligned, whatever the seller has shown or hidden.
 */

/** The row shape: everything the registry reads, plus what the table needs to
 * render rich cells and link out. A structural superset of `CsvOrder`. */
export type TableOrder = CsvOrder & { _id: string };

export interface OrderTableProps {
	orders: TableOrder[];
	columns: OrderColumn[];
	/** Resolved status label per order (honours the retailer's custom stage
	 * names) — resolved by the caller, which owns the stage config. */
	statusLabelFor: (o: TableOrder) => string;
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

export function OrderTable({
	orders,
	columns,
	statusLabelFor,
	selectMode,
	selected,
	onToggleSelect,
	onTogglePin,
	pinBusyId,
}: OrderTableProps) {
	// Explicit pixel tracks from the registry. Without them a long address column
	// collapses every other column to nothing.
	const cellGrid = columns.map((c) => `${c.width}px`).join(" ");

	return (
		<div className="min-w-0 overflow-x-auto rounded-2xl border border-border">
			<div className="min-w-max">
				{/* Header. `sticky` keeps it under the seller's eye through a long
				    scroll — the single biggest thing a spreadsheet does that a card
				    list doesn't. */}
				<div className="sticky top-0 z-10 flex h-[42px] items-center border-b border-border bg-muted/70 text-[11px] font-bold uppercase tracking-wider text-muted-foreground backdrop-blur-sm">
					<span className="w-11 shrink-0 lg:w-10" aria-hidden="true" />
					<span
						className="flex w-11 shrink-0 items-center justify-center lg:w-10"
						title="Pinned"
					>
						<Pin className="size-3.5" aria-hidden="true" />
						<span className="sr-only">Pinned</span>
					</span>
					<div
						className="grid flex-1 items-center"
						style={{ gridTemplateColumns: cellGrid }}
					>
						{columns.map((c) => (
							<span
								key={c.key}
								className={cn("truncate px-2", c.numeric && "text-right")}
								title={c.label}
							>
								{c.label}
							</span>
						))}
					</div>
				</div>

				<ul>
					{orders.map((o, i) => {
						const isSel = selected.has(o._id);
						const isPinned = o.pinnedAt !== undefined;
						// One accent hairline where the pinned run ends. The pinned rows
						// themselves are NOT tinted: pins never auto-clear, so a permanent
						// block of coloured rows at the top of every view becomes noise
						// the seller stops seeing — exactly the failure the nav-badge fix
						// (86eyjfazz) was written to avoid. A boundary states the same
						// thing once.
						const endsPinnedRun =
							!isPinned && i > 0 && orders[i - 1]?.pinnedAt !== undefined;
						const cells = columns.map((c) => (
							<span
								key={c.key}
								className={cn(
									"min-w-0 px-2 text-[13px]",
									c.numeric && "text-right",
								)}
							>
								<Cell column={c} order={o} statusLabel={statusLabelFor(o)} />
							</span>
						));
						return (
							<li
								key={o._id}
								className={cn(
									"flex h-[52px] items-center border-b border-border/60 last:border-b-0 transition-colors",
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
											// The BUTTON carries the 44px touch target; the box
											// inside stays 18px. Growing the box itself would give
											// a phone a giant empty square instead of a checkbox.
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
											isPinned
												? `Unpin order ${o.shortId}`
												: `Pin order ${o.shortId}`
										}
										title={isPinned ? "Unpin" : "Pin to top"}
										disabled={pinBusyId === o._id}
										onClick={() => onTogglePin(o)}
										className={cn(
											"flex size-11 items-center justify-center rounded-lg transition-colors disabled:opacity-50 lg:size-8",
											isPinned
												? "text-accent hover:bg-accent/10"
												: // Always rendered, never hover-only: a control the
													// seller has to discover by hovering is one they
													// never find.
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
									// In select mode the row must not navigate — a stray click
									// while ticking twenty rows would throw the seller out of
									// the selection they were building.
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
					})}
				</ul>
			</div>
		</div>
	);
}
