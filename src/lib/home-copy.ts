/**
 * Every sentence Home says, as pure functions (z8r3fdrgzj).
 *
 * The redesign's premise is that each card STATES ITS CONCLUSION — "Kek Batik
 * Indulgence made 31% of your sales" — with the chart underneath as evidence,
 * rather than making the seller read a bar to work out the point. That turns
 * copy into logic, and logic belongs somewhere it can be tested without
 * rendering anything.
 *
 * Nothing here reads the clock, a store, or a query result. Callers pass the
 * numbers in; these functions decide what the seller is told.
 */

import { formatPrice, formatPriceCompact } from "./format";

/** The three windows Home offers. Mirrors the `?p=` URL state. */
export type HomePeriod = "today" | "7d" | "30d";

export const HOME_PERIODS: readonly HomePeriod[] = ["today", "7d", "30d"];

/** Default window. Seven days is a trading week — long enough to have a shape,
 * short enough that the seller recognises the orders in it. */
export const DEFAULT_HOME_PERIOD: HomePeriod = "7d";

/**
 * How many orders a window needs before the three insight cards appear.
 *
 * Below this a "best seller" is just whichever thing sold twice, and a
 * returning-customer share computed over three people is noise presented as a
 * finding. The threshold line says so plainly instead of showing a confident
 * chart built on nothing.
 */
export const HOME_INSIGHT_MIN_ORDERS = 5;

/** Chip labels — what the seller taps. */
export const PERIOD_CHIP_LABEL: Record<HomePeriod, string> = {
	today: "Today",
	"7d": "7 days",
	"30d": "30 days",
};

/** Hero eyebrow — "Revenue earned · {this}". "so far" is load-bearing on
 * today: the number is still moving. */
export const PERIOD_EYEBROW: Record<HomePeriod, string> = {
	today: "today so far",
	"7d": "last 7 days",
	"30d": "last 30 days",
};

/** Card eyebrow — "Best sellers · {this}". */
export const PERIOD_CARD_LABEL: Record<HomePeriod, string> = {
	today: "today",
	"7d": "last 7 days",
	"30d": "last 30 days",
};

/** The one-liner under a disabled chip on Starter. Says what unlocks it, not
 * "upgrade to continue" — the seller should know what they'd be buying. */
export const PERIOD_LOCKED_REASON = "7 and 30 day views come with Pro";

/** Parse `?p=`. Anything unrecognised falls back to the default rather than
 * erroring — a stale or hand-edited URL should still open a working page. */
export function parseHomePeriod(raw: unknown): HomePeriod {
	return HOME_PERIODS.includes(raw as HomePeriod)
		? (raw as HomePeriod)
		: DEFAULT_HOME_PERIOD;
}

/** How many whole days a window spans — the previous-window shift. */
export function periodDays(period: HomePeriod): number {
	return period === "today" ? 1 : period === "7d" ? 7 : 30;
}

/**
 * The sentence under the big number.
 *
 * TODAY NEVER GETS A PERCENTAGE (decision 2). A partial day measured against a
 * complete one is a falling arrow every morning and a rising one every evening,
 * which would teach the seller to distrust the figure. Instead it names the
 * same weekday last week, which is the comparison a seller actually makes.
 */
