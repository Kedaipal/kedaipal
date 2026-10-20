import { Link } from "@tanstack/react-router";
import {
	ArrowDownRight,
	ArrowUpRight,
	ChevronRight,
	Wallet,
} from "lucide-react";
import { formatPrice, formatPriceCompact } from "../../lib/format";
import {
	comparisonSentence,
	deltaPercent,
	heroAmount,
	notPaidYetLine,
	PERIOD_EYEBROW,
	zeroEarnedLine,
} from "../../lib/home-copy";
import type { HomeSalesView, InsightsRangeSearch } from "../../lib/home-view";
import { cn } from "../../lib/utils";

/**
 * The number the seller came to see (z8r3fdrgzj).
 *
 * Inverted against the page on purpose: this is the one surface Home wants read
 * first, and the whole redesign rests on money leading. The mint glow is
 * decoration; everything else here is a figure or a sentence about one.
 *
 * NOTE (dark mode): this card is `bg-foreground`, which inverts to a near-white
 * slab under the app's dark tokens. Dark mode is not shipped (Zaki, 12 Oct
 * 2026) and Home is built for light only — the hero's dark treatment is settled
 * when dark mode lands, rather than guessed at here. See docs/home.md.
 */
export function SalesHero({
	view,
	currency,
	bars,
	chartTitle,
	bestBarLabel,
	lastWeekdayName,
	lastWeekdayEarned,
	insightsSearch,
	className,
}: {
	view: HomeSalesView;
	currency: string;
	/** One entry per day in the window, already bucketed. */
	bars: ReadonlyArray<{
		start: number;
		earned: number;
		label: string;
		title: string;
		tick: boolean;
	}>;
	chartTitle: string;
	bestBarLabel: string | null;
	lastWeekdayName?: string;
	lastWeekdayEarned?: number | null;
	insightsSearch: InsightsRangeSearch;
	/** Layout from the board — the Home rail stretches the hero to its own
	 * height (`lg:flex-1`), but ONLY when the chart is drawn. The chart is the
	 * one part built to grow: its bar row is `lg:flex-1` and the stats and the
	 * Insights link are `mt-auto`, so extra height lands as taller bars. Without
	 * the chart (a gated store, `bars.length <= 1`) nothing can absorb it, and a
	 * stretched card is a dark slab with a void between the figures and the
	 * stats — so the board leaves that hero at its own height. */
	className?: string;
}) {
	const { period, earned, collected, orderCount, aov, uncollected } = view;
	const delta = deltaPercent({
		period,
		earned,
		previousEarned: view.previousEarned,
	});
	const compare =
		earned === 0 && orderCount === 0
			? zeroEarnedLine(period)
			: comparisonSentence({
					period,
					currency,
					earned,
					previousEarned: view.previousEarned,
					lastWeekdayName,
					lastWeekdayEarned,
				});
	const notPaid = notPaidYetLine({ period, currency, uncollected });
	const collectedPct = earned > 0 ? Math.round((collected / earned) * 100) : 0;
	const maxBar = bars.reduce((m, b) => Math.max(m, b.earned), 0);
	// A month of bars needs a thinner gap and a flatter cap than a week of them:
	// at 30 columns the 6px gap eats more width than the bars do, and a 5px
	// radius on a 5px-wide bar is a dome rather than a column.
	const dense = bars.length > 14;

	return (
		// On a phone this is one column. From `lg` it becomes the desktop board's
		// two: the FIGURES on the left (what a seller reads first) and the chart
		// beside them, wider, because a week of bars needs the room — stretched
		// full width, six quiet days start looking like a broken axis.
		<section
			className={cn(
				"relative flex flex-col gap-[18px] overflow-hidden rounded-3xl bg-foreground p-5 text-background lg:flex-row lg:flex-wrap lg:gap-7 lg:p-6",
				className,
			)}
		>
			<div
				aria-hidden="true"
				className="pointer-events-none absolute -right-12 -top-14 size-[200px] rounded-full bg-accent/30 blur-[44px]"
			/>

			{/* Figures */}
			<div className="relative flex min-w-0 flex-col gap-[18px] lg:flex-[1_1_280px]">
				<div className="flex flex-col gap-1.5">
					<span className="flex items-center gap-2">
						<span className="flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-accent/25 text-accent">
							<Wallet className="size-3.5" aria-hidden="true" />
						</span>
						<span className="text-[11px] font-bold uppercase tracking-[0.08em] text-background/70">
							Revenue earned · {PERIOD_EYEBROW[period]}
						</span>
					</span>
					<div className="flex flex-wrap items-center gap-3">
						<span
							title={formatPrice(earned, currency)}
							className="font-heading text-[42px] font-extrabold leading-none tracking-tight text-accent"
						>
							{heroAmount(earned, currency)}
						</span>
						{delta ? (
							<span
								className={cn(
									"inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold tabular-nums",
									delta.up
										? "bg-accent/20 text-accent"
										: "bg-background/15 text-background/80",
								)}
							>
								{delta.up ? (
									<ArrowUpRight className="size-3.5" aria-hidden="true" />
								) : (
									<ArrowDownRight className="size-3.5" aria-hidden="true" />
								)}
								{delta.pct}%
							</span>
						) : null}
					</div>
					{compare ? (
						<p className="text-[13px] text-background/75">{compare}</p>
					) : null}
				</div>

				<div className="flex flex-col gap-1.5">
					<div className="flex items-baseline justify-between gap-3 text-[13px]">
						<span className="text-background/75">
							Collected{" "}
							<strong className="font-bold text-background">
								{formatPriceCompact(collected, currency)}
							</strong>
						</span>
						<span className="font-bold tabular-nums">{collectedPct}%</span>
					</div>
					<div className="h-1.5 overflow-hidden rounded-full bg-background/20">
						<div
							className="h-full rounded-full bg-accent"
							style={{ width: `${collectedPct}%` }}
						/>
					</div>
					{notPaid ? (
						<p className="text-[11px] text-background/60">{notPaid}</p>
					) : null}
				</div>

				<div className="mt-auto grid grid-cols-2 gap-3 border-t border-background/15 pt-3.5">
					<Stat label="Orders" value={String(orderCount)} />
					<Stat label="Avg order" value={formatPrice(aov, currency)} />
				</div>
			</div>

			{/* Chart */}
			{bars.length > 1 ? (
				<div className="relative flex min-w-0 flex-col gap-2 lg:flex-[2_1_300px]">
					<div className="flex items-baseline justify-between gap-3 text-[11px] text-background/60">
						<span>{chartTitle}</span>
						{bestBarLabel ? <span>Best: {bestBarLabel}</span> : null}
					</div>
					<div
						className={cn(
							// `h-[84px]` WITHOUT `flex-1` on a phone. `flex-1` is
							// `flex: 1 1 0%`, and in this column that is a HEIGHT basis of
							// zero — the parent has no height to grow into below `lg`, so
							// the row resolved to 1px and the chart rendered as a bare
							// axis with no bars at all. It only ever worked on desktop,
							// where `lg:flex-row` stretches this column to the figures
							// beside it and there is free space to grow into.
							"flex h-[84px] shrink-0 items-end border-b border-background/20 lg:h-auto lg:min-h-[140px] lg:flex-1",
							dense ? "gap-[3px]" : "gap-1.5",
						)}
						role="img"
						aria-label={`Daily sales for the ${PERIOD_EYEBROW[period]}`}
					>
						{bars.map((b, i) => (
							<div
								key={b.start}
								// The day and its takings, for every bar — which is what
								// makes thinning the axis lossless rather than merely tidy.
								title={`${b.title} · ${formatPrice(b.earned, currency)}`}
								style={{
									height: `${Math.max(3, maxBar > 0 ? Math.round((b.earned / maxBar) * 100) : 3)}%`,
								}}
								className={cn(
									"min-w-0 flex-1",
									dense ? "rounded-t-[2px]" : "rounded-t-[5px]",
									i === bars.length - 1 && period === "today"
										? "bg-accent"
										: "bg-accent/40",
								)}
							/>
						))}
					</div>
					{/* One cell per bar, so a tick stays under the bar it names. The
					    LABEL is positioned, not aligned: a date is wider than its own
					    column, and `text-align` cannot pull overflowing text back — in
					    LTR it spills right whatever the alignment, which clipped
					    "14 Oct" to "14 Oc" against the card edge on a phone. Centred
					    normally; pinned at the two ends. */}
					<div
						className={cn(
							"relative flex h-4 text-[10px] text-background/60",
							dense ? "gap-[3px]" : "gap-1.5",
						)}
					>
						{bars.map((b, i) => (
							<span key={b.start} className="relative min-w-0 flex-1">
								{b.tick ? (
									<span
										className={cn(
											"absolute top-0 whitespace-nowrap",
											i === 0
												? "left-0"
												: i === bars.length - 1
													? "right-0"
													: "left-1/2 -translate-x-1/2",
										)}
									>
										{b.label}
									</span>
								) : null}
							</span>
						))}
					</div>
					<Link
						to="/app/insights"
						search={insightsSearch}
						className="mt-auto flex min-h-11 items-center justify-end gap-2 text-sm font-bold text-accent hover:underline"
					>
						Open full Insights
						<ChevronRight className="size-4 shrink-0" aria-hidden="true" />
					</Link>
				</div>
			) : (
				// No chart: the link sits at the FOOT beside the stats, not centred
				// against the figures, so it reads as the card's last line.
				<Link
					to="/app/insights"
					search={insightsSearch}
					className="relative -mb-1 flex min-h-11 items-center justify-between gap-2 text-sm font-bold text-accent hover:underline lg:self-end"
				>
					Open full Insights
					<ChevronRight className="size-4 shrink-0" aria-hidden="true" />
				</Link>
			)}
		</section>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex min-w-0 flex-col gap-0.5">
			<span className="text-[10px] font-bold uppercase tracking-[0.08em] text-background/55">
				{label}
			</span>
			<span className="truncate font-heading text-lg font-extrabold tabular-nums">
				{value}
			</span>
		</div>
	);
}
