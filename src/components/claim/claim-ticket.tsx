import { formatPrice } from "../../lib/format";
import {
	RECEIPT_LABEL_CLASS,
	RECEIPT_VARIANT_CLASS,
	receiptLineLabel,
} from "../../lib/receipt-line";

/** Receipt type — the claim ticket reads exactly like the storefront one. */
const CLAIM_LINES_TICKET = "font-mono text-[13px] leading-6";

/**
 * The claim Order Ticket — the buyer's frozen, price-locked lines.
 *
 * Pure and prop-driven ON PURPOSE, exactly like the storefront's
 * `CheckoutSummary`: the page around it pulls live quotes, a calendar and a
 * form, none of which a receipt needs, and while this markup lived inside that
 * page nothing could unit-test it. That is how it kept `truncate` on its item
 * label — joining name, variant and a trailing `×qty` into one string — for a
 * whole release after the storefront ticket was fixed (`z8r3fdhpaj`).
 */
export function ClaimTicket({
	storeName,
	currency,
	lines,
	fulfilmentLabel,
	fulfilmentAmount,
	feeSettled,
	displayTotal,
}: {
	storeName: string;
	currency: string;
	lines: ReadonlyArray<{
		variantId: string;
		name: string;
		variantLabel?: string;
		price: number;
		quantity: number;
	}>;
	/** "Pickup" / "Delivery" / "Collection" — the page knows which. */
	fulfilmentLabel: string;
	/** Already-resolved money or quote state ("free", "after address", …). */
	fulfilmentAmount: string;
	feeSettled: boolean;
	displayTotal: number;
}) {
	return (
		<section
			aria-label="Order summary"
			className="rounded-t-xl bg-card px-4 pb-3 pt-4 shadow-[0_2px_12px_rgba(15,23,42,0.08)] ring-1 ring-border/40"
		>
			<div className="pb-3 text-center">
				<h2 className="font-heading text-base font-extrabold uppercase tracking-[0.06em]">
					{storeName}
				</h2>
				<p className="mt-1 font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
					Order ticket · To complete
				</p>
			</div>
			<div className="border-t-2 border-dashed border-border" aria-hidden />
			<ul className="py-2">
				{lines.map((line, i) => (
					<li
						// biome-ignore lint/suspicious/noArrayIndexKey: frozen list, never reordered.
						key={`${line.variantId}-${i}`}
						className={`flex items-baseline gap-2 py-1 ${CLAIM_LINES_TICKET}`}
					>
						{/* Wraps, never truncates. This joined name, variant and a
					    TRAILING `×qty` into one `truncate`d string, so a long name
					    ate the option and — worse — the quantity, on the last screen
					    before the buyer commits to a seller-sent claim link. The
					    quantity now leads and the variant has its own line, both
					    from the same shared definition the storefront ticket uses,
					    so the two can't drift again (`z8r3fdhpaj`). */}
						<span className={RECEIPT_LABEL_CLASS}>
							{receiptLineLabel(line.quantity, line.name)}
							{line.variantLabel ? (
								<span className={RECEIPT_VARIANT_CLASS}>
									{line.variantLabel}
								</span>
							) : null}
						</span>
						<span
							aria-hidden
							className="flex-1 border-b-2 border-dotted border-border"
						/>
						<span className="shrink-0 tabular-nums">
							{((line.price * line.quantity) / 100).toFixed(2)}
						</span>
					</li>
				))}
				<li
					className={`flex items-baseline gap-2 py-1 text-muted-foreground ${CLAIM_LINES_TICKET}`}
				>
					<span className="min-w-0 truncate">{fulfilmentLabel}</span>
					<span
						aria-hidden
						className="flex-1 border-b-2 border-dotted border-border"
					/>
					<span className="shrink-0 tabular-nums">{fulfilmentAmount}</span>
				</li>
			</ul>
			<div className="flex items-baseline gap-2 border-t-2 border-dashed border-border pt-2.5">
				<p className="font-heading flex-1 text-sm font-extrabold uppercase tracking-[0.04em]">
					{feeSettled ? "Total" : "Items total"}
				</p>
				<p className="font-mono text-lg font-bold tabular-nums">
					{formatPrice(displayTotal, currency)}
				</p>
			</div>
			<p className="mt-2 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
				Price set by {storeName} · items can't be changed
			</p>
		</section>
	);
}
