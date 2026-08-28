/**
 * Pure reduce logic for the founder's weekly business report — Kedaipal's OWN
 * business health (MRR, who lapsed, signups, order volume), NOT a seller's
 * store performance (that's Seller Insights, `lib/insights.ts`).
 *
 * No Convex imports (mirrors `insights.ts` / `fulfilmentDate.ts`) so the whole
 * aggregation is unit-tested against fixtures without a deployment — which
 * matters more here than usual, because dev carries no subscriptions and prod
 * can't be exercised from a test. See docs/founder-business-report.md.
 *
 * Definitions:
 *   - **MRR** is derived from PAID INVOICES, never from `plans.ts` price
 *     constants. `subscriptions` has no currency field (currency is picked by
 *     the admin at issue time and lives on the invoice), and the invoice is the
 *     record of what was actually charged — surviving custom amounts, the
 *     founding discount, and any future price change. Summed PER CURRENCY;
 *     blending MYR and SGD would be a fiction.
 *   - **Churn** is read off `past_due`, because manual billing v1 has no
 *     cancellation flow at all — nothing ever writes `status: "cancelled"`, so
 *     a seller who stops paying just sits at `past_due`. But `past_due` is
 *     reached four different ways and only ONE of them is churn; see
 *     `classifyPastDue`.
 *   - Order volume reuses `isRevenueOrder` so "revenue" means the same thing
 *     here as on /app/insights (see docs/insights.md).
 *
 * LOAD-BEARING INVARIANT — `updatedAt` as the lapse timestamp. The only writers
 * of a `subscriptions` row are `invoices.markPaid`, the backfill, and the three
 * cron flips; the first two always move the status AWAY from `past_due`, and
 * the cron's trial-reminder patch deliberately doesn't bump `updatedAt`. So for
 * a row CURRENTLY in `past_due`, `updatedAt` is exactly the moment it flipped,
 * which is what makes `lapsedThisWeek` computable with no schema change.
 * Anyone adding a fourth `db.patch` on `subscriptions` that touches
 * `updatedAt` silently breaks that figure.
 *
 * All windowing is MYT (UTC+8, no DST), reusing `todayMytMidnight` as the
 * day-flooring primitive exactly as `insights.ts` does.
 */

import { todayMytMidnight, ymdFromEpoch } from "./fulfilmentDate";
import { isRevenueOrder } from "./insights";
import { FOUNDING_MEMBER_LIMIT } from "./plans";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_DAYS = 7;

/** Average days per Gregorian month — used only to recover the billing cycle of
 * a legacy invoice that predates the `billingCycle` field. `issueInvoice` writes
 * spans of exactly 30 or 365 days (not calendar months), so a naive `/30` would
 * score an annual invoice as 12.17 months. */
const AVG_MONTH_DAYS = 30.4375;

/**
 * Ceiling on the cross-retailer weekly order scan. Deliberately lower than
 * Insights' 10k (`analytics.ts`): that cap is PER RETAILER, whereas this scan
 * shares one query's document-read budget with `retailers`, four subscription
 * reads, two invoice reads and `foundingMembers`. 5k is ~50x real platform-wide
 * weekly volume and leaves ample headroom.
 */
export const BUSINESS_REPORT_ORDER_SCAN_CAP = 5_000;

/** Widen the `_creationTime` index read slightly, then filter precisely on
 * `createdAt` in the reduce — same technique (and reason) as `analytics.ts`. */
export const CREATION_SKEW_BUFFER_MS = 2 * 60 * 1000;

/** Cap on how many store slugs each bucket names, so the payload stays small. */
export const MAX_SLUGS_PER_BUCKET = 20;

/**
 * Internal/test stores to keep out of every figure, matched as a substring of
 * the retailer's `notifyEmail`. A safety net BESIDE the `adminUserIds` check —
 * that predicate is the principled one (self-healing from the allowlist), but
 * it only catches stores whose owner is an allow-listed admin.
 *
 * NOTE the absence of an "unset email" rule. `notifyEmail` is optional and
 * independent of the Clerk auth email — unset simply means the retailer gets no
 * email notifications (see the schema comment) — so excluding those rows would
 * silently drop real paying retailers from MRR and GMV.
 */
export const EXCLUDED_EMAIL_FRAGMENTS = ["matrep88", "kristofer"] as const;

/** Explicit escape hatch for an internal store the two predicates above miss.
 * Add a slug here only after seeing it in the report's `excluded` audit. */
