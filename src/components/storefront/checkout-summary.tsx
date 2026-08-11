import { ChevronDown, Minus, Package, Plus, Trash2, Truck } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { PublicDeliveryQuote } from "../../../convex/delivery";
import type { CartItem, UseCart } from "../../hooks/useCart";
import { formatPrice } from "../../lib/format";

/**
 * The checkout page's order summary — the "Order Ticket" from the storefront
 * redesign (86eybrhrt), rendered 1:1 with the chosen design: centered store
 * masthead, monospaced receipt lines with dotted leaders (no thumbnails),
 * chunky dashed rules, a stamped TOTAL, and a perforated tear-off edge.
 * Personality lives HERE, never in the form controls below it.
 *
 * Interactivity keeps PR1's headline fix: tapping a receipt line reveals its
 * quantity stepper inline (per the design's caption); lines with a
 * min-quantity shortfall come pre-expanded so the fix is already in hand.
 *
 * Pure component: cart mutations go through the `UseCart` handle, totals and
 * quote states are computed by the checkout form and passed in via
 * `CheckoutTotals` / the `totals` slot — so this stays unit-testable without
 * Convex or router providers.
 */

/**
 * The leading icon box every expanded receipt row starts with. Shared so the
 * custom line's Remove and the stepper's minus/trash land on the SAME x.
 *
 * `tap-target` is what actually sets the width here — it forces a 44px minimum
 * (the mobile rule), which overrides `size-8`'s 32px. That's why the two icons
 * sat 6px apart: the stepper centred its glyph in the 44px button while the
 * Remove button's own icon well was a plain 32px span. Both go through this.
 */
const ROW_ICON_WELL =
	"tap-target flex size-8 shrink-0 items-center justify-center";

/** Min-quantity shortfall per product (from convex/lib/minOrderRules). */
export interface QtyShortfall {
	productId: string;
	name: string;
	minQuantity: number;
	have: number;
}

/** Receipt money column: bare "45.00" — the RM lives on the TOTAL row only,
 * exactly like a printed kedai receipt (and the chosen design). */
function receiptAmount(sen: number): string {
	return (sen / 100).toFixed(2);
}

/** "1× Kek Batik · 1kg" — the receipt line's left column. */
function receiptLabel(item: CartItem): string {
	return `${item.quantity}× ${item.name}${item.optionLabel ? ` · ${item.optionLabel}` : ""}`;
}

interface CheckoutSummaryProps {
	cart: UseCart;
	/** Masthead — the ticket is issued in the store's name. */
	storeName: string;
	/** "+ Add more items" — routes back to the store without losing state. */
	onAddMore?: () => void;
	/**
	 * Max sellable units for a variant (hard-block items = live on-hand stock).
	 * Undefined = uncapped (made-to-order, or the product left the public list
	 * after the item was added — the server still judges at create).
	 */
	stockCapFor?: (variantId: string) => number | undefined;
	/** Per-product min-quantity shortfalls, rendered once per product on its
	 * first non-custom line — which comes pre-expanded so the stepper that
	 * fixes the shortfall is already showing. */
	shortfalls?: ReadonlyArray<QtyShortfall>;
	/** Totals block (usually `CheckoutTotals`) — fee rows join the receipt
	 * lines; the TOTAL row draws its own dashed rule. */
	totals?: ReactNode;
	/** Desktop CTA slot — rendered BELOW the ticket's perforated edge (the CTA
	 * is not part of the receipt). Hidden on mobile by the caller. */
	footer?: ReactNode;
}

