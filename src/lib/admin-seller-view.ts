// The admin seller directory's view-model (z8r3fdh37c): every derived fact the
// table, the mobile cards, the detail sheet, the CSV and the "Copy summary"
// text share. Pure and covered by admin-seller-view.test.ts, so the four
// surfaces cannot disagree on what "expires" means for a given row.

import type { AdminSellerRow } from "../../convex/admin";
import { COMP_KIND_LABEL } from "../../convex/lib/comp";
import {
	compHighlightEligible,
	highlightSource,
} from "../../convex/lib/marketplaceListing";
import { csvDate, toCsv } from "../../convex/lib/orderCsv";
import { formatMobile, formatPrice, formatShortDate } from "./format";

const DAY_MS = 24 * 60 * 60 * 1000;

// --- Buckets: the status chips ------------------------------------------

/** One chip per bucket. `none` = a store with no subscription row at all
 * (pre-billing stores); it only shows a chip when the count is non-zero.
 * `unclaimed` = a pre-built store waiting for its vendor
 * (docs/prebuilt-stores.md) — a store, but not yet a seller. */
export type SellerBucket =
	| "unclaimed"
	| "past_due"
	| "trialing"
	| "active"
	| "on_hold"
	| "cancelled"
	| "comped"
	| "admin"
	| "none";

export type SellerFilter = "all" | SellerBucket | "wants_enterprise";

/** Chip order. Past due sits first after All — it is the urgent bucket, and
 * an urgent filter never sits last (CLAUDE.md, "own the structure"). Unclaimed
 * sits straight after it for the same reason: both are buckets where KEDAIPAL
 * owes someone an action (chase a payment, finish a handover), unlike the rest,
 * which describe a seller's own state. "Wants Enterprise" joins that front
 * group (z8r3fdkp8h follow-up): an open lead is money on the table, and the
 * whole point of stamping it is that it can't be forgotten at the back of a
 * chip row. Unlike the others it is NOT a bucket — a trialing store can want
 * Enterprise — so it filters on the lead stamp, orthogonal to status. */
export const SELLER_FILTERS: readonly SellerFilter[] = [
	"all",
	"past_due",
	"unclaimed",
	"wants_enterprise",
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
	unclaimed: "Unclaimed",
	trialing: "Trialing",
	active: "Active",
	on_hold: "On hold",
	cancelled: "Cancelled",
	comped: "Comped",
	admin: "Admin",
	none: "No subscription",
	wants_enterprise: "Wants Enterprise",
};

/** The empty state's noun for a filter — "No {noun}{ match …}". The chip
 * label lowercased works for the status buckets ("past due sellers") and
 * falls apart for the lead filter ("wants enterprise sellers"), so the
 * phrase is owned here beside the labels. */
export function sellerFilterEmptyNoun(filter: SellerFilter): string {
	if (filter === "wants_enterprise") return "open Enterprise asks";
	return `${SELLER_FILTER_LABEL[filter].toLowerCase()} sellers`;
}

export function isSellerFilter(value: unknown): value is SellerFilter {
	return (
		typeof value === "string" &&
		(SELLER_FILTERS as readonly string[]).includes(value)
	);
}

/** Which chip a row belongs to. Admin and comped outrank the raw status —
 * both are "never billed", so their subscription status is not the story.
 *
 * Unclaimed outranks BOTH, and must: a pre-built store runs on an `internal`
 * comp while it is being built, so filing it under "Comped" would hide every
 * half-finished handover inside the sponsored-deals bucket and show the admin
 * a store that reads as live. "Nobody owns this yet" is the only fact about it
 * that matters. */
export function sellerBucket(row: AdminSellerRow): SellerBucket {
	if (row.unclaimed) return "unclaimed";
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
		unclaimed: 0,
		trialing: 0,
		active: 0,
		on_hold: 0,
		cancelled: 0,
		comped: 0,
		admin: 0,
		none: 0,
		wants_enterprise: 0,
	};
	for (const row of rows) {
		counts[sellerBucket(row)] += 1;
		if (isEnterpriseLead(row)) counts.wants_enterprise += 1;
	}
	return counts;
}

/** An OPEN Enterprise lead: the owner asked and nobody has answered — no
 * contract attached, not dismissed. A store already on a contract never
 * counts, whatever stale stamp a row might carry. */