export const EXCLUDED_SLUGS: readonly string[] = [];

// --- Payload types ---------------------------------------------------------

/** Minor units (sen / cents) keyed by `invoices.currency`. Deliberately an open
 * `Record<string, …>`: `currency` is `v.string()` in the schema, so an
 * unexpected currency must surface as an odd line rather than be dropped. */
export type MoneyByCurrency = Record<string, number>;

export type ReportWindow = {
	/** MYT midnight, inclusive. */
	start: number;
	/** MYT midnight, exclusive — today's. */
	endExclusive: number;
	startYmd: string;
	/** The LAST day covered, not `endExclusive`'s day. */
	endYmd: string;
};

export type MrrSummary = {
	byCurrency: MoneyByCurrency;
	contributingCount: number;
	/** Active + non-comped subscriptions with no paid invoice ever. Surfaced
	 * rather than silently contributing 0, since it means either a comped-style
	 * store that was never invoiced or a billing gap worth chasing. */
	activeWithoutPaidInvoice: number;
};

/**
 * How a `past_due` subscription got there. The distinction is the whole point
 * of the report: three of these four are NOT lost customers.
 */
export type PastDueClass =
	/** Paid before, was invoiced, invoice went past its due date. Real churn. */
	| "lapsed_customer"
	/** Paid before, has a pending invoice not yet due. Healthy — inside grace. */
	| "awaiting_payment"
	/** Paid before, no pending invoice at all. The seller's period simply ran
	 * out and no renewal has been issued yet — an ACTION ITEM for Arif. */
	| "awaiting_invoice"
	/** Never had a paid invoice. A trial that lapsed, never a customer. */
	| "trial_expired";

export type PastDueBucket = {
	count: number;
	/** Monthly-equivalent of each row's LAST PAID invoice, per currency. */
	monthlyValueByCurrency: MoneyByCurrency;
	/** Store slugs so the report can name them. Capped at MAX_SLUGS_PER_BUCKET. */
	slugs: string[];
};

export type PastDueBreakdown = {
	/** Non-comped `past_due` rows — the sum of the four buckets. Note this is
	 * SMALLER than `SubscriptionCounts.pastDue`, which is the raw status count
	 * and includes comped rows. The invariant that reconciles them (pinned by
	 * test) is: `subscriptions.pastDue === total + compedExcluded`. */
	total: number;
	lapsedCustomer: PastDueBucket;
	awaitingPayment: PastDueBucket;
	awaitingInvoice: PastDueBucket;
	trialExpired: PastDueBucket;
	/** `lapsed_customer` rows whose flip (`updatedAt`) fell inside the window. */
	lapsedThisWeek: number;
	/** `past_due` rows skipped for being comped. Surfaced, not vanished — the
	 * cron's trial path flips comped rows too, unlike the other two paths. */
	compedExcluded: number;
};

export type SubscriptionCounts = {
	trialing: number;
	active: number;
	pastDue: number;
	/** Structurally 0 today — nothing writes `status: "cancelled"`. Reported
	 * anyway so the number starts moving on its own the day a cancellation flow
	 * ships, instead of needing a report change to notice. */
	cancelled: number;
	/** Comped rows across every status (they're counted in their status bucket
	 * too — this is an overlay, not a fifth status). */
	comped: number;
};

export type OrderVolume = {
	count: number;
	gmv: number;
	/** True when the scan hit its ceiling. Because the scan reads newest-first,
	 * a capped week under-reports its EARLIEST days — so a capped figure must
	 * not be published as the week's volume. */
	capped: boolean;
	scanCap: number;
};

export type FoundingSummary = {
	/** Slots taken, paid or not — a reservation is made at signup. */
	reserved: number;
	remaining: number;
	/** Reservations that actually converted (`paidAt` stamped). */
	paid: number;
};

export type BusinessReport = {
	generatedAt: number;
	window: ReportWindow;
	mrr: MrrSummary;
	subscriptions: SubscriptionCounts;
	pastDue: PastDueBreakdown;
	signupsThisWeek: number;
	founding: FoundingSummary;
	orders: OrderVolume;
	/** Which stores were held out, so the exclusion set is auditable rather than
	 * invisible — a wrongly-excluded real store would otherwise be undetectable. */
	excluded: { retailerCount: number; slugs: string[] };
};

// --- Input projections -----------------------------------------------------
// Narrow projections of the docs (the `InsightsOrderInput` pattern) so tests
// build fixtures without touching the schema.

