import { Link } from "@tanstack/react-router";
import { ArrowRight, X } from "lucide-react";
import { useRef, useState } from "react";
import { formatFulfilmentDate } from "../../../convex/lib/fulfilmentDate";
import type { Bucketing, TrendBucket } from "../../../convex/lib/insights";
import { formatPrice, formatPriceCompact } from "../../lib/format";
import { bucketLabel } from "../../lib/insights-view";
import { cn } from "../../lib/utils";

// Revenue trend — hand-rolled bars (no chart library). Plots EARNED revenue per
// bucket, anchored on order date. Day buckets for ranges ≤ 31 days, week buckets
// above.
//
// Interaction is mobile-first: a `title` hover tooltip is useless on a phone, and
// a 30-day range gives ~11px bars — far below the 44px tap rule — so instead of
// per-bar buttons the whole chart is a SCRUBBER: tap or drag anywhere and the
// nearest bar is selected (Apple-Health style). The readout row above the chart
// shows the selected bucket's date, earned revenue and order count, plus a deep
// link into the orders inbox filtered to that bucket (`?from&to` on createdAt).
// Keyboard: focus the chart, ←/→/Home/End move the selection, Esc clears it.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Index of the bar under a pointer x-offset within the chart width. Pure so
 * it's unit-testable without layout. */
export function scrubIndex(
	offsetX: number,
	width: number,
	count: number,
): number {
	if (count <= 0 || width <= 0) return 0;
	const idx = Math.floor((offsetX / width) * count);
	return Math.max(0, Math.min(count - 1, idx));
}

/** Inclusive createdAt bounds of a bucket — feeds the inbox `?from&to` filter. */
export function bucketRange(
	start: number,
	bucketing: Bucketing,
): { from: number; to: number } {
	const span = bucketing === "day" ? DAY_MS : 7 * DAY_MS;
	return { from: start, to: start + span - 1 };
}

export function RevenueTrend({
	trend,
	bucketing,
	currency,
}: {
	trend: TrendBucket[];
	bucketing: Bucketing;
	currency: string;
}) {
	const [selected, setSelected] = useState<number | null>(null);
	const draggingRef = useRef(false);
	const chartRef = useRef<HTMLDivElement>(null);

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

	const sel = selected !== null ? trend[selected] : null;

	function selectFromClientX(clientX: number) {
		const el = chartRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		setSelected(scrubIndex(clientX - rect.left, rect.width, trend.length));
	}

	function onKeyDown(e: React.KeyboardEvent) {
		if (trend.length === 0) return;
		const last = trend.length - 1;
		if (e.key === "ArrowLeft") {
			e.preventDefault();
			setSelected((s) => Math.max(0, (s ?? trend.length) - 1));
		} else if (e.key === "ArrowRight") {
			e.preventDefault();
			setSelected((s) => Math.min(last, (s ?? -1) + 1));
		} else if (e.key === "Home") {
			e.preventDefault();
			setSelected(0);
		} else if (e.key === "End") {
			e.preventDefault();
			setSelected(last);
		} else if (e.key === "Escape") {
			setSelected(null);
		}
	}

	const bucketNoun = bucketing === "day" ? "day" : "week";

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
					{/* Readout — fixed min-height so selecting never shifts the layout.
					    Two stacked rows (date + clear, then amount + link) so a long
					    amount never wraps mid-phrase on a 375px screen. */}
					<div className="flex min-h-12 flex-col justify-center gap-0.5 rounded-xl bg-muted/50 px-3 py-2">
						{sel ? (
							<>
								<div className="flex items-center justify-between gap-2">
									<span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
										{bucketing === "day"
											? formatFulfilmentDate(sel.start)
											: `Week of ${formatFulfilmentDate(sel.start, { weekday: false })}`}
									</span>
									<button
										type="button"
										onClick={() => setSelected(null)}
										className="-my-1 -mr-1.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground"
										aria-label="Clear selection"
									>
										<X className="size-4" />
									</button>
								</div>
								<div className="flex items-center justify-between gap-2">
									<span
										className="min-w-0 truncate text-sm font-bold tabular-nums"
										title={formatPrice(sel.earned, currency)}
									>
										{formatPriceCompact(sel.earned, currency)}
										<span className="ml-1.5 font-medium text-muted-foreground">
											· {sel.orderCount} order{sel.orderCount === 1 ? "" : "s"}
										</span>
									</span>
									{sel.orderCount > 0 ? (
										<Link
											to="/app/orders"
											search={bucketRange(sel.start, bucketing)}
											className="-my-1 flex h-8 shrink-0 items-center gap-1 rounded-lg px-1.5 text-xs font-semibold text-accent-emphasis transition-colors hover:bg-accent/10"
										>
											View orders
											<ArrowRight className="size-3.5" />
										</Link>
									) : null}
								</div>
							</>
						) : (
							<p className="text-xs text-muted-foreground">
								Peak {bucketNoun}:{" "}
								<span className="font-semibold text-foreground">
									{formatPriceCompact(max, currency)}
								</span>
								<span className="ml-1.5">
									— tap or drag the chart for {bucketNoun} details
								</span>
							</p>
						)}
					</div>

					{/* The scrubbable chart — a slider-style scrubber over ~30 bars beats
					    30 sub-44px tab stops. `touch-action: pan-y` keeps vertical page
					    scroll working while horizontal drags scrub the selection. */}
					<div
						ref={chartRef}
						role="slider"
						tabIndex={0}
						aria-label={`Revenue per ${bucketNoun} — use arrow keys to inspect`}
						aria-valuemin={0}
						aria-valuemax={Math.max(0, trend.length - 1)}
						aria-valuenow={selected ?? undefined}
						aria-valuetext={
							sel
								? `${bucketLabel(sel.start)}: ${formatPrice(sel.earned, currency)}, ${sel.orderCount} orders`
								: "No selection"
						}
						onKeyDown={onKeyDown}
						onPointerDown={(e) => {
							draggingRef.current = true;
							e.currentTarget.setPointerCapture(e.pointerId);
							selectFromClientX(e.clientX);
						}}
						onPointerMove={(e) => {
							if (draggingRef.current) selectFromClientX(e.clientX);
						}}
						onPointerUp={() => {
							draggingRef.current = false;
						}}
						className="flex h-40 cursor-pointer items-end gap-1 rounded-lg focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
						style={{ touchAction: "pan-y" }}
					>
						{trend.map((b, i) => {
							const pct = max > 0 ? (b.earned / max) * 100 : 0;
							const isSel = selected === i;
							return (
								<div
									key={b.start}
									className="pointer-events-none flex h-full flex-1 items-end"
								>
									<div
										className={cn(
											"w-full rounded-t transition-colors",
											isSel
												? "bg-accent"
												: selected !== null
													? "bg-accent/30"
													: "bg-accent/80",
										)}
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
				</div>
			)}
		</div>
	);
}
