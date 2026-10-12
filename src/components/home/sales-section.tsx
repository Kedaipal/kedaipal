import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { todayMytMidnight } from "../../../convex/lib/fulfilmentDate";
import {
	type HomePeriod,
	hasEnoughForInsights,
	heroAmount,
	insightThresholdLine,
} from "../../lib/home-copy";
import {
	buildHomeSalesView,
	homeQueryPlan,
	insightsRangeSearch,
} from "../../lib/home-view";
import type { RangePayload, TodayPayload } from "../../lib/insights-view";
import { DepositNote } from "../insights/deposit-note";
import { Skeleton } from "../ui/skeleton";
import { BestSellersCard } from "./best-sellers-card";
import { CustomersCard } from "./customers-card";
import { InsightThreshold } from "./insight-card";
import { PeriodChips } from "./period-chips";
import { ProTeaserCard } from "./pro-teaser-card";
import { SalesHero } from "./sales-hero";
import { SourcesCard } from "./sources-card";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a regular must be silent before Home calls them lapsed. */
export const QUIET_DAYS = 30;

/**
 * The money half of Home (z8r3fdrgzj) — chips, hero, and the three cards the
 * chips govern.
 *
 * All reads go through the TanStack adapter so re-navigating to Home is instant
 * (docs/frontend-caching.md). The Pro reads carry their own `{ gated: true }`
 * branch; this component treats that as "show the teaser", never as an error —
 * the server is the boundary, the teaser is the explanation.
 */