export type ReportRetailerInput = {
	id: string;
	slug: string;
	userId: string;
	notifyEmail?: string;
	createdAt: number;
};

export type ReportSubscriptionInput = {
	retailerId: string;
	status: string;
	comped?: boolean;
	updatedAt: number;
};

export type ReportPaidInvoiceInput = {
	retailerId: string;
	total: number;
	currency: string;
	periodStart: number;
	periodEnd: number;
	billingCycle?: "monthly" | "annual";
	markedPaidAt?: number;
	createdAt: number;
};

export type ReportPendingInvoiceInput = {
	retailerId: string;
	dueDate: number;
};

export type ReportOrderInput = {
	retailerId: string;
	createdAt: number;
	status: string;
	total: number;
};

export type BusinessReportInput = {
	now: number;
	adminUserIds: readonly string[];
	retailers: readonly ReportRetailerInput[];
	subscriptions: readonly ReportSubscriptionInput[];
	paidInvoices: readonly ReportPaidInvoiceInput[];
	pendingInvoices: readonly ReportPendingInvoiceInput[];
	orders: readonly ReportOrderInput[];
	ordersCapped: boolean;
	founding: { reserved: number; paid: number };
};

// --- Window ----------------------------------------------------------------

/**
 * The 7-day MYT window a weekly report covers, ending at TODAY's MYT midnight
 * (exclusive) — so today itself is excluded.
 *
 * Excluding today is deliberate: the billing cron runs 03:30 UTC (11:30 MYT)
 * while the report fires 09:00 MYT, so a window ending at today's midnight
 * covers exactly the previous seven cron runs, with neither a gap nor an
 * overlap between consecutive weeks. It also matches the closed-range
 * discipline of `analytics.getInsightsRange`, which never references "now".
 */
export function mytWeekWindow(now: number): ReportWindow {
	const endExclusive = todayMytMidnight(now);
	const start = endExclusive - WEEK_DAYS * DAY_MS;
	return {
		start,
		endExclusive,
		startYmd: ymdFromEpoch(start),
		endYmd: ymdFromEpoch(endExclusive - DAY_MS),
	};
}

function isWithin(window: ReportWindow, epoch: number): boolean {
	return epoch >= window.start && epoch < window.endExclusive;
}

// --- Exclusions ------------------------------------------------------------

/** True when a retailer is an internal/test store that must not appear in any
 * figure. See `EXCLUDED_EMAIL_FRAGMENTS` for why "no email" is NOT a rule. */