export function comparisonSentence(opts: {
	period: HomePeriod;
	currency: string;
	/** Earned in the window immediately before this one. */
	previousEarned: number | null;
	earned: number;
	/** Weekday name for the today comparison, e.g. "Monday". */
	lastWeekdayName?: string;
	/** What that same weekday finished on. */
	lastWeekdayEarned?: number | null;
}): string | null {
	const { period, currency, previousEarned, earned } = opts;
	if (period === "today") {
		if (
			opts.lastWeekdayName === undefined ||
			opts.lastWeekdayEarned === undefined ||
			opts.lastWeekdayEarned === null ||
			// A weekday the store earned nothing on is not a benchmark. "Last
			// Monday you closed at RM 0.00" reads as a fault rather than a
			// comparison, and it is the normal state for a new store — the same
			// reason `deltaPercent` refuses a zero base.
			opts.lastWeekdayEarned <= 0
		)
			return null;
		return `Last ${opts.lastWeekdayName} you closed at ${formatPrice(opts.lastWeekdayEarned, currency)}`;
	}
	// Nothing to compare against: "RM 117 more than the 7 days before" claims a
	// previous week of trading that did not happen. Say what this window is
	// instead, which is the true and useful statement.
	if (previousEarned === null) return null;
	if (previousEarned <= 0)
		return earned > 0 ? "Your first sales in this window" : null;
	const window = period === "7d" ? "7 days" : "30 days";
	const delta = earned - previousEarned;
	if (delta === 0) return `The same as the ${window} before`;
	const word = delta > 0 ? "more" : "less";
	return `${formatPrice(Math.abs(delta), currency)} ${word} than the ${window} before`;
}

/**
 * The percentage pill beside the number. Null for today (see above) and null
 * when the previous window earned nothing — "+∞%" is not a figure, and "+100%"
 * off a base of zero flatters a store that made one sale.
 */
export function deltaPercent(opts: {
	period: HomePeriod;
	earned: number;
	previousEarned: number | null;
}): { pct: number; up: boolean } | null {
	if (opts.period === "today") return null;
	if (opts.previousEarned === null || opts.previousEarned <= 0) return null;
	const ratio = (opts.earned - opts.previousEarned) / opts.previousEarned;
	const pct = Math.round(Math.abs(ratio) * 100);
	if (pct === 0) return null;
	return { pct, up: ratio > 0 };
}

/** "RM 920 of these sales is not paid yet" — the window's own uncollected
 * revenue, which is NOT the strip's "To collect" (every open unpaid order).
 * The wording keeps them apart: "these sales" / "today's sales" is bounded. */
export function notPaidYetLine(opts: {
	period: HomePeriod;
	currency: string;
	uncollected: number;
}): string | null {
	if (opts.uncollected <= 0) return null;
	const scope = opts.period === "today" ? "today's sales" : "these sales";
	return `${formatPrice(opts.uncollected, opts.currency)} of ${scope} is not paid yet`;
}

/** "Kek Batik Indulgence made 31% of your sales" — or, on a live day, that the
 * product is "leading", because the day is not finished and "made" would imply
 * a settled result. */
export function bestSellerHeadline(opts: {
	period: HomePeriod;
	name: string;
	/** Share of the window's earned revenue, 0–100. */
	sharePct: number;
}): string {
	const pct = Math.round(opts.sharePct);
	return opts.period === "today"
		? `${opts.name} is leading today with ${pct}% of sales`
		: `${opts.name} made ${pct}% of your sales`;
}

/** "27 of 42 customers had ordered before". The denominator is identified
 * buyers — orders that arrive without a phone have no identity to count. */
export function customersHeadline(opts: {
	period: HomePeriod;
	returning: number;
	total: number;
}): string {
	const { returning, total } = opts;
	if (total === 0) return "No customers yet in this window";
	if (returning === 0)
		return opts.period === "today"
			? `All ${total} of today's customers are new`
			: `All ${total} customers are new`;
	return opts.period === "today"
		? `${returning} of ${total} customers today have ordered before`
		: `${returning} of ${total} customers had ordered before`;
}

/** "Instagram brought 17 orders (RM 1,420)" — the top TAGGED source, which is
 * the one the seller can do something about. */
export function topSourceHeadline(opts: {
	label: string;
	orders: number;
	revenue: number;
	currency: string;
}): string {
	const noun = opts.orders === 1 ? "order" : "orders";
	return `${opts.label} brought ${opts.orders} ${noun} (${formatPrice(opts.revenue, opts.currency)})`;
}

