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
	shownHomePeriod,
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

	const gated =
		rangeResult?.gated === true ||
		(plan.closed === null && todayStats?.gated === true);

	// Only the Customers card renders this, and a gated store never gets that
	// card — so asking is a subscription whose answer has nowhere to go. The
	// server would return `null` cheaply either way; this just doesn't ask.
	const lapsed = useQuery(
		convexQuery(
			api.customers.countLapsedRegulars,
			gated
				? "skip"
				: {
						retailerId,
						before: todayStart - QUIET_DAYS * DAY_MS,
					},
		),
	).data;

	/**
	 * What the page is ACTUALLY showing.
	 *
	 * A Starter store can only be told about today, so a disabled "7 days" chip
	 * must not stay selected and the hero must not keep the "last 7 days"
	 * eyebrow over today's figures — the numbers were right and the label was
	 * lying, which is worse than either alone. The chip the seller cannot use
	 * cannot be the chip that is on.
	 */
	const shownPeriod = shownHomePeriod(period, gated);
	const shownPlan = gated ? homeQueryPlan("today") : plan;

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
		period: shownPeriod,
		range: shownPlan.range,
		// Today's context range feeds the chart and the comparison, never the
		// headline — see `homeQueryPlan`.
		rangePayload: shownPlan.includeClosedInTotals ? rangePayload : null,
		todayPayload,
		previousPayload,
	});

	// Chart: the window's own days, plus today's column. For the today view the
	// grid comes from the context range, so the bar chart still shows a week.
	//
	// `null` when the closed range is GATED, which is not the same as a week of
	// zeroes: on Starter `getInsightsRange` refuses every closed range, and
	// treating that as `[]` drew six flat bars under "Today against the last 6
	// days" — a Starter who sold RM 800 yesterday was shown a chart saying they
	// sold nothing all week (PR #358 review). No answer is not an answer of zero.
	const contextTrend = gated ? null : (rangePayload?.trend ?? []);
	const bars = buildBars({
		period: shownPeriod,
		trend: view.trend,
		contextTrend,
		todayStart,
		todayEarned: todayPayload?.earned ?? 0,
	});

	// Same rule as the bars: a gated range cannot say what last Monday earned,
	// and "you closed at RM 0.00" would be a figure we do not have.
	const lastWeekdayEarned =
		contextTrend !== null && shownPlan.lastWeekdayStart !== null
			? (contextTrend.find((b) => b.start === shownPlan.lastWeekdayStart)
					?.earned ?? 0)
			: null;
	const lastWeekdayName =
		contextTrend !== null && shownPlan.lastWeekdayStart !== null
			? new Date(shownPlan.lastWeekdayStart).toLocaleDateString("en-GB", {
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
	const drill = insightsRangeSearch(shownPlan.range);
	const enough = hasEnoughForInsights(view.orderCount);

	return (
		<section className="flex flex-col gap-3">
			{/* Mobile order is the Main board's: exceptions, then the Sales
			    heading, the hero, the cards, and Plan ahead last. On `lg` every
			    `order-*` resets and the DOM order takes over, which is the desktop
			    board's: heading, then hero beside its rail, then the cards.

			    Hero and rail share a row HEIGHT (`lg:items-stretch`, Zaki, 14 Oct
			    2026): the rail grows and shrinks with whatever it carries (unpaid
			    only, unpaid + out of stock, plus Plan ahead), and a hero that
			    stopped at its own height left a hole beside a taller rail. The hero
			    fills its column (`lg:flex-1`), so it is never shorter than the
			    rail; when the hero is the taller one, the rail's cards keep their
			    own height and sit at the top. */}
			<div className="order-2 lg:order-none">
				<PeriodChips
					value={shownPeriod}
					onChange={onPeriodChange}
					lockedBeyondToday={gated}
				/>
			</div>

			<div className="contents lg:flex lg:flex-wrap lg:items-stretch lg:gap-4">
				<div className="order-3 flex min-w-0 flex-col gap-3 lg:order-none lg:flex-[999_1_520px]">
					<SalesHero
						className="lg:flex-1"
						view={view}
						currency={currency}
						bars={bars}
						chartTitle={
							shownPeriod === "today"
								? "Today against the last 6 days"
								: "Daily sales"
						}
						bestBarLabel={
							best && best.earned > 0 && shownPeriod !== "today"
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
					// NOT `items-start`: the three cards share a row height, so their
					// bottom edges and footer links line up instead of stepping down by
					// whatever each one happened to contain (Zaki, 13 Oct 2026).
					// `InsightCard` already pushes its footer with `mt-auto`, so the
					// extra height lands as space above the link, not in the evidence.
					<div className="grid gap-4 lg:grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))]">
						<BestSellersCard
							period={shownPeriod}
							products={view.products}
							earned={view.earned}
							currency={currency}
							insightsSearch={drill}
						/>
						<CustomersCard
							period={shownPeriod}
							split={view.customers}
							lapsed={lapsed}
							quietDays={QUIET_DAYS}
						/>
						<SourcesCard
							period={shownPeriod}
							sources={view.sources}
							currency={currency}
							insightsSearch={drill}
							range={shownPlan.range}
						/>
					</div>
				)}
			</div>
		</section>
	);
}