export function isExcludedRetailer(
	retailer: ReportRetailerInput,
	adminUserIds: readonly string[],
): boolean {
	if (adminUserIds.includes(retailer.userId)) return true;
	if (EXCLUDED_SLUGS.includes(retailer.slug)) return true;
	const email = retailer.notifyEmail;
	if (email === undefined) return false;
	const lower = email.toLowerCase();
	return EXCLUDED_EMAIL_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

// --- Money -----------------------------------------------------------------

/** How many months an invoice's period covers. Falls back to measuring the
 * period for legacy rows issued before `billingCycle` existed. */
export function monthsInInvoicePeriod(invoice: ReportPaidInvoiceInput): number {
	if (invoice.billingCycle === "annual") return 12;
	if (invoice.billingCycle === "monthly") return 1;
	const spanDays = (invoice.periodEnd - invoice.periodStart) / DAY_MS;
	return Math.max(1, Math.round(spanDays / AVG_MONTH_DAYS));
}

/**
 * An invoice's contribution to MRR, in the invoice's own currency (minor units).
 * Rounds PER INVOICE rather than per total, so a figure in the report can be
 * reconciled by hand against a single invoice.
 */
export function monthlyEquivalent(invoice: ReportPaidInvoiceInput): number {
	return Math.round(invoice.total / monthsInInvoicePeriod(invoice));
}

/** The only place a currency bucket is written, so blending is structurally
 * impossible rather than merely avoided by convention. */
export function addMoney(
	acc: MoneyByCurrency,
	currency: string,
	amount: number,
): void {
	acc[currency] = (acc[currency] ?? 0) + amount;
}

// --- Invoice indexing (anti-N+1) -------------------------------------------

/** Most recent paid invoice per retailer, in ONE pass. Recency is `markedPaidAt`
 * (when the money landed), falling back to `createdAt` for rows predating it. */
export function latestPaidInvoiceByRetailer(
	invoices: readonly ReportPaidInvoiceInput[],
): Map<string, ReportPaidInvoiceInput> {
	const latest = new Map<string, ReportPaidInvoiceInput>();
	for (const invoice of invoices) {
		const current = latest.get(invoice.retailerId);
		if (
			current === undefined ||
			paidAtOf(invoice) > paidAtOf(current) ||
			// Deterministic tie-break so equal timestamps don't depend on scan order.
			(paidAtOf(invoice) === paidAtOf(current) &&
				invoice.periodEnd > current.periodEnd)
		) {
			latest.set(invoice.retailerId, invoice);
		}
	}
	return latest;
}

function paidAtOf(invoice: ReportPaidInvoiceInput): number {
	return invoice.markedPaidAt ?? invoice.createdAt;
}

/** Soonest-due pending invoice per retailer, in ONE pass. `issueInvoice`
 * guarantees at most one pending per retailer; "soonest wins" simply makes the
 * function total rather than relying on that. */
export function soonestPendingByRetailer(
	invoices: readonly ReportPendingInvoiceInput[],
): Map<string, ReportPendingInvoiceInput> {
	const soonest = new Map<string, ReportPendingInvoiceInput>();
	for (const invoice of invoices) {
		const current = soonest.get(invoice.retailerId);
		if (current === undefined || invoice.dueDate < current.dueDate) {
			soonest.set(invoice.retailerId, invoice);
		}
	}
	return soonest;
}

// --- The classifier --------------------------------------------------------

/**
 * Which kind of `past_due` this is. Callers MUST have already excluded comped
 * rows (the cron's trial path flips them too).
 *
 * The `awaiting_payment` case is not a nicety: `issueInvoice` deliberately does
 * not touch the subscription, and only `markPaid` moves `past_due → active`. So
 * the instant Arif issues the renewal for an `awaiting_invoice` store, the row
 * becomes `past_due` WITH a future-dated pending invoice. Without this case it
 * would be filed as churn — the report would manufacture a lost customer
 * precisely when the right thing was done.
 */
export function classifyPastDue(args: {
	hasPaidInvoice: boolean;
	pending?: ReportPendingInvoiceInput;
	now: number;
}): PastDueClass {
	if (!args.hasPaidInvoice) return "trial_expired";
	if (args.pending === undefined) return "awaiting_invoice";
	// `<` matches the cron's own overdue test, so the boundary day agrees with
	// the flip that produced this row.
	return args.pending.dueDate < args.now
		? "lapsed_customer"
		: "awaiting_payment";
}

// --- The reduce ------------------------------------------------------------

function emptyBucket(): PastDueBucket {
	return { count: 0, monthlyValueByCurrency: {}, slugs: [] };
}

function addToBucket(
	bucket: PastDueBucket,
	slug: string,
	lastPaid: ReportPaidInvoiceInput | undefined,
): void {
	bucket.count += 1;
	if (bucket.slugs.length < MAX_SLUGS_PER_BUCKET) bucket.slugs.push(slug);
	if (lastPaid !== undefined) {
		addMoney(
			bucket.monthlyValueByCurrency,
			lastPaid.currency,
			monthlyEquivalent(lastPaid),
		);
	}
}

export function reduceBusinessReport(
	input: BusinessReportInput,
): BusinessReport {
	const window = mytWeekWindow(input.now);

	// 1) Exclusions first — every later pass filters through this set.
	const excludedIds = new Set<string>();
	const excludedSlugs: string[] = [];
	const retailerById = new Map<string, ReportRetailerInput>();
	let signupsThisWeek = 0;
	for (const retailer of input.retailers) {
		retailerById.set(retailer.id, retailer);
		if (isExcludedRetailer(retailer, input.adminUserIds)) {
			excludedIds.add(retailer.id);
			excludedSlugs.push(retailer.slug);
			continue;
		}
		if (isWithin(window, retailer.createdAt)) signupsThisWeek += 1;
	}

	// 2) Invoice indexes, excluded retailers dropped before indexing.
	const latestPaid = latestPaidInvoiceByRetailer(
		input.paidInvoices.filter((i) => !excludedIds.has(i.retailerId)),
	);
	const soonestPending = soonestPendingByRetailer(
		input.pendingInvoices.filter((i) => !excludedIds.has(i.retailerId)),
	);

	// 3) One pass over subscriptions: status counts, MRR, past-due buckets.
	const counts: SubscriptionCounts = {
		trialing: 0,
		active: 0,
		pastDue: 0,
		cancelled: 0,
		comped: 0,
	};
	const mrr: MrrSummary = {
		byCurrency: {},
		contributingCount: 0,
		activeWithoutPaidInvoice: 0,
	};
	const pastDue: PastDueBreakdown = {
		total: 0,
		lapsedCustomer: emptyBucket(),
		awaitingPayment: emptyBucket(),
		awaitingInvoice: emptyBucket(),
		trialExpired: emptyBucket(),
		lapsedThisWeek: 0,
		compedExcluded: 0,
	};

	for (const sub of input.subscriptions) {
		if (excludedIds.has(sub.retailerId)) continue;
		const comped = sub.comped === true;
		if (comped) counts.comped += 1;

		if (sub.status === "trialing") counts.trialing += 1;
		else if (sub.status === "active") counts.active += 1;
		else if (sub.status === "past_due") counts.pastDue += 1;
		else if (sub.status === "cancelled") counts.cancelled += 1;

		const lastPaid = latestPaid.get(sub.retailerId);
		const slug = retailerById.get(sub.retailerId)?.slug ?? sub.retailerId;

		if (sub.status === "active") {
			// Comped is checked BEFORE the no-invoice counter: a comped store is
			// never charged, so it has no paid invoice by definition and would
			// otherwise inflate `activeWithoutPaidInvoice` every week.
			if (comped) continue;
			if (lastPaid === undefined) {
				mrr.activeWithoutPaidInvoice += 1;
			} else {
				addMoney(mrr.byCurrency, lastPaid.currency, monthlyEquivalent(lastPaid));
				mrr.contributingCount += 1;
			}
			continue;
		}

		if (sub.status !== "past_due") continue;
		if (comped) {
			pastDue.compedExcluded += 1;
			continue;
		}
		pastDue.total += 1;
		const klass = classifyPastDue({
			hasPaidInvoice: lastPaid !== undefined,
			pending: soonestPending.get(sub.retailerId),
			now: input.now,
		});
		if (klass === "lapsed_customer") {
			addToBucket(pastDue.lapsedCustomer, slug, lastPaid);
			if (isWithin(window, sub.updatedAt)) pastDue.lapsedThisWeek += 1;
		} else if (klass === "awaiting_payment") {
			addToBucket(pastDue.awaitingPayment, slug, lastPaid);
		} else if (klass === "awaiting_invoice") {
			addToBucket(pastDue.awaitingInvoice, slug, lastPaid);
		} else {
			addToBucket(pastDue.trialExpired, slug, lastPaid);
		}
	}

	// 4) One pass over orders.
	const orders: OrderVolume = {
		count: 0,
		gmv: 0,
		capped: input.ordersCapped,
		scanCap: BUSINESS_REPORT_ORDER_SCAN_CAP,
	};
	for (const order of input.orders) {
		if (excludedIds.has(order.retailerId)) continue;
		if (!isRevenueOrder(order.status)) continue;
		if (!isWithin(window, order.createdAt)) continue;
		orders.count += 1;
		orders.gmv += order.total;
	}

	return {
		generatedAt: input.now,
		window,
		mrr,
		subscriptions: counts,
		pastDue,
		signupsThisWeek,
		founding: {
			reserved: input.founding.reserved,
			remaining: Math.max(0, FOUNDING_MEMBER_LIMIT - input.founding.reserved),
			paid: input.founding.paid,
		},
		orders,
		excluded: {
			retailerCount: excludedIds.size,
			slugs: excludedSlugs.slice(0, MAX_SLUGS_PER_BUCKET),
		},
	};
}

// --- Endpoint secret -------------------------------------------------------

const encoder = new TextEncoder();

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Constant-time comparison of the report endpoint's shared secret.
 *
 * Both sides are DIGESTED first, unlike the signature verifiers elsewhere in
 * this codebase. Their `timingSafeEqual` is allowed to short-circuit on length
 * because an HMAC hex digest is fixed-length, so its length carries no secret.
 * That reasoning doesn't transfer here: both operands are the raw shared
 * secret, whose length IS secret. Hashing to fixed-length hex first restores
 * the precondition the short-circuit depends on.
 */
export async function reportSecretMatches(
	provided: string | null | undefined,
	expected: string,
): Promise<boolean> {
	if (!provided || !expected) return false;
	return timingSafeEqual(await sha256Hex(provided), await sha256Hex(expected));
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) {
		mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return mismatch === 0;
}