export function isEnterpriseLead(row: AdminSellerRow): boolean {
	return row.enterpriseInterestAt !== undefined && row.enterprise === undefined;
}

// --- Sort ---------------------------------------------------------------

export type SellerSort = "founding" | "expiry" | "credits" | "newest" | "name";

export const SELLER_SORTS: ReadonlyArray<{ key: SellerSort; label: string }> = [
	{ key: "founding", label: "Founding rank" },
	{ key: "expiry", label: "Expiry · soonest first" },
	// Credits T5: out-of-credits stores float to the top — a sort, not a
	// status chip, because "out of credits" crosses every status bucket (an
	// active store and a trialing one can both be at zero).
	{ key: "credits", label: "Credits · lowest first" },
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
		case "credits":
			// Lowest total first, so a store owing orders tops the list; stores
			// with no credit account yet go last, then by name.
			return sorted.sort((a, b) => {
				const ta = sellerCredits(a).total ?? Number.POSITIVE_INFINITY;
				const tb = sellerCredits(b).total ?? Number.POSITIVE_INFINITY;
				if (ta !== tb) return ta - tb;
				return a.storeName.localeCompare(b.storeName);
			});
	}
}

// --- Search -------------------------------------------------------------

/** Name, slug, email, the handover email, and both phones. A query with three
 * or more digits is also matched against the stored phone digits, so "0123" or
 * "+60 12" finds the number however it was typed.
 *
 * The HANDOVER email is searched as well as the owner's: a pre-built store has
 * no owner email at all, so searching the address an admin was given — the only
 * address that store has — has to find it. Without it, typing the vendor's email
 * would return nothing for exactly the store you are setting up for them. */
export function matchesSellerSearch(
	row: AdminSellerRow,
	query: string,
): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	const text = [
		row.storeName,
		row.slug,
		row.ownerEmail ?? "",
		row.pendingOwnerEmail ?? "",
	]
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
			(filter === "all"
				? true
				: filter === "wants_enterprise"
					? isEnterpriseLead(row)
					: sellerBucket(row) === filter) && matchesSellerSearch(row, query),
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
	// A pre-built store has no clock at all — the 14 days start at handover
	// (startFreePeriodOnClaim), so every date on its row would be about the
	// `internal` comp holding it, not about the vendor. Checked FIRST, before
	// the comped branch, which would otherwise print "No expiry · Comped since
	// 1 Oct" and read as a sponsored deal.
	if (row.unclaimed) {
		return {
			headline: "Not handed over",
			detail: row.pendingOwnerEmail
				? `Waiting for ${row.pendingOwnerEmail}`
				: "No handover email yet",
			// Amber without one: a store built and then left with nobody named to
			// claim it is unfinished work, and the directory should look it.
			tone: row.pendingOwnerEmail ? "muted" : "warn",
		};
	}
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
	if (row.unclaimed)
		return row.pendingOwnerEmail
			? "Built by us · waiting to be claimed"
			: "Built by us · set a handover email";
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
	enterprise: "Enterprise",
};

// --- Store highlights (z8r3fdkmyp) ----------------------------------------

/**
 * Where a store stands on the marketplace's "Store highlights" rail, for the
 * pill, the Manage item, the dialog and the sheet — one mapping of the admin
 * row onto the shared `highlightSource`, so the console can never disagree
 * with the buyer page. Internal stores are never listed, so never highlighted.
 */
export function sellerHighlight(
	row: AdminSellerRow,
	now: number,
): { source: "paid" | "comp" | null; compEligible: boolean } {
	if (row.marketplace.internal) return { source: null, compEligible: false };
	return {
		source: highlightSource(
			{
				sponsoredUntil: row.marketplace.sponsoredUntil,
				comped: row.comped,
				compKind: row.comp?.kind,
				compHighlightOffAt: row.marketplace.compHighlightOffAt,
			},
			now,
		),
		compEligible: compHighlightEligible(row.comped, row.comp?.kind),
	};
}

/** The last day a stored paid-window `until` covers — what every surface
 * names (the stored value is the NEXT midnight). */
export function highlightedThroughLabel(until: number): string {
	return formatShortDate(until - 1);
}

/** Team seats, one spelling for every surface (86exr91r4): people with
 * access over the plan's people-cap, pending invites appended.
 * "2/3 · 1 invited", "1/∞" for comped/admin stores. */
