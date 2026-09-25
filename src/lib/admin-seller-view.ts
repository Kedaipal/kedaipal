// The admin seller directory's view-model (z8r3fdh37c): every derived fact the
// table, the mobile cards, the detail sheet, the CSV and the "Copy summary"
// text share. Pure and covered by admin-seller-view.test.ts, so the four
// surfaces cannot disagree on what "expires" means for a given row.

import type { AdminSellerRow } from "../../convex/admin";
import { COMP_KIND_LABEL } from "../../convex/lib/comp";
import { csvDate, toCsv } from "../../convex/lib/orderCsv";
import { formatMobile, formatPrice, formatShortDate } from "./format";

const DAY_MS = 24 * 60 * 60 * 1000;

// --- Buckets: the status chips ------------------------------------------

/** One chip per bucket. `none` = a store with no subscription row at all
 * (pre-billing stores); it only shows a chip when the count is non-zero. */
export type SellerBucket =
	| "past_due"
	| "trialing"
	| "active"
	| "on_hold"
	| "cancelled"
	| "comped"
	| "admin"
	| "none";

export type SellerFilter = "all" | SellerBucket;

/** Chip order. Past due sits first after All — it is the urgent bucket, and
 * an urgent filter never sits last (CLAUDE.md, "own the structure"). */
export const SELLER_FILTERS: readonly SellerFilter[] = [
	"all",
	"past_due",
	"trialing",
	"active",
	"on_hold",
	"cancelled",
	"comped",
	"admin",
	"none",
];

export const SELLER_FILTER_LABEL: Record<SellerFilter, string> = {
	all: "All",
	past_due: "Past due",
	trialing: "Trialing",
	active: "Active",
	on_hold: "On hold",
	cancelled: "Cancelled",
	comped: "Comped",
	admin: "Admin",
	none: "No subscription",
};

export function isSellerFilter(value: unknown): value is SellerFilter {
	return (
		typeof value === "string" &&
		(SELLER_FILTERS as readonly string[]).includes(value)
	);
}

/** Which chip a row belongs to. Admin and comped outrank the raw status —
 * both are "never billed", so their subscription status is not the story. */
export function sellerBucket(row: AdminSellerRow): SellerBucket {
	if (row.ownerIsAdmin) return "admin";
	if (row.comped) return "comped";
	return row.subscriptionStatus ?? "none";
}

export function countSellerBuckets(
	rows: readonly AdminSellerRow[],
): Record<SellerFilter, number> {
	const counts: Record<SellerFilter, number> = {
		all: rows.length,
		past_due: 0,
		trialing: 0,
		active: 0,
		on_hold: 0,
		cancelled: 0,
		comped: 0,
		admin: 0,
		none: 0,
	};
	for (const row of rows) counts[sellerBucket(row)] += 1;
	return counts;
}

// --- Sort ---------------------------------------------------------------

export type SellerSort = "founding" | "expiry" | "newest" | "name";

export const SELLER_SORTS: ReadonlyArray<{ key: SellerSort; label: string }> = [
	{ key: "founding", label: "Founding rank" },
	{ key: "expiry", label: "Expiry · soonest first" },
	{ key: "newest", label: "Newest store" },
	{ key: "name", label: "Name A–Z" },
];

export function isSellerSort(value: unknown): value is SellerSort {
	return SELLER_SORTS.some((s) => s.key === value);
}

/** Founding Members first by rank, then newest — the server's own order,
 * kept as the default so the onboarding cohort still floats to the top. */
function compareFounding(a: AdminSellerRow, b: AdminSellerRow): number {
	const ra = a.foundingMemberRank;
	const rb = b.foundingMemberRank;
	if (ra !== undefined && rb !== undefined) return ra - rb;
	if (ra !== undefined) return -1;
	if (rb !== undefined) return 1;
	return b.createdAt - a.createdAt;
}

export function sortSellers(
	rows: readonly AdminSellerRow[],
	sort: SellerSort,
	now: number,
): AdminSellerRow[] {
	const sorted = [...rows];
	switch (sort) {
		case "founding":
			return sorted.sort(compareFounding);
		case "newest":
			return sorted.sort((a, b) => b.createdAt - a.createdAt);
		case "name":
			return sorted.sort((a, b) =>
				a.storeName.localeCompare(b.storeName, undefined, {
					sensitivity: "base",
				}),
			);
		case "expiry":
			// Rows with no date (admin, comped, no subscription) go last, then
			// by name so the order is stable across renders.
			return sorted.sort((a, b) => {
				const ea = sellerExpiry(a, now).at ?? Number.POSITIVE_INFINITY;
				const eb = sellerExpiry(b, now).at ?? Number.POSITIVE_INFINITY;
				if (ea !== eb) return ea - eb;
				return a.storeName.localeCompare(b.storeName);
			});
	}
}

