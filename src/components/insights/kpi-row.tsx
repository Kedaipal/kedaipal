import { formatPrice, formatPriceCompact } from "../../lib/format";
import { cn } from "../../lib/utils";

// The four headline numbers. Money uses formatPriceCompact (tight tiles) with a
// full-precision `title` on hover. Earned vs collected sit side by side because
// "delivered ≠ paid" is the whole point of the split.

/** Hover copy behind the deposit sub-label — the one line on the page that
 * explains WHY "Revenue earned" is smaller than a booking seller's bank
 * statement (z8r3fdcw70). The sub-label carries the amount; this carries the
 * reason. */
export const DEPOSIT_EXCLUSION_HINT =
	"Security deposits are held money returned after check-out, so they are not counted as revenue.";

function KpiTile({
	label,
	value,
	hint,
	sub,
	subHint,
	emphasis,
}: {
	label: string;
	value: string;
	hint?: string;
	sub?: string;
	/** Hover title on the sub-label (the value's own hover is `hint`). */
	subHint?: string;
	emphasis?: boolean;
}) {
	return (
		<div className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-4">
			<span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
				{label}
			</span>
			<span
				className={cn(
					"font-heading text-xl font-extrabold leading-tight tabular-nums lg:text-2xl",
					emphasis && "text-accent-emphasis",
				)}
				title={hint}
			>
				{value}
			</span>
			{sub ? (
				<span className="text-[11px] text-muted-foreground" title={subHint}>
					{sub}
				</span>
			) : null}
		</div>
	);
}

export function KpiRow({
	earned,
	depositsHeld,
	collected,
	orderCount,
	aov,
	currency,
}: {
	earned: number;
	/** Σ security deposit netted out of `earned` in this window (0 on a store
	 * without booking deposits). */
	depositsHeld: number;
	collected: number;
	orderCount: number;
	aov: number;
	currency: string;
}) {
	const outstanding = Math.max(0, earned - collected);
	// A booking order's total carries a refundable deposit that `earned` nets
	// out (booking S5). Say so, with the amount, only when there is something to
	// say — a store without deposits must see zero change.
	const hasDeposits = depositsHeld > 0;
	const earnedSub = hasDeposits
		? `excl. ${formatPriceCompact(depositsHeld, currency)} security deposits`
		: "confirmed → delivered";
	return (
		<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
			<KpiTile
				label="Revenue earned"
				value={formatPriceCompact(earned, currency)}
				hint={formatPrice(earned, currency)}
				sub={earnedSub}
				subHint={hasDeposits ? DEPOSIT_EXCLUSION_HINT : undefined}
				emphasis
			/>
			<KpiTile
				label="Collected"
				value={formatPriceCompact(collected, currency)}
				hint={formatPrice(collected, currency)}
				sub={
					outstanding > 0
						? `${formatPriceCompact(outstanding, currency)} outstanding`
						: "fully collected"
				}
			/>
			<KpiTile
				label="Orders"
				value={orderCount.toLocaleString("en-MY")}
				sub="paid & unpaid"
			/>
			<KpiTile
				label="Avg order"
				value={formatPriceCompact(aov, currency)}
				hint={formatPrice(aov, currency)}
				sub="earned ÷ orders"
			/>
		</div>
	);
}
