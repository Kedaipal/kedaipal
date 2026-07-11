import type { PaymentStat } from "../../../convex/lib/insights";
import { PAYMENT_METHOD_LABELS } from "../../../convex/lib/paymentMethod";
import { formatPrice, formatPriceCompact } from "../../lib/format";
import { cn } from "../../lib/utils";

// Hand-rolled SVG donut for the payment-method mix — no chart library (the ticket
// forbids ~100kb of recharts for three static shapes). Monochrome mint by
// opacity (biggest rail = fullest mint) keeps it on-brand and avoids a raw-hex
// rainbow; the legend carries the mapping. Slices are weighted by COLLECTED
// revenue, so Σ slices === the collected KPI.

const RADIUS = 42;
const STROKE = 16;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Opacity ramp — up to 6 methods (cash/duitnow/tng/bank_transfer/card/other) plus
// "unspecified". Darkest = largest slice.
const OPACITY_RAMP = [1, 0.72, 0.5, 0.36, 0.24, 0.16, 0.1];

function methodLabel(method: string): string {
	if (method === "unspecified") return "Online / other";
	return (
		PAYMENT_METHOD_LABELS[method as keyof typeof PAYMENT_METHOD_LABELS] ??
		method
	);
}

export function PaymentDonut({
	payments,
	collected,
	currency,
}: {
	payments: PaymentStat[];
	collected: number;
	currency: string;
}) {
	if (collected <= 0 || payments.length === 0) {
		return (
			<div className="flex min-w-0 flex-col gap-1 rounded-2xl border border-border bg-card p-5">
				<h3 className="font-heading text-base font-extrabold">
					How buyers pay
				</h3>
				<p className="text-sm text-muted-foreground">
					No payments marked received in this range yet. Mark orders paid (or
					settle at the counter) and the mix shows up here.
				</p>
			</div>
		);
	}

	// Cumulative offset for each arc, starting at 12 o'clock.
	let offset = 0;
	const slices = payments.map((p, i) => {
		const fraction = p.revenue / collected;
		const length = fraction * CIRCUMFERENCE;
		const slice = {
			method: p.method,
			revenue: p.revenue,
			fraction,
			opacity: OPACITY_RAMP[Math.min(i, OPACITY_RAMP.length - 1)],
			dasharray: `${length} ${CIRCUMFERENCE - length}`,
			dashoffset: -offset,
		};
		offset += length;
		return slice;
	});

	return (
		<div className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-card p-5">
			<h3 className="font-heading text-base font-extrabold">How buyers pay</h3>
			<div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-6">
				<div className="relative size-40 shrink-0">
					<svg
						viewBox="0 0 100 100"
						className="size-full -rotate-90"
						role="img"
						aria-label="Payment method breakdown by collected revenue"
					>
						<circle
							cx="50"
							cy="50"
							r={RADIUS}
							fill="none"
							className="stroke-muted"
							strokeWidth={STROKE}
						/>
						{slices.map((s) => (
							<circle
								key={s.method}
								cx="50"
								cy="50"
								r={RADIUS}
								fill="none"
								className="stroke-accent"
								strokeOpacity={s.opacity}
								strokeWidth={STROKE}
								strokeDasharray={s.dasharray}
								strokeDashoffset={s.dashoffset}
							/>
						))}
					</svg>
					<div className="absolute inset-0 flex flex-col items-center justify-center text-center">
						<span
							className="font-heading text-lg font-extrabold leading-none"
							title={formatPrice(collected, currency)}
						>
							{formatPriceCompact(collected, currency)}
						</span>
						<span className="mt-1 text-[11px] text-muted-foreground">
							collected
						</span>
					</div>
				</div>
				<ul className="flex w-full min-w-0 flex-col gap-2">
					{slices.map((s) => (
						<li key={s.method} className="flex items-center gap-2.5 text-sm">
							<span
								aria-hidden="true"
								className={cn("size-3 shrink-0 rounded-sm bg-accent")}
								style={{ opacity: s.opacity }}
							/>
							<span className="min-w-0 flex-1 truncate">
								{methodLabel(s.method)}
							</span>
							<span className="shrink-0 tabular-nums text-muted-foreground">
								{Math.round(s.fraction * 100)}%
							</span>
							<span
								className="shrink-0 tabular-nums font-medium"
								title={formatPrice(s.revenue, currency)}
							>
								{formatPriceCompact(s.revenue, currency)}
							</span>
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}