/**
 * The seat VALUE, for the three surfaces that print it under a "Seats" label
 * (the table column, the sheet row, the CSV, the copy summary). A bare ratio
 * there; prose belongs to `sellerSeatsPhrase`.
 *
 * A pre-built store has no owner and no team, so a ratio would be a count of
 * nobody — "0/3" is true and still reads like a store that LOST its people
 * rather than one that hasn't got them yet.
 *
 * SHORT, because this value lands in a column sized for "1/3" — "No team yet"
 * wrapped to THREE lines in the table (seen 2 Oct). Under a "Seats" header the
 * noun is already supplied, so "None" says the whole thing. The card, which
 * inlines it with no header, keeps the longer phrase below.
 */
export function sellerSeatsLabel(row: AdminSellerRow): string {
	if (row.unclaimed) return "None";
	const cap = row.seats.capUnlimited ? "∞" : String(row.seats.cap);
	const base = `${row.seats.active}/${cap}`;
	return row.seats.invited > 0
		? `${base} · ${row.seats.invited} invited`
		: base;
}

/**
 * The seat phrase for the mobile card, which inlines it in a sentence rather
 * than under a label — "1/3 seats", but "No team yet" on its own, because a
 * bare "None" mid-sentence leaves the reader asking "none of what?".
 *
 * Its own function because the card used to append the noun to whatever
 * `sellerSeatsLabel` returned, which read "No one yet seats" the moment the
 * value stopped being a ratio. A caller that must not append cannot be trusted
 * to remember not to; give it a value it never has to finish.
 */
export function sellerSeatsPhrase(row: AdminSellerRow): string {
	return row.unclaimed ? "No team yet" : `${sellerSeatsLabel(row)} seats`;
}

/**
 * The Manage menu's comp item — its title, its subtitle, and whether the icon
 * should read as a live sponsorship.
 *
 * Here rather than inline in the menu because it is the same kind of derived
 * fact as `sellerRail` and `sellerReason`: a sentence about a row that has to
 * be right, and that a test can hold. The case it exists for is the one the
 * menu got wrong — a PRE-BUILT store is always comped (the `internal` comp
 * keeps it unbilled while an admin builds it), so the ordinary comped copy
 * called that scaffolding a "sponsorship" and offered to turn it off.
 *
 * A REAL comp on an unclaimed store is NOT scaffolding: an admin pre-comping a
 * partner ahead of handover is supported, and that comp survives the claim, so
 * it keeps the ordinary copy.
 */
export function sellerCompMenuItem(row: AdminSellerRow): {
	title: string;
	hint: string;
	/** Violet (a live sponsorship) vs muted (setup, or nothing yet). */
	sponsored: boolean;
} {
	const setup = row.unclaimed && row.comp?.kind === "internal";
	if (row.ownerIsAdmin) {
		return {
			title: row.comped ? "Comp upgrade — on" : "Turn on comp upgrade",
			hint: "Admin store — always free already",
			sponsored: false,
		};
	}
	// A contract store is never comped too (T6) — `setComp` refuses it, and the
	// menu disables the item, so this subtitle is where the refusal is SAID.
	if (row.enterprise !== undefined) {
		return {
			title: "Turn on comp upgrade",
			hint: "On an Enterprise contract — move it to Pro first",
			sponsored: false,
		};
	}
	if (setup) {
		return {
			title: "Comp upgrade — setup only",
			hint: "Keeps this store unbilled while you build it, and ends when they claim it. Set a partner or sponsor comp here if the deal has one.",
			sponsored: false,
		};
	}
	if (row.comped) {
		return {
			title: "Comp upgrade — on",
			hint: "Edit the sponsorship or turn it off",
			sponsored: true,
		};
	}
	return {
		title: "Turn on comp upgrade",
		hint: "Every feature, no limits, never billed",
		sponsored: false,
	};
}

export function sellerPlanLabel(row: AdminSellerRow): string {
	if (row.ownerIsAdmin) return "—";
	return row.plan ? PLAN_LABEL[row.plan] : "—";
}