// --- Search -------------------------------------------------------------

/** Name, slug, email, and both phones. A query with three or more digits is
 * also matched against the stored phone digits, so "0123" or "+60 12" finds
 * the number however it was typed. */
export function matchesSellerSearch(
	row: AdminSellerRow,
	query: string,
): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	const text = [row.storeName, row.slug, row.ownerEmail ?? ""]
		.join(" ")
		.toLowerCase();
	if (text.includes(needle)) return true;
	const digits = needle.replace(/\D/g, "");
	if (digits.length < 3) return false;
	return [row.waPhone, row.notifyWaPhone].some(
		(p) => p?.replace(/\D/g, "").includes(digits) === true,
	);
}

export function filterSellers(
	rows: readonly AdminSellerRow[],
	filter: SellerFilter,
	query: string,
): AdminSellerRow[] {
	return rows.filter(
		(row) =>
			(filter === "all" || sellerBucket(row) === filter) &&
			matchesSellerSearch(row, query),
	);
}

// --- Days ---------------------------------------------------------------

/** Whole days from `now` to `at`, rounded — a deadline at midnight read at
 * noon the week before says "in 6 days", not 5.5. */
export function daysFromNow(at: number, now: number): number {
	const raw = (at - now) / DAY_MS;
	// A FUTURE date rounds — "in 6 days" for 5.5 is what a person would say.
	// A PAST one must not: rounding up overstated how overdue a bill was, so a
	// 10-day-21-hour-old invoice read "11 days overdue" in this console while
	// the seller's own recovery email said "10 days past due" (z8r3fdg3mh) —
	// two Kedaipal surfaces disagreeing about one fact, with the calendar on
	// the email's side. Truncating toward now never claims a day that has not
	// finished. The existing tests only used whole-day offsets, which is why
	// this survived.
	return raw >= 0 ? Math.round(raw) : -Math.floor(-raw);
}

type PastWord = "ago" | "overdue" | "locked";

/** "in 6 days" / "today" / "19 days overdue". `pastWord` names what a date
 * in the past means for this row: an ordinary date is "ago", a bill is
 * "overdue", a comp-off lock is "locked". */
export function describeDays(
	at: number,
	now: number,
	pastWord: PastWord = "ago",
): string {
	const days = daysFromNow(at, now);
	if (days === 0) return "today";
	const unit = Math.abs(days) === 1 ? "day" : "days";
	if (days > 0) return `in ${days} ${unit}`;
	return `${-days} ${unit} ${pastWord}`;
}

// --- Expiry -------------------------------------------------------------

/** "14 Oct" this year, "2 Mar 2027" otherwise — a deadline in a narrow
 * column doesn't need the year it obviously has. The copy control beside it
 * still copies the full `formatShortDate`. */
export function formatDeadline(at: number, now: number): string {
	const d = new Date(at);
	const sameYear = d.getFullYear() === new Date(now).getFullYear();
	return d.toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		...(sameYear ? {} : { year: "numeric" }),
	});
}

export type ExpiryTone = "muted" | "warn" | "danger";

export interface SellerExpiry {
	/** "Renews 14 Oct 2026", "Trial ends 28 Sep 2026", "Was due 3 Sep 2026". */
	headline: string;
	/** "in 22 days", "19 days overdue", "Never billed". */
	detail: string;
	tone: ExpiryTone;
	/** The instant behind the headline, for sorting. Absent = no date. */
	at?: number;
}

/** Amber inside a week, red once it has passed. */
function toneForDeadline(at: number, now: number): ExpiryTone {
	const days = daysFromNow(at, now);
	if (days < 0) return "danger";
	if (days <= 7) return "warn";
	return "muted";
}

/**
 * What "expires" means for this row. The wording follows the state, because
 * one column labelled "Expiry" would be wrong for most rows: an active store
 * renews, a trial ends, a past-due store has a bill that was due.
 */