export function CheckoutSummary({
	cart,
	storeName,
	onAddMore,
	stockCapFor,
	shortfalls,
	totals,
	footer,
}: CheckoutSummaryProps) {
	// One line expanded at a time by tap; shortfall lines are always expanded
	// (the buyer must act on them, so the stepper can't hide behind a tap).
	const [expandedId, setExpandedId] = useState<string | null>(null);

	const shortfallByProduct = new Map(
		(shortfalls ?? []).map((s) => [s.productId, s]),
	);
	// The per-product hint renders once — on the product's FIRST non-custom line
	// (a multi-variant product can span several cart lines).
	const firstLineForProduct = new Map<string, number>();
	cart.items.forEach((item, index) => {
		if (!item.isCustom && !firstLineForProduct.has(item.productId)) {
			firstLineForProduct.set(item.productId, index);
		}
	});

	return (
		<div>
			<section
				aria-label="Order summary"
				className="rounded-t-xl bg-card px-4 pt-4 pb-3 shadow-[0_2px_12px_rgba(15,23,42,0.08)] ring-1 ring-border/40"
			>
				{/* Masthead — store name + ticket state, centered like the print. */}
				<div className="pb-3 text-center">
					<h2 className="font-heading text-base font-extrabold uppercase tracking-[0.06em]">
						{storeName}
					</h2>
					<p className="mt-1 font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
						Order ticket · Draft
					</p>
				</div>
				<div className="border-t-2 border-dashed border-border" aria-hidden />

				<ul className="py-2">
					{cart.items.map((item, itemIndex) => {
						const shortfall = shortfallByProduct.get(item.productId);
						const isFirstLine =
							firstLineForProduct.get(item.productId) === itemIndex;
						const showShortfall = shortfall && isFirstLine;
						const cap = stockCapFor?.(item.variantId);
						// Stock fell under a persisted quantity — the buyer must lower
						// it to check out, so show the stepper without a tap (same
						// posture as a min-quantity shortfall).
						const overStock = cap !== undefined && item.quantity > cap;
						const expanded =
							expandedId === item.variantId ||
							showShortfall === true ||
							overStock;
						return (
							<li key={item.variantId}>
								<button
									type="button"
									aria-expanded={expanded}
									onClick={() =>
										setExpandedId((prev) =>
											prev === item.variantId ? null : item.variantId,
										)
									}
									className="flex min-h-8 w-full items-baseline gap-2 py-1 text-left font-mono text-[13px] leading-6"
								>
									{/* Disclosure caret — these rows have been tappable since the
									    ticket redesign, but the only hint was a caption under the
									    whole list. Sits on the LEFT so the money column stays
									    flush; its ~1rem footprint matches the `pl-4` the note /
									    attachment sub-lines already indent by. */}
									<ChevronDown
										aria-hidden
										className={`size-3 shrink-0 translate-y-0.5 text-muted-foreground transition-transform motion-reduce:transition-none ${
											expanded ? "rotate-180" : ""
										}`}
									/>
									<span className="min-w-0 truncate">{receiptLabel(item)}</span>
									<span
										aria-hidden
										className="flex-1 border-b-2 border-dotted border-border"
									/>
									<span className="shrink-0 tabular-nums">
										{item.quoteOnRequest
											? "On quote"
											: // A priced custom line is the seller's STARTING price —
												// the mockup quote lands on top, so the receipt must not
												// print it as the settled amount (86eyhn4mr).
												`${item.isCustom ? "From " : ""}${receiptAmount(
													item.price * item.quantity,
												)}`}
									</span>
								</button>

								{item.note ? (
									<p className="mb-1 truncate pl-4 font-mono text-[11px] text-muted-foreground">
										📝 {item.note}
									</p>
								) : null}
								{item.customImageStorageId ? (
									<p className="mb-1 pl-4 font-mono text-[11px] text-muted-foreground">
										📎 Reference photo attached
									</p>
								) : null}
								{showShortfall ? (
									<p className="mb-1 w-fit rounded-md bg-destructive/10 px-2 py-1 text-[11px] font-medium leading-snug text-destructive">
										Minimum {shortfall.minQuantity} per order — add{" "}
										{shortfall.minQuantity - shortfall.have} more
									</p>
								) : null}
								{overStock ? (
									<p className="mb-1 w-fit rounded-md bg-destructive/10 px-2 py-1 text-[11px] font-medium leading-snug text-destructive">
										Only {cap} left — lower this to {cap} to continue
									</p>
								) : null}

								{expanded ? (
									<div className="flex items-center justify-between gap-3 pb-2 pt-1">
										{item.isCustom ? (
											// Custom lines are one bespoke negotiation, locked to
											// qty 1 — no stepper, just a way out. Borderless, like
											// the stepper it stands in for.
											<button
												type="button"
												onClick={() => cart.removeItem(item.variantId)}
												className="flex w-fit items-center gap-1 rounded-lg pr-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
												aria-label={`Remove ${item.name}`}
											>
												<span className={ROW_ICON_WELL}>
													<Trash2 className="size-4" aria-hidden />
												</span>
												Remove
											</button>
										) : (
											<>
												<QtyStepper
													name={item.name}
													quantity={item.quantity}
													max={cap}
													onChange={(next) =>
														cart.updateQuantity(item.variantId, next)
													}
												/>
												{!item.quoteOnRequest ? (
													<span className="text-xs text-muted-foreground">
														{formatPrice(item.price, item.currency)} each
													</span>
												) : null}
											</>
										)}
									</div>
								) : null}
							</li>
						);
					})}
				</ul>

				{/* Fee/quote rows join the receipt block; TOTAL draws its own rule. */}
				{totals}

				<div className="flex items-center justify-between pt-2">
					<p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
						Tap an item to edit
					</p>
					{onAddMore ? (
						<button
							type="button"
							onClick={onAddMore}
							className="tap-target text-xs font-semibold text-accent-emphasis underline-offset-2 hover:underline"
						>
							+ Add more items
						</button>
					) : null}
				</div>
			</section>

			{/* The tear-off edge — semicircle punch-outs, like the printed ticket. */}
			<div
				aria-hidden
				className="h-2.5 [background-image:radial-gradient(circle_at_8px_-3px,transparent_7px,var(--color-card)_7.5px)] [background-size:16px_10px] [filter:drop-shadow(0_2px_2px_rgba(15,23,42,0.07))]"
			/>

			{footer}
		</div>
	);
}