/** The billing rail under the plan: cycle, then how money arrives. */
export function sellerRail(row: AdminSellerRow): string {
	// Nothing bills an unclaimed store, so naming a rail ("free period",
	// "manual billing") would describe money that cannot move.
	if (row.unclaimed) return "Not billed until claimed";
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

// --- Credits (Kedaipal Credits T5) --------------------------------------

export type CreditsTone = "normal" | "out" | "muted";

export interface SellerCredits {
	/** "130 left", "0 left", "15 owed" — "—" with no account. */
	headline: string;
	/** "plan 80 · bought 50", plus the custom grant when one is set. */
	detail: string;
	tone: CreditsTone;
	/** The total is at or below zero — the fact the seller lock keys off
	 * (T3). Comped and admin stores can be out and are still never locked. */
	out: boolean;
	/** When the total reached zero (`exhaustedAt`) — "out since". */
	outSince?: number;
	/** An admin's custom monthly grant, when set. */
	customGrant?: number;
	/** plan + purchased, for sorting. Absent = no credit account yet. */
	total?: number;
}

/** A store's credits in one reading, shared by the table, the phone cards,
 * the sheet, the CSV and the copy-summary so they can't disagree. */
export function sellerCredits(row: AdminSellerRow): SellerCredits {
	const c = row.credits;
	if (!c)
		return {
			headline: "—",
			detail: "No credit account yet",
			tone: "muted",
			out: false,
		};
	const total = c.plan + c.purchased;
	const out = total <= 0;
	const neverLocked = row.ownerIsAdmin || row.comped;
	const detail = [
		`plan ${c.plan}`,
		`bought ${c.purchased}`,
		...(c.customGrant !== undefined ? [`custom ${c.customGrant}/mo`] : []),
		...(out && neverLocked ? ["never locked"] : []),
	].join(" · ");
	return {
		headline: total < 0 ? `${-total} owed` : `${total} left`,
		detail,
		tone: out ? (neverLocked ? "muted" : "out") : "normal",
		out,
		outSince: out ? c.exhaustedAt : undefined,
		customGrant: c.customGrant,
		total,
	};
}

export const SELLER_STATUS_LABEL: Record<SellerBucket, string> = {
	unclaimed: "Unclaimed",
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
		// An unclaimed store has no owner email; printing "none on file" would
		// read as a seller who deleted theirs, so it says what is actually true.
		row.unclaimed
			? `Owner: unclaimed${row.pendingOwnerEmail ? ` · waiting for ${row.pendingOwnerEmail}` : " · no handover email yet"}`
			: `Email: ${row.ownerEmail ?? "none on file"}`,
		`WhatsApp: ${row.waPhone ? formatMobile(row.waPhone) : "none on file"}`,
		`Plan: ${plan || "—"} · ${SELLER_STATUS_LABEL[sellerBucket(row)]}`,
		`Seats: ${sellerSeatsLabel(row)}`,
		`Credits: ${creditsSummary(row)}`,
		`${expiry.headline}${expiry.detail ? ` · ${expiry.detail}` : ""}`,
	].join("\n");
}

/** "130 left (plan 80 · bought 50)", "15 owed (…) · out since 3 Oct 2026". */
function creditsSummary(row: AdminSellerRow): string {
	const credits = sellerCredits(row);
	if (credits.total === undefined) return credits.detail;
	const since =
		credits.outSince !== undefined
			? ` · out since ${formatShortDate(credits.outSince)}`
			: "";
	return `${credits.headline} (${credits.detail})${since}`;
}

const CSV_HEADER = [
	"Store",
	"Slug",
	"Storefront",
	"Status",
	"Reason",
	"Plan",
	"Billing",
	"Seats",
	"Credits left",
	"Plan credits",
	"Bought credits",
	"Out of credits since",
	"Custom grant",
	"Expiry",
	"Expiry date",
	"Email",
	"Handover email",
	"Claimed",
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
	const credits = sellerCredits(row);
	return [
		row.storeName,
		row.slug,
		`${origin}/${row.slug}`,
		SELLER_STATUS_LABEL[sellerBucket(row)],
		sellerReason(row) ?? "",
		sellerPlanLabel(row),
		sellerRail(row),
		sellerSeatsLabel(row),
		credits.total !== undefined ? String(credits.total) : "",
		row.credits ? String(row.credits.plan) : "",
		row.credits ? String(row.credits.purchased) : "",
		csvDate(credits.outSince),
		credits.customGrant !== undefined ? String(credits.customGrant) : "",
		expiry.headline,
		csvDate(expiry.at),
		row.ownerEmail ?? "",
		row.pendingOwnerEmail ?? "",
		csvDate(row.claimedAt),
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