export function sellerExpiry(row: AdminSellerRow, now: number): SellerExpiry {
	if (row.ownerIsAdmin) {
		return { headline: "—", detail: "Never billed", tone: "muted" };
	}
	if (row.comped) {
		return {
			headline: "No expiry",
			detail: row.comp
				? `Comped since ${formatShortDate(row.comp.grantedAt)}`
				: "Comped",
			tone: "muted",
		};
	}
	switch (row.subscriptionStatus) {
		case undefined:
			return { headline: "—", detail: "No subscription", tone: "muted" };
		case "trialing": {
			// Free period over, first invoice out and unpaid: the bill's due
			// date is the deadline now, exactly like a renewal.
			if (row.pendingInvoice) {
				const at = row.pendingInvoice.dueDate;
				return {
					headline: `Invoice due ${formatDeadline(at, now)}`,
					detail: describeDays(at, now, "overdue"),
					tone: toneForDeadline(at, now),
					at,
				};
			}
			if (row.trialEndsAt !== undefined) {
				const at = row.trialEndsAt;
				return {
					headline: `Trial ends ${formatDeadline(at, now)}`,
					detail: describeDays(at, now),
					tone: toneForDeadline(at, now),
					at,
				};
			}
			return { headline: "Trial", detail: "No end date set", tone: "muted" };
		}
		case "active": {
			if (row.currentPeriodEnd === undefined) {
				return { headline: "Active", detail: "No period end", tone: "muted" };
			}
			const at = row.currentPeriodEnd;
			return {
				headline: `Renews ${formatDeadline(at, now)}`,
				detail: describeDays(at, now),
				tone: toneForDeadline(at, now),
				at,
			};
		}
		case "past_due": {
			// A bill to chase outranks the comp-off explanation: both can be
			// true, and only one of them has an invoice number.
			if (row.pendingInvoice) {
				const at = row.pendingInvoice.dueDate;
				return {
					headline: `Was due ${formatDeadline(at, now)}`,
					detail: describeDays(at, now, "overdue"),
					tone: "danger",
					at,
				};
			}
			if (row.compEnded) {
				const at = row.compEnded.at;
				return {
					headline: `Comp off ${formatDeadline(at, now)}`,
					detail: describeDays(at, now, "locked"),
					tone: "danger",
					at,
				};
			}
			return {
				headline: "Past due",
				detail: "No open invoice",
				tone: "danger",
			};
		}
		case "on_hold": {
			if (row.currentPeriodEnd === undefined) {
				return { headline: "On hold", detail: "No period end", tone: "muted" };
			}
			const at = row.currentPeriodEnd;
			return {
				headline: `Hold renews ${formatDeadline(at, now)}`,
				detail: describeDays(at, now),
				tone: toneForDeadline(at, now),
				at,
			};
		}
		case "cancelled": {
			if (row.cancelledAt === undefined) {
				return { headline: "Cancelled", detail: "", tone: "muted" };
			}
			const at = row.cancelledAt;
			return {
				headline: `Ended ${formatDeadline(at, now)}`,
				detail: describeDays(at, now),
				tone: "muted",
				at,
			};
		}
	}
}

// --- Status reason, plan, rail ------------------------------------------

/** Why the status is what it is, when the pill alone would leave the admin
 * guessing. Absent when the pill says it all. */
export function sellerReason(row: AdminSellerRow): string | undefined {
	if (row.ownerIsAdmin || row.comped) return undefined;
	const failed = row.autoRenew?.failedAttempts ?? 0;
	if (failed > 0) {
		const retry = row.autoRenew?.nextRetryAt;
		return retry !== undefined
			? `Auto-renew failed ×${failed} · retry ${formatShortDate(retry)}`
			: `Auto-renew failed ×${failed}`;
	}
	switch (row.subscriptionStatus) {
		case "past_due":
			if (row.pendingInvoice)
				return `${row.pendingInvoice.invoiceNumber} unpaid`;
			if (row.compEnded) return "Comp upgrade turned off";
			return undefined;
		case "trialing":
			if (row.pendingInvoice)
				return `${row.pendingInvoice.invoiceNumber} issued · free period ended`;
			return undefined;
		case "on_hold":
			return row.heldAt !== undefined
				? `Off-season since ${formatShortDate(row.heldAt)}`
				: undefined;
		default:
			return undefined;
	}
}

const PLAN_LABEL: Record<NonNullable<AdminSellerRow["plan"]>, string> = {
	starter: "Starter",
	pro: "Pro",
	scale: "Scale",
};

export function sellerPlanLabel(row: AdminSellerRow): string {
	if (row.ownerIsAdmin) return "—";
	return row.plan ? PLAN_LABEL[row.plan] : "—";
}

