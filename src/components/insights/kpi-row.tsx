import { formatPrice, formatPriceCompact } from "../../lib/format";
import { cn } from "../../lib/utils";

// The four headline numbers. Money uses formatPriceCompact (tight tiles) with a
// full-precision `title` on hover. Earned vs collected sit side by side because
// "delivered ≠ paid" is the whole point of the split.

function KpiTile({
	label,
	value,
	hint,
	sub,
	emphasis,
}: {
	label: string;
	value: string;
	hint?: string;
	sub?: string;
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
				<span className="text-[11px] text-muted-foreground">{sub}</span>
			) : null}
		</div>
	);
}

export function KpiRow({
	earned,
	collected,
	orderCount,
	aov,
	currency,
}: {
	earned: number;
	collected: number;
	orderCount: number;
	aov: number;
	currency: string;
}) {
	const outstanding = Math.max(0, earned - collected);
	return (
		<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
			<KpiTile
				label="Revenue earned"
				value={formatPriceCompact(earned, currency)}
				hint={formatPrice(earned, currency)}
				sub="confirmed → delivered"
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
