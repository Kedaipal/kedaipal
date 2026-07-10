import { formatFulfilmentDate } from "../../../convex/lib/fulfilmentDate";
import type { Bucketing, TrendBucket } from "../../../convex/lib/insights";
import { formatPrice, formatPriceCompact } from "../../lib/format";
import { bucketLabel } from "../../lib/insights-view";

// Revenue trend — hand-rolled bars (no chart library). Plots EARNED revenue per
// bucket, anchored on order date. Day buckets for ranges ≤ 31 days, week buckets
// above. Each bar carries a native `title` tooltip with the exact figure; a
// sparse set of x-axis ticks keeps the labels legible on a 375px phone.

export function RevenueTrend({
	trend,
	bucketing,
	currency,
}: {
	trend: TrendBucket[];
	bucketing: Bucketing;
	currency: string;
}) {
	const max = trend.reduce((m, b) => Math.max(m, b.earned), 0);
	const total = trend.reduce((s, b) => s + b.earned, 0);
	// A handful of evenly-spaced ticks (first…last), each free to size to its own
	// text — packing a label under every bar just truncates to "1." on a phone.
	const tickCount = Math.min(5, trend.length);
	const tickIndexes = Array.from(
		new Set(
			Array.from({ length: tickCount }, (_, k) =>
				tickCount <= 1
					? 0
					: Math.round((k * (trend.length - 1)) / (tickCount - 1)),
			),
		),
	);

	return (
		<div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
			<div className="flex items-baseline justify-between gap-2">
				<h3 className="font-heading text-base font-extrabold">Revenue trend</h3>
				<span className="text-xs text-muted-foreground">
					{bucketing === "day" ? "Daily" : "Weekly"} · earned
				</span>
			</div>

			{total <= 0 ? (
				<p className="text-sm text-muted-foreground">
					No earned revenue in this range yet.
				</p>
			) : (
				<div className="flex flex-col gap-2">
					<div className="flex h-40 items-end gap-1">
						{trend.map((b) => {
							const pct = max > 0 ? (b.earned / max) * 100 : 0;
							const label =
								bucketing === "day"
									? formatFulfilmentDate(b.start, { weekday: true })
									: `Week of ${formatFulfilmentDate(b.start, { weekday: false })}`;
							return (
								<div
									key={b.start}
									className="group flex h-full flex-1 items-end"
									title={`${label}: ${formatPrice(b.earned, currency)} · ${b.orderCount} order${b.orderCount === 1 ? "" : "s"}`}
								>
									<div
										className="w-full rounded-t bg-accent/80 transition-colors group-hover:bg-accent"
										style={{
											height: `${b.earned > 0 ? Math.max(2, pct) : 0}%`,
										}}
									/>
								</div>
							);
						})}
					</div>
					<div className="flex justify-between text-[10px] text-muted-foreground">
						{tickIndexes.map((i) => (
							<span key={trend[i].start} className="whitespace-nowrap">
								{bucketLabel(trend[i].start)}
							</span>
						))}
					</div>
					<p className="text-[11px] text-muted-foreground">
						Peak {bucketing === "day" ? "day" : "week"}:{" "}
						<span className="font-medium text-foreground">
							{formatPriceCompact(max, currency)}
						</span>
					</p>
				</div>
			)}
		</div>
	);
}