function QtyStepper({
	name,
	quantity,
	max,
	onChange,
}: {
	name: string;
	quantity: number;
	max: number | undefined;
	onChange: (next: number) => void;
}) {
	const atMax = max !== undefined && quantity >= max;
	const removing = quantity === 1;
	// Bare glyphs, no ringed circles. Three outlined pills for −/qty/+ inside an
	// already-bordered receipt line read as heavy chrome around a one-digit
	// number; the icon alone is the control. The 44px tap target is unchanged —
	// `tap-target` sizes the hit area, the border was only ever decoration.
	const stepBtn = `${ROW_ICON_WELL} rounded-lg text-muted-foreground transition-colors`;
	return (
		<div className="flex items-center gap-1">
			<button
				type="button"
				onClick={() => onChange(quantity - 1)}
				className={`${stepBtn} hover:bg-muted hover:text-foreground`}
				aria-label={removing ? `Remove ${name}` : `Decrease ${name} quantity`}
			>
				{removing ? (
					<Trash2 className="size-4" aria-hidden />
				) : (
					<Minus className="size-4" aria-hidden />
				)}
			</button>
			<span className="min-w-6 text-center text-sm font-semibold tabular-nums">
				{quantity}
			</span>
			<button
				type="button"
				onClick={() => onChange(quantity + 1)}
				disabled={atMax}
				className={`${stepBtn} disabled:opacity-40 enabled:hover:bg-muted enabled:hover:text-foreground`}
				aria-label={`Increase ${name} quantity`}
			>
				<Plus className="size-4" aria-hidden />
			</button>
			{atMax ? (
				<span className="text-[11px] text-muted-foreground">
					Only {max} in stock
				</span>
			) : null}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Totals — the receipt's money block
// ---------------------------------------------------------------------------

/** The checkout form's collapsed quote view (static config + live Lalamove
 * both map onto this — see checkout-form.tsx). */
export type CheckoutQuoteView =
	| PublicDeliveryQuote
	| { kind: "calculating" }
	| undefined;

interface CheckoutTotalsProps {
	subtotal: number;
	currency: string;
	/** Chosen pickup point's flat fee (0 = none/free). */
	pickupFee: number;
	/** Label of the paid pickup point, for the fee row. */
	pickupFeeLabel?: string;
	/** Delivery quote state — undefined when the method is pickup. */
	quote?: CheckoutQuoteView;
	/** Resolved copy for a blocked quote — the form owns the wording (it knows
	 * the store name + whether pickup is an alternative). */
	blockedCopy?: string;
	/** Min-order-rule alert lines (the reason the CTA is disabled). */
	minRuleAlerts?: ReactNode;
	/** Collection-service store (86eyg0n8e) — the rider fee line reads
	 * "Collection" instead of "Delivery". */
	collectsFromCustomer?: boolean;
	/** The cart holds a custom line, so this TOTAL is not the bill: a quote-only
	 * line contributes nothing yet, and a starting-price line only contributes
	 * its floor — the seller settles both on the mockup. Prints "+ your quote"
	 * beside the total, the same posture as a pending delivery fee (86eyhn4mr). */
	awaitingQuote?: boolean;
}

/**
 * What's still missing from the printed total, named beside it ("+ your quote
 * + delivery"). Both holds can be open at once — a custom cake to an
 * out-of-range address — so they read as one list rather than one silently
 * winning. Shared by the receipt block and the mobile bottom bar so the two
 * totals can never disagree about how final they are.
 */
export function pendingTotalParts({
	awaitingQuote = false,
	quotePending = false,
	collectsFromCustomer = false,
}: {
	awaitingQuote?: boolean;
	quotePending?: boolean;
	collectsFromCustomer?: boolean;
}): string[] {
	const parts: string[] = [];
	if (awaitingQuote) parts.push("your quote");
	if (quotePending) parts.push(collectsFromCustomer ? "collection" : "delivery");
	return parts;
}

export function CheckoutTotals({
	subtotal,
	currency,
	pickupFee,
	pickupFeeLabel,
	quote,
	blockedCopy,
	minRuleAlerts,
	collectsFromCustomer = false,
	awaitingQuote = false,
}: CheckoutTotalsProps) {
	const deliveryFee = quote?.kind === "fee" ? quote.fee : 0;
	const total = subtotal + pickupFee + deliveryFee;
	const feeLabel = collectsFromCustomer ? "Collection" : "Delivery";
	const pendingParts = pendingTotalParts({
		awaitingQuote,
		quotePending: quote?.kind === "pending",
		collectsFromCustomer,
	});

	// One icon per fulfilment charge so the row is legible at a glance instead of
	// blending into the item lines above it. Every delivery state gets the same
	// truck (fee / free / pending / calculating are one concept, not four).
	const truck = <Truck className="size-3.5 shrink-0" aria-hidden />;

	return (
		<div className="flex flex-col">
			{/* Charges print as muted receipt lines right under the items — the
			    design shows items + fees as one block, no separate Subtotal row
			    (the items above already sum in plain sight). */}
			{pickupFee > 0 ? (
				<FeeLine
					icon={<Package className="size-3.5 shrink-0" aria-hidden />}
					label={pickupFeeLabel ? `Pickup · ${pickupFeeLabel}` : "Pickup fee"}
					value={receiptAmount(pickupFee)}
				/>
			) : null}
			{deliveryFee > 0 ? (
				<FeeLine
					icon={truck}
					label={feeLabel}
					value={receiptAmount(deliveryFee)}
				/>
			) : null}
			{quote?.kind === "free" && quote.reason === "threshold" ? (
				<FeeLine icon={truck} label={feeLabel} value="FREE" accent />
			) : null}
			{quote?.kind === "pending" ? (
				<FeeLine
					icon={truck}
					label={feeLabel}
					// "no_state" pending = the buyer simply hasn't entered an address
					// yet (weight-mode arrange stores) — "Seller confirms" there would
					// announce a human step that picking an address makes unnecessary.
					value={
						quote.reason === "no_state" ? "Enter address" : "Seller confirms"
					}
				/>
			) : null}
			{quote?.kind === "calculating" ? (
				<FeeLine icon={truck} label={feeLabel} value="Calculating…" pulse />
			) : null}

			<div className="mt-2 flex items-center justify-between border-t-2 border-dashed border-border pt-3">
				<span className="-rotate-2 rounded-md border-2 border-accent/50 px-2 py-0.5 font-mono text-[11px] font-extrabold uppercase tracking-[0.14em] text-accent-emphasis">
					Total
				</span>
				<span className="text-xl font-bold tabular-nums">
					{formatPrice(total, currency)}
					{pendingParts.length > 0 ? (
						<span className="text-sm font-medium text-muted-foreground">
							{" "}
							+ {pendingParts.join(" + ")}
						</span>
					) : null}
				</span>
			</div>

			{blockedCopy ? (
				<p
					role="alert"
					className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
				>
					{blockedCopy}
				</p>
			) : null}
			{minRuleAlerts}
		</div>
	);
}

/** One muted charge line in receipt type — "🚚 Delivery ······ 8.00". */
function FeeLine({
	icon,
	label,
	value,
	accent = false,
	pulse = false,
}: {
	/** Fulfilment glyph (truck / package) — decorative, the label carries the
	 * meaning. Occupies the same left gutter as the items' disclosure caret, so
	 * the whole receipt keeps one text column. */
	icon?: ReactNode;
	label: string;
	value: string;
	accent?: boolean;
	pulse?: boolean;
}) {
	return (
		<div
			className={`flex items-baseline gap-2 py-0.5 font-mono text-[13px] leading-6 ${
				accent ? "text-accent-emphasis" : "text-muted-foreground"
			}`}
		>
			{icon ? <span className="translate-y-0.5">{icon}</span> : null}
			<span className="min-w-0 truncate">{label}</span>
			<span
				aria-hidden
				className="flex-1 border-b-2 border-dotted border-border"
			/>
			<span className={`shrink-0 tabular-nums ${pulse ? "animate-pulse" : ""}`}>
				{value}
			</span>
		</div>
	);
}
