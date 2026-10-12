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
}: {
	view: HomeSalesView;
	currency: string;
	/** One entry per day in the window, already bucketed. */
	bars: ReadonlyArray<{ start: number; earned: number; label: string }>;
	chartTitle: string;
	bestBarLabel: string | null;
	lastWeekdayName?: string;
	lastWeekdayEarned?: number | null;
	insightsSearch: InsightsRangeSearch;
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

	return (
		<section className="relative flex flex-col gap-[18px] overflow-hidden rounded-3xl bg-foreground p-5 text-background">
			<div
				aria-hidden="true"
				className="pointer-events-none absolute -right-12 -top-14 size-[200px] rounded-full bg-accent/30 blur-[44px]"
			/>

			<div className="relative flex flex-col gap-1.5">
				<span className="flex items-center gap-2">
					<span className="flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-accent/25 text-accent">
						<Wallet className="size-3.5" aria-hidden="true" />
					</span>
					<span className="text-[11px] font-bold uppercase tracking-[0.08em] text-background/70">
						Revenue earned · {PERIOD_EYEBROW[period]}
					</span>
				</span>
				<div className="flex items-end justify-between gap-3">
					<span
						title={formatPrice(earned, currency)}
						className="font-heading text-[42px] font-extrabold leading-none tracking-tight text-accent"
					>
						{heroAmount(earned, currency)}
					</span>
					{delta ? (
						<span
							className={cn(
								"mb-1 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold tabular-nums",
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

			{bars.length > 1 ? (
				<div className="relative flex flex-col gap-2">
					<div className="flex items-baseline justify-between gap-3 text-[11px] text-background/60">
						<span>{chartTitle}</span>
						{bestBarLabel ? <span>Best: {bestBarLabel}</span> : null}
					</div>
					<div
						className="flex h-[84px] items-end gap-1.5 border-b border-background/20"
						role="img"
						aria-label={`Daily sales for the ${PERIOD_EYEBROW[period]}`}
					>
						{bars.map((b, i) => (
							<div
								key={b.start}
								style={{
									height: `${Math.max(4, maxBar > 0 ? Math.round((b.earned / maxBar) * 84) : 4)}px`,
								}}
								className={cn(
									"min-w-0 flex-1 rounded-t-[5px]",
									i === bars.length - 1 && period === "today"
										? "bg-accent"
										: "bg-accent/40",
								)}
							/>
						))}
					</div>
					<div className="flex text-[10px] text-background/60">
						{bars.map((b) => (
							<span key={b.start} className="flex-1 text-center">
								{b.label}
							</span>
						))}
					</div>
				</div>
			) : null}

			<div className="relative flex flex-col gap-1.5">
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

			<div className="relative grid grid-cols-2 gap-3 border-t border-background/15 pt-3.5">
				<Stat label="Orders" value={String(orderCount)} />
				<Stat label="Avg order" value={formatPrice(aov, currency)} />
			</div>

			<Link
				to="/app/insights"
				search={insightsSearch}
				className="relative -mb-1 flex min-h-11 items-center justify-between gap-2 text-sm font-bold text-accent hover:underline"
			>
				Open full Insights
				<ChevronRight className="size-4 shrink-0" aria-hidden="true" />
			</Link>
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
