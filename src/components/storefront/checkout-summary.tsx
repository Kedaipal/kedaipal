import { Minus, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { PublicDeliveryQuote } from "../../../convex/delivery";
import type { UseCart } from "../../hooks/useCart";
import { formatPrice } from "../../lib/format";
import { AppImage } from "../ui/app-image";

/**
 * The checkout page's order summary — a receipt-styled card (the "Order
 * Ticket" treatment from the storefront redesign, 86eybrhrt): dotted leader
 * lines, dashed separators, tabular digits, and a stamped Total. Personality
 * lives HERE, never in the form controls below it.
 *
 * Pure component: cart mutations go through the `UseCart` handle, totals and
 * quote states are computed by the checkout form and passed in via
 * `CheckoutTotals` / the `totals` slot — so this stays unit-testable without
 * Convex or router providers.
 */

/** Min-quantity shortfall per product (from convex/lib/minOrderRules). */
export interface QtyShortfall {
	productId: string;
	name: string;
	minQuantity: number;
	have: number;
}

interface CheckoutSummaryProps {
	cart: UseCart;
	/** "+ Add more items" — routes back to the store without losing state. */
	onAddMore?: () => void;
	/**
	 * Max sellable units for a variant (hard-block items = live on-hand stock).
	 * Undefined = uncapped (made-to-order, or the product left the public list
	 * after the item was added — the server still judges at create).
	 */
	stockCapFor?: (variantId: string) => number | undefined;
	/** Per-product min-quantity shortfalls, rendered once per product on its
	 * first non-custom line — right next to the stepper that fixes them. */
	shortfalls?: ReadonlyArray<QtyShortfall>;
	/** Totals block (usually `CheckoutTotals`) — rendered under a dashed rule. */
	totals?: ReactNode;
	/** Desktop CTA slot rendered at the card's end (hidden on mobile by the
	 * caller — the mobile CTA lives in the sticky bottom bar). */
	footer?: ReactNode;
}

export function CheckoutSummary({
	cart,
	onAddMore,
	stockCapFor,
	shortfalls,
	totals,
	footer,
}: CheckoutSummaryProps) {
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
		<section
			aria-label="Order summary"
			className="flex flex-col rounded-2xl border border-border bg-card p-4 shadow-sm"
		>
			<div className="flex items-baseline justify-between">
				<h2 className="font-heading text-base font-bold">Your order</h2>
				<span className="text-xs text-muted-foreground">
					{cart.itemCount} {cart.itemCount === 1 ? "item" : "items"}
				</span>
			</div>

			<ul className="mt-2 flex flex-col">
				{cart.items.map((item, itemIndex) => {
					const shortfall = shortfallByProduct.get(item.productId);
					const showShortfall =
						shortfall && firstLineForProduct.get(item.productId) === itemIndex;
					const cap = stockCapFor?.(item.variantId);
					return (
						<li
							key={item.variantId}
							className="flex items-start gap-3 border-b border-border/60 py-3 last:border-b-0"
						>
							<AppImage
								src={item.imageUrl}
								alt={item.name}
								aspect="size-12 shrink-0"
								rounded="rounded-lg"
							/>
							<div className="flex min-w-0 flex-1 flex-col gap-0.5">
								<span className="text-sm font-medium leading-tight">
									{item.name}
								</span>
								{item.optionLabel ? (
									<span className="text-xs font-medium text-muted-foreground">
										{item.optionLabel}
									</span>
								) : null}
								<span className="text-xs text-muted-foreground">
									{item.quoteOnRequest
										? "Price on quote"
										: `${formatPrice(item.price, item.currency)} each`}
								</span>
								{item.note ? (
									<span className="mt-1 rounded-md bg-muted/60 px-2 py-1 text-[11px] leading-snug text-muted-foreground">
										📝 {item.note}
									</span>
								) : null}
								{item.customImageStorageId ? (
									<span className="mt-1 w-fit rounded-md bg-muted/60 px-2 py-1 text-[11px] leading-snug text-muted-foreground">
										📎 Reference photo attached
									</span>
								) : null}
								{showShortfall ? (
									<span className="mt-1 w-fit rounded-md bg-destructive/10 px-2 py-1 text-[11px] font-medium leading-snug text-destructive">
										Minimum {shortfall.minQuantity} per order — add{" "}
										{shortfall.minQuantity - shortfall.have} more
									</span>
								) : null}
								<div className="mt-1.5">
									{item.isCustom ? (
										// Custom lines are one bespoke negotiation, locked to qty 1
										// — no stepper, just a way out.
										<button
											type="button"
											onClick={() => cart.removeItem(item.variantId)}
											className="tap-target flex w-fit items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:border-destructive/40 hover:text-destructive"
											aria-label={`Remove ${item.name}`}
										>
											<Trash2 className="size-3" aria-hidden />
											Remove
										</button>
									) : (
										<QtyStepper
											name={item.name}
											quantity={item.quantity}
											max={cap}
											onChange={(next) =>
												cart.updateQuantity(item.variantId, next)
											}
										/>
									)}
								</div>
							</div>
							<span className="text-sm font-semibold tabular-nums">
								{item.quoteOnRequest
									? "On quote"
									: formatPrice(item.price * item.quantity, item.currency)}
							</span>
						</li>
					);
				})}
			</ul>

			{onAddMore ? (
				<button
					type="button"
					onClick={onAddMore}
					className="tap-target mt-1 w-fit text-xs font-semibold text-accent-emphasis underline-offset-2 hover:underline"
				>
					+ Add more items
				</button>
			) : null}

			{totals ? (
				<div className="mt-3 border-t-2 border-dashed border-border pt-3">
					{totals}
				</div>
			) : null}
			{footer}
		</section>
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
	return (
		<div className="flex items-center gap-1.5">
			<button
				type="button"
				onClick={() => onChange(quantity - 1)}
				className="tap-target flex size-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-accent/50 hover:text-foreground"
				aria-label={removing ? `Remove ${name}` : `Decrease ${name} quantity`}
			>
				{removing ? (
					<Trash2 className="size-3.5" aria-hidden />
				) : (
					<Minus className="size-3.5" aria-hidden />
				)}
			</button>
			<span className="min-w-6 text-center text-sm font-semibold tabular-nums">
				{quantity}
			</span>
			<button
				type="button"
				onClick={() => onChange(quantity + 1)}
				disabled={atMax}
				className="tap-target flex size-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors disabled:opacity-40 enabled:hover:border-accent/50 enabled:hover:text-foreground"
				aria-label={`Increase ${name} quantity`}
			>
				<Plus className="size-3.5" aria-hidden />
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
}

export function CheckoutTotals({
	subtotal,
	currency,
	pickupFee,
	pickupFeeLabel,
	quote,
	blockedCopy,
	minRuleAlerts,
}: CheckoutTotalsProps) {
	const deliveryFee = quote?.kind === "fee" ? quote.fee : 0;
	// Subtotal only earns its row when another money line gives it meaning —
	// a lone "Subtotal + Total" pair saying the same number is noise.
	const showBreakdown =
		pickupFee > 0 ||
		deliveryFee > 0 ||
		(quote?.kind === "free" && quote.reason === "threshold") ||
		quote?.kind === "pending" ||
		quote?.kind === "calculating";
	const total = subtotal + pickupFee + deliveryFee;

	return (
		<div className="flex flex-col gap-1.5">
			{showBreakdown ? (
				<ReceiptLine label="Subtotal" value={formatPrice(subtotal, currency)} />
			) : null}
			{pickupFee > 0 ? (
				<ReceiptLine
					label={
						pickupFeeLabel ? `Pickup fee — ${pickupFeeLabel}` : "Pickup fee"
					}
					value={formatPrice(pickupFee, currency)}
				/>
			) : null}
			{deliveryFee > 0 ? (
				<ReceiptLine
					label="Delivery fee"
					value={formatPrice(deliveryFee, currency)}
				/>
			) : null}
			{quote?.kind === "free" && quote.reason === "threshold" ? (
				<div className="flex items-center justify-between text-sm font-medium text-accent-emphasis">
					<span>Delivery</span>
					<span>FREE for this order size</span>
				</div>
			) : null}
			{quote?.kind === "pending" ? (
				<div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
					<span>Delivery charge</span>
					<span className="text-right">Confirmed by seller after checkout</span>
				</div>
			) : null}
			{quote?.kind === "calculating" ? (
				<div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
					<span>Delivery fee</span>
					<span className="animate-pulse">Calculating…</span>
				</div>
			) : null}

			{/* Own dashed rule only when fee rows sit above it — with no breakdown
			    the summary card's rule already frames this row (no double lines). */}
			<div
				className={`flex items-center justify-between ${
					showBreakdown
						? "mt-1 border-t-2 border-dashed border-border pt-3"
						: ""
				}`}
			>
				<span className="-rotate-2 rounded-md border-2 border-accent/50 px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-[0.12em] text-accent-emphasis">
					Total
				</span>
				<span className="text-xl font-bold tabular-nums">
					{formatPrice(total, currency)}
					{quote?.kind === "pending" ? (
						<span className="text-sm font-medium text-muted-foreground">
							{" "}
							+ delivery
						</span>
					) : null}
				</span>
			</div>

			{blockedCopy ? (
				<p
					role="alert"
					className="mt-1 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
				>
					{blockedCopy}
				</p>
			) : null}
			{minRuleAlerts}
		</div>
	);
}

function ReceiptLine({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-baseline gap-2 text-sm">
			<span className="text-muted-foreground">{label}</span>
			<span
				aria-hidden
				className="flex-1 -translate-y-0.5 border-b border-dotted border-border"
			/>
			<span className="tabular-nums">{value}</span>
		</div>
	);
}