/** The billing rail under the plan: cycle, then how money arrives. */
export function sellerRail(row: AdminSellerRow): string {
	if (row.ownerIsAdmin) return "Admin store";
	if (row.comped) {
		if (!row.comp) return "Comped";
		const kind = COMP_KIND_LABEL[row.comp.kind];
		return row.comp.label ? `${kind} · ${row.comp.label}` : kind;
	}
	if (!row.subscriptionStatus) return "";
	const parts: string[] = [];
	if (row.billingCycle) {
		parts.push(row.billingCycle === "annual" ? "Annual" : "Monthly");
	}
	if (row.autoRenew) {
		parts.push(
			`auto-renew ${row.autoRenew.methodLabel ?? row.autoRenew.method}`,
		);
	} else if (row.pendingInvoice?.hasPayNowLink) {
		parts.push("Pay-now link");
	} else if (
		row.subscriptionStatus === "trialing" &&
		row.freePeriodEndedAt === undefined
	) {
		parts.push("free period");
	} else if (row.subscriptionStatus === "on_hold") {
		parts.push("held");
	} else if (row.subscriptionStatus !== "cancelled") {
		parts.push("manual billing");
	}
	return parts.join(" · ");
}

export const SELLER_STATUS_LABEL: Record<SellerBucket, string> = {
	past_due: "Past due",
	trialing: "Trialing",
	active: "Active",
	on_hold: "On hold",
	cancelled: "Cancelled",
	comped: "Comped",
	admin: "Admin",
	none: "No subscription",
};

// --- Copy summary + CSV -------------------------------------------------

/** The plain-text block "Copy summary" writes — what an admin pastes into a
 * WhatsApp message or a note. Absent facts say so rather than vanish. */
export function sellerSummaryText(
	row: AdminSellerRow,
	origin: string,
	now: number,
): string {
	const expiry = sellerExpiry(row, now);
	const plan = [sellerPlanLabel(row), sellerRail(row)]
		.filter((p) => p && p !== "—")
		.join(" · ");
	return [
		`${row.storeName} — ${origin}/${row.slug}`,
		`Email: ${row.ownerEmail ?? "none on file"}`,
		`WhatsApp: ${row.waPhone ? formatMobile(row.waPhone) : "none on file"}`,
		`Plan: ${plan || "—"} · ${SELLER_STATUS_LABEL[sellerBucket(row)]}`,
		`${expiry.headline}${expiry.detail ? ` · ${expiry.detail}` : ""}`,
	].join("\n");
}

const CSV_HEADER = [
	"Store",
	"Slug",
	"Storefront",
	"Status",
	"Reason",
	"Plan",
	"Billing",
	"Expiry",
	"Expiry date",
	"Email",
	"Store WhatsApp",
	"Alerts WhatsApp",
	"Country",
	"Currency",
	"Founding rank",
	"Open invoice",
	"Last paid",
	"Signup source",
	"Referrer",
	"Joined",
	"Last act-as",
];

function sellerToCsvRow(
	row: AdminSellerRow,
	origin: string,
	now: number,
): string[] {
	const expiry = sellerExpiry(row, now);
	return [
		row.storeName,
		row.slug,
		`${origin}/${row.slug}`,
		SELLER_STATUS_LABEL[sellerBucket(row)],
		sellerReason(row) ?? "",
		sellerPlanLabel(row),
		sellerRail(row),
		expiry.headline,
		csvDate(expiry.at),
		row.ownerEmail ?? "",
		row.waPhone ?? "",
		row.notifyWaPhone ?? "",
		row.country,
		row.currency,
		row.foundingMemberRank !== undefined ? String(row.foundingMemberRank) : "",
		row.pendingInvoice
			? `${row.pendingInvoice.invoiceNumber} ${formatPrice(row.pendingInvoice.total, row.pendingInvoice.currency)}`
			: "",
		row.lastPaidInvoice
			? `${row.lastPaidInvoice.invoiceNumber} ${formatPrice(row.lastPaidInvoice.total, row.lastPaidInvoice.currency)} ${csvDate(row.lastPaidInvoice.paidAt)}`
			: "",
		row.signupSource ?? "",
		row.signupReferrer ? `/${row.signupReferrer.slug}` : "",
		csvDate(row.createdAt),
		csvDate(row.lastActAsAt),
	];
}

/** The visible rows as a CSV document — every column the sheet shows. */
export function sellersToCsv(
	rows: readonly AdminSellerRow[],
	origin: string,
	now: number,
): string {
	return toCsv([
		CSV_HEADER,
		...rows.map((row) => sellerToCsvRow(row, origin, now)),
	]);
}