/** Shown instead when every order came in untagged — there is no winner to
 * name, and the fix is a tagged link, so say that rather than "Direct · 100%". */
export const NO_TAGGED_SOURCE_HEADLINE =
	"Every order came through your plain link";

/** "Saturday is your heaviest day: 14 orders due". Null when the whole week is
 * empty — there is no "heaviest" day among seven zeroes. */
export function planAheadHeadline(opts: {
	days: ReadonlyArray<{ start: number; count: number }>;
	/** Weekday name for a bucket start, injected so this stays clock-free. */
	weekdayName: (start: number) => string;
	/** Which bucket is today, so it can say "Today" rather than the weekday. */
	todayStart?: number;
}): string | null {
	let best: { start: number; count: number } | null = null;
	let total = 0;
	for (const d of opts.days) {
		total += d.count;
		// Strictly greater, so an earlier day wins a tie — the seller prepares
		// for the nearer deadline first.
		if (best === null || d.count > best.count) best = d;
	}
	if (best === null || total === 0) return null;
	const noun = best.count === 1 ? "order" : "orders";
	const name =
		opts.todayStart !== undefined && best.start === opts.todayStart
			? "Today"
			: opts.weekdayName(best.start);
	return `${name} is your heaviest day: ${best.count} ${noun} due`;
}

/** The dashed line that stands in for the three insight cards below the
 * threshold. Two sentences: where the store is, and what appears when it gets
 * there — so the gap reads as "not yet", never as "broken". */
export function insightThresholdLine(orderCount: number): string {
	return `${orderCount} of ${HOME_INSIGHT_MIN_ORDERS} orders. Best sellers, returning customers and order sources appear after your first ${HOME_INSIGHT_MIN_ORDERS} orders.`;
}

/** Do the insight cards have enough to say? */
export function hasEnoughForInsights(orderCount: number): boolean {
	return orderCount >= HOME_INSIGHT_MIN_ORDERS;
}

/** "3 unpaid orders are over 3 days old" + "RM 385 · oldest is from Wed 30 Sep".
 * Two parts because the row renders them on two lines. */
export function staleUnpaidRow(opts: {
	count: number;
	amount: number;
	currency: string;
	staleDays: number;
	/** Pre-formatted date of the oldest, or null when unknown. */
	oldestLabel: string | null;
}): { title: string; detail: string } | null {
	if (opts.count <= 0) return null;
	const noun = opts.count === 1 ? "order is" : "orders are";
	const title = `${opts.count} unpaid ${noun} over ${opts.staleDays} days old`;
	const money = formatPriceCompact(opts.amount, opts.currency);
	return {
		title,
		detail: opts.oldestLabel
			? `${money} · oldest is from ${opts.oldestLabel}`
			: money,
	};
}

/** "8 regulars have gone quiet for 30 days" — capped stores read "20+". */
export function lapsedRegularsLine(opts: {
	count: number;
	capped: boolean;
	quietDays: number;
}): string | null {
	if (opts.count <= 0) return null;
	const n = opts.capped ? `${opts.count}+` : String(opts.count);
	const noun =
		!opts.capped && opts.count === 1 ? "regular has" : "regulars have";
	return `${n} ${noun} gone quiet for ${opts.quietDays} days`;
}

/**
 * "About 3 days of orders at this week's pace".
 *
 * Only worth saying when there IS a pace: below one order a day the division
 * produces "about 97 days", which is arithmetic, not a forecast, and it would
 * tell a quiet store it has nothing to worry about right up until it does.
 */
export function creditPaceLine(opts: {
	balance: number;
	perDay: number;
}): string | null {
	if (opts.perDay < 1) return null;
	if (opts.balance <= 0) return null;
	const days = Math.max(1, Math.round(opts.balance / opts.perDay));
	const noun = days === 1 ? "day" : "days";
	return `About ${days} ${noun} of orders at this week's pace`;
}

/** Hero sentence when the window holds no revenue at all. Says which window,
 * so "RM 0" never looks like a page that failed to load. */