/** Axis ticks on the 30-day view fall on a WEEKLY cadence — see `buildBars`. */
const AXIS_TICK_EVERY_DAYS = 7;

/**
 * The hero's bars.
 *
 * For 7d/30d the view's own contiguous grid is already right. For TODAY the
 * grid is one column, which is not a chart — so the six closed days of context
 * are drawn beside today's live column, which is what the board shows and what
 * makes a partial day legible at all.
 *
 * **The axis is not one label per bar.** Seven weekday names fit the hero's
 * width; thirty do not — they rendered as an unbroken "TueWedThuFriSatSun"
 * smear (Zaki, 14 Oct 2026). And over a month the weekday is the wrong UNIT
 * anyway: "Tue" appears four times and names no particular day, so "Best: Thu"
 * could not be looked up. The 30-day view therefore prints DATES on a weekly
 * cadence, anchored to the most recent day so the right-hand end is always
 * labelled; the shorter views keep a weekday on every bar, which is what the
 * board draws. Every bar carries a `title` either way, so thinning the axis
 * loses nothing on hover.
 */
function buildBars(opts: {
	period: HomePeriod;
	trend: ReadonlyArray<{ start: number; earned: number }>;
	/** `null` = the closed range is gated, so there is no context to draw. */
	contextTrend: ReadonlyArray<{ start: number; earned: number }> | null;
	todayStart: number;
	todayEarned: number;
}): {
	start: number;
	earned: number;
	/** What the axis prints for this bar, and what "Best:" calls it. */
	label: string;
	/** The unabbreviated day, for the hover title — always present. */
	title: string;
	/** Whether the axis prints `label` here. */
	tick: boolean;
}[] {
	const fmt = (start: number, opts_: Intl.DateTimeFormatOptions) =>
		new Date(start).toLocaleDateString("en-GB", {
			...opts_,
			timeZone: "Asia/Kuala_Lumpur",
		});
	// Over a month a weekday names no particular day; over a week it is the
	// clearest thing we can say in three characters.
	const label = (start: number) =>
		opts.period === "30d"
			? fmt(start, { day: "numeric", month: "short" })
			: fmt(start, { weekday: "short" });
	const title = (start: number) =>
		fmt(start, { weekday: "short", day: "numeric", month: "short" });

	if (opts.period !== "today") {
		const last = opts.trend.length - 1;
		return opts.trend.map((b, i) => ({
			start: b.start,
			earned: b.earned,
			label: label(b.start),
			title: title(b.start),
			// Counted back from the LAST bar, so the most recent day always carries
			// a label and the thinning eats into the old end instead.
			tick: opts.period !== "30d" || (last - i) % AXIS_TICK_EVERY_DAYS === 0,
		}));
	}

	// Gated: today's column alone. `SalesHero` draws the chart only at
	// `bars.length > 1`, so one bar hides it — the figures stay, and the Pro
	// teaser below says why the week is missing. Better a chart we don't draw
	// than one that invents the days we are not allowed to read.
	if (opts.contextTrend === null)
		return [
			{
				start: opts.todayStart,
				earned: opts.todayEarned,
				label: label(opts.todayStart),
				title: title(opts.todayStart),
				tick: true,
			},
		];

	const byStart = new Map(opts.contextTrend.map((b) => [b.start, b.earned]));
	const out: ReturnType<typeof buildBars> = [];
	for (let i = 6; i >= 1; i--) {
		const start = opts.todayStart - i * DAY_MS;
		out.push({
			start,
			earned: byStart.get(start) ?? 0,
			label: label(start),
			title: title(start),
			tick: true,
		});
	}
	out.push({
		start: opts.todayStart,
		earned: opts.todayEarned,
		label: label(opts.todayStart),
		title: title(opts.todayStart),
		tick: true,
	});
	return out;
}