export function SalesSection({
	retailerId,
	currency,
	period,
	onPeriodChange,
	exceptions,
	planAhead,
}: {
	retailerId: Id<"retailers">;
	currency: string;
	period: HomePeriod;
	onPeriodChange: (next: HomePeriod) => void;
	/**
	 * The desktop board's RIGHT RAIL, beside the hero: the exception rows above
	 * the Plan ahead card. They are passed in rather than read here because they
	 * answer operational questions, not sales ones — this component owns the
	 * money, the page owns what sits next to it.
	 *
	 * On a phone there is no rail: `display: contents` dissolves it and the
	 * `order` classes below put each piece back where the mobile board has it —
	 * exceptions above the chips, Plan ahead below the cards.
	 */
	exceptions?: ReactNode;
	planAhead?: ReactNode;
}) {
	const plan = homeQueryPlan(period);
	const todayStart = todayMytMidnight();

	// The closed range — cached by Convex, since its args are whole MYT days and
	// it never reads a clock.
	const rangeResult = useQuery(
		convexQuery(
			api.analytics.getInsightsRange,
			plan.closed
				? {
						retailerId,
						from: plan.closed.from,
						to: plan.closed.to,
						bucketing: "day" as const,
					}
				: "skip",
		),
	).data;

	const previousResult = useQuery(
		convexQuery(
			api.analytics.getInsightsRange,
			plan.previous
				? {
						retailerId,
						from: plan.previous.from,
						to: plan.previous.to,
						bucketing: "day" as const,
					}
				: "skip",
		),
	).data;

	// Today, twice over: the Pro read (products, sources, customers) and the
	// free pulse. Whichever the plan allows is the one that paints.
	const todayStats = useQuery(
		convexQuery(api.analytics.getTodayStats, { retailerId }),
	).data;
	const todayPulse = useQuery(
		convexQuery(api.analytics.getTodayPulse, { retailerId }),
	).data;

	const lapsed = useQuery(
		convexQuery(api.customers.countLapsedRegulars, {
			retailerId,
			before: todayStart - QUIET_DAYS * DAY_MS,
		}),
	).data;

	const gated =
		rangeResult?.gated === true ||
		(plan.closed === null && todayStats?.gated === true);

	const loading =
		todayPulse === undefined ||
		(plan.closed !== null && rangeResult === undefined) ||
		(!gated && todayStats === undefined);

	if (loading)
		return (
			<section className="flex flex-col gap-3">
				<PeriodChips
					value={period}
					onChange={onPeriodChange}
					lockedBeyondToday={false}
				/>
				<Skeleton className="h-[360px] rounded-3xl" />
			</section>
		);

	const rangePayload: RangePayload | null =
		rangeResult && rangeResult.gated === false ? rangeResult : null;
	const previousPayload: RangePayload | null =
		previousResult && previousResult.gated === false ? previousResult : null;
	const todayPayload: TodayPayload | null =
		todayStats && todayStats.gated === false
			? todayStats
			: todayPulse
				? // Starter: the free pulse carries the three figures and nothing
					// else, so the hero renders while the cards stay behind the gate.
					{
						today: todayPulse.today,
						earned: todayPulse.earned,
						depositsExcluded: todayPulse.depositsExcluded,
						collected: todayPulse.collected,
						orderCount: todayPulse.orderCount,
						products: [],
						payments: [],
						sources: [],
						customers: [],
						customersCapped: false,
					}
				: null;

	const view = buildHomeSalesView({
		period,
		range: plan.range,
		// Today's context range feeds the chart and the comparison, never the
		// headline — see `homeQueryPlan`.
		rangePayload: plan.includeClosedInTotals ? rangePayload : null,
		todayPayload,
		previousPayload,
	});

	// Chart: the window's own days, plus today's column. For the today view the
	// grid comes from the context range, so the bar chart still shows a week.
	const contextTrend = rangePayload?.trend ?? [];
	const bars = buildBars({
		period,
		trend: view.trend,
		contextTrend,
		todayStart,
		todayEarned: todayPayload?.earned ?? 0,
	});

	const lastWeekdayEarned =
		plan.lastWeekdayStart !== null
			? (contextTrend.find((b) => b.start === plan.lastWeekdayStart)?.earned ??
				0)
			: null;
	const lastWeekdayName =
		plan.lastWeekdayStart !== null
			? new Date(plan.lastWeekdayStart).toLocaleDateString("en-GB", {
					weekday: "long",
					timeZone: "Asia/Kuala_Lumpur",
				})
			: undefined;

	const best = bars.reduce(
		(m, b) => (b.earned > (m?.earned ?? -1) ? b : m),
		null as (typeof bars)[number] | null,
	);
	// The window the seller is looking at, handed to Insights so "Open full
	// Insights" lands on the same figures rather than Insights' own default.
	const drill = insightsRangeSearch(plan.range);
	const enough = hasEnoughForInsights(view.orderCount);

	return (
		<section className="flex flex-col gap-3">
			{/* Mobile order is the Main board's: exceptions, then the Sales
			    heading, the hero, the cards, and Plan ahead last. On `lg` every
			    `order-*` resets and the DOM order takes over, which is the desktop
			    board's: heading, then hero beside its rail, then the cards. */}
			<div className="order-2 lg:order-none">
				<PeriodChips
					value={period}
					onChange={onPeriodChange}
					lockedBeyondToday={gated}
				/>
			</div>

			<div className="contents lg:flex lg:flex-wrap lg:items-start lg:gap-4">
				<div className="order-3 flex min-w-0 flex-col gap-3 lg:order-none lg:flex-[999_1_520px]">
					<SalesHero
						view={view}
						currency={currency}
						bars={bars}
						chartTitle={
							period === "today"
								? "Today against the last 6 days"
								: "Daily sales"
						}
						bestBarLabel={
							best && best.earned > 0 && period !== "today"
								? `${best.label} · ${heroAmount(best.earned, currency)}`
								: null
						}
						lastWeekdayName={lastWeekdayName}
						lastWeekdayEarned={lastWeekdayEarned}
						insightsSearch={drill}
					/>
					{view.depositsExcluded > 0 ? (
						<DepositNote
							depositsExcluded={view.depositsExcluded}
							currency={currency}
						/>
					) : null}
				</div>

				{exceptions || planAhead ? (
					<div className="contents lg:flex lg:flex-[1_1_320px] lg:flex-col lg:gap-3">
						{exceptions ? (
							<div className="order-1 lg:order-none">{exceptions}</div>
						) : null}
						{planAhead ? (
							<div className="order-5 lg:order-none">{planAhead}</div>
						) : null}
					</div>
				) : null}
			</div>

			<div className="order-4 lg:order-none">
				{gated ? (
					<ProTeaserCard />
				) : !enough ? (
					<InsightThreshold line={insightThresholdLine(view.orderCount)} />
				) : (
					<div className="grid gap-4 lg:grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] lg:items-start">
						<BestSellersCard
							period={period}
							products={view.products}
							earned={view.earned}
							currency={currency}
							insightsSearch={drill}
						/>
						<CustomersCard
							period={period}
							split={view.customers}
							lapsed={lapsed}
							quietDays={QUIET_DAYS}
						/>
						<SourcesCard
							period={period}
							sources={view.sources}
							currency={currency}
							insightsSearch={drill}
							range={plan.range}
						/>
					</div>
				)}
			</div>
		</section>
	);
}

/**
 * The hero's bars.
 *
 * For 7d/30d the view's own contiguous grid is already right. For TODAY the
 * grid is one column, which is not a chart — so the six closed days of context
 * are drawn beside today's live column, which is what the board shows and what
 * makes a partial day legible at all.
 */
function buildBars(opts: {
	period: HomePeriod;
	trend: ReadonlyArray<{ start: number; earned: number }>;
	contextTrend: ReadonlyArray<{ start: number; earned: number }>;
	todayStart: number;
	todayEarned: number;
}): { start: number; earned: number; label: string }[] {
	const label = (start: number) =>
		new Date(start).toLocaleDateString("en-GB", {
			weekday: "short",
			timeZone: "Asia/Kuala_Lumpur",
		});

	if (opts.period !== "today")
		return opts.trend.map((b) => ({
			start: b.start,
			earned: b.earned,
			label: label(b.start),
		}));

	const byStart = new Map(opts.contextTrend.map((b) => [b.start, b.earned]));
	const out: { start: number; earned: number; label: string }[] = [];
	for (let i = 6; i >= 1; i--) {
		const start = opts.todayStart - i * DAY_MS;
		out.push({ start, earned: byStart.get(start) ?? 0, label: label(start) });
	}
	out.push({
		start: opts.todayStart,
		earned: opts.todayEarned,
		label: label(opts.todayStart),
	});
	return out;
}