export function zeroEarnedLine(period: HomePeriod): string {
	return period === "today"
		? "No sales yet today"
		: `No sales in the ${period === "7d" ? "last 7 days" : "last 30 days"}`;
}

/**
 * Once this many required steps are done, the finished rows collapse into one
 * line (z8r3fdrgzj decision 8).
 *
 * Three is where a column of struck-through rows stops reading as progress and
 * starts reading as clutter the seller has to scroll past to reach the one
 * thing still asking for them.
 */
export const CHECKLIST_COLLAPSE_AT = 3;

/**
 * "WhatsApp number, products, payment details and store link are done."
 *
 * Built from the steps' SHORT names rather than their row titles, because the
 * titles are instructions ("Add your WhatsApp number") and a list of
 * instructions in the past tense reads as a to-do list that lied.
 */
export function doneStepsSummary(
	shortTitles: ReadonlyArray<string>,
): string | null {
	if (shortTitles.length === 0) return null;
	const verb = shortTitles.length === 1 ? "is" : "are";
	if (shortTitles.length === 1) return `${shortTitles[0]} ${verb} done.`;
	const head = shortTitles.slice(0, -1).join(", ");
	const tail = shortTitles[shortTitles.length - 1];
	return `${head} and ${tail} ${verb} done.`;
}

/** Should the done rows collapse into that one line? */
export function shouldCollapseDoneSteps(doneCount: number): boolean {
	return doneCount >= CHECKLIST_COLLAPSE_AT;
}

/**
 * The hero's headline amount.
 *
 * `formatPrice` always carries two decimals, which at 42px turns "RM 4,860"
 * into "RM 4,860.00" — four characters of noise on the one number the page is
 * built around. A whole-ringgit total drops them; anything with real sen keeps
 * them, because RM 4,860.50 rounded to RM 4,860 would simply be wrong. The
 * hero also carries the full-precision figure in its `title`.
 */
export function heroAmount(minorUnits: number, currency: string): string {
	const full = formatPriceCompact(minorUnits, currency);
	return minorUnits % 100 === 0 ? full.replace(/\.00\b/, "") : full;
}

/**
 * How strongly a Plan-ahead tile is tinted — percent of `--accent` mixed into
 * the card colour (z8r3fdrgzj, read off the design board).
 *
 * The board's own tiles run 3→20%, 4→23%, 5→26%, 6→29%, 7→32%, which is a flat
 * three points per order on an eleven-point base. Absolute rather than relative
 * to the busiest day, deliberately: the same workload should look the same
 * shade whatever else that week holds, so a seller reads "dark green = heavy"
 * once instead of relearning it every week.
 *
 * Clamped, because the ramp is a reading aid and not a measurement — past the
 * ceiling the day is simply "very busy", and the number in the tile says how
 * busy. A day with nothing due is not tinted at all; it is a different kind of
 * day, not a very light one.
 */
export const TILE_TINT_MIN = 14;
export const TILE_TINT_MAX = 45;

export function tileTintPct(count: number): number | null {
	if (count <= 0) return null;
	return Math.min(TILE_TINT_MAX, Math.max(TILE_TINT_MIN, 11 + 3 * count));
}

/**
 * The window the page can actually SHOW, as opposed to the one the URL asks for.
 *
 * A Starter store is only told about today, so the two longer chips are
 * disabled — and a disabled chip must never be the selected one. Without this
 * the page kept "7 days" lit and the hero kept the "last 7 days" eyebrow while
 * the figures underneath were today's: the numbers were right and the label was
 * lying, which is worse than either on its own.
 *
 * The URL is left alone. The seller's stored preference survives the upgrade,
 * so the window they picked comes back the moment it is theirs to use.
 */
export function shownHomePeriod(
	period: HomePeriod,
	gatedBeyondToday: boolean,
): HomePeriod {
	return gatedBeyondToday ? "today" : period;
}
