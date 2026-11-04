// Admin · Sellers — the paginated seller directory (4 Nov 2026). Before this
// the page read `admin.listSellersForAdmin`: the newest 500 stores as full
// rows in one call (~10 index reads each), then searched, filtered, sorted and
// counted them in the browser, so past the cap the oldest stores simply
// vanished (z8r3fdpm2p). Now:
//
// - `listSellersPage` is ONE cursor `.paginate()` per call on an index order
//   (creation desc, or `by_storeNameKey` for Name A–Z), with the Status filter
//   and the substring search applied server-side to each raw page BEFORE the
//   full row is built — a cheap predicate (retailer doc + one subscription
//   read, plus one probe for two filters) decides, and only survivors pay the
//   row's reads. Pages may therefore come back SHORT or empty with
//   `isDone: false`; `usePaginatedQuery` derives its status from `isDone`
//   alone, so the client's infinite scroll simply asks again. When a filter or
//   search is on, the raw window is wider than the client asked for so sparse
//   pages don't chain forever. The raw result's cursors travel through
//   untouched: a cursor is a position in the raw index range, never in the
//   filtered output.
// - The default "Founding rank" sort pins the founders (a bounded index read on
//   `by_foundingRank`) to the FIRST page only, then pages everyone else newest
//   first, dropping founders from those pages so none repeats. Page splits
//   keep this right: the first half of a split keeps `cursor: null`.
// - `countSellerBuckets` feeds the Status menu's numbers from the whole book in
//   one bounded scan (`ADMIN_COUNT_SCAN_LIMIT`), and says so when capped.
//
// - `listPickerStores` is the showcase store picker's read: one country's
//   stores as SLIM rows (name, slug, three listing flags) A–Z, over the same
//   bounded scan the counts use. The picker used to read the whole-book
//   `admin.listSellersForAdmin` (retired 4 Nov 2026) and filter by country in
//   the browser — ten reads per row for four fields it drew.
//
// Every directory row is still the same `AdminSellerRow` the table, cards,
// sheet and CSV already render; `buildAdminSellerRow` is its one author.
// Every function is `requireAdmin`-gated. See docs/admin-console.md.

import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type QueryCtx, query } from "./_generated/server";
import { loadCreditAccount } from "./credits";
import { ADMIN_COUNT_SCAN_LIMIT, storeNameKeyOf } from "./lib/adminDirectory";
import {
	DEFAULT_SELLER_SORT,
	emptySellerBucketCounts,
	matchesSellerSearch,
	passesAnySellerFilter,
	passesSellerFilter,
	type SellerBucketCounts,
	type SellerFacts,
	type SellerStatusFilter,
	tallySellerFacts,
} from "./lib/adminSellerFilters";
import type { AdminSellerRow } from "./lib/adminSellerRow";
import { adminUserIds, requireAdmin } from "./lib/auth";
import {
	countryValidator,
	DEFAULT_COUNTRY,
	storeCurrencyOf,
} from "./lib/country";
import { contractForAdmin } from "./lib/enterprise";
import { suggestChannel } from "./lib/metrics";
import { isUnlimited, storeBillingCurrency } from "./lib/plans";
import { resolveStoreAvailability } from "./lib/storeAvailability";
import { isUnclaimed } from "./lib/unclaimedStore";
import { storeIsInternal } from "./marketplace";
import { referralForReferee } from "./referrals";
import { loadSubscription, resolveAccess } from "./subscriptions";

/** The page the client asks for is 25; when a filter or a search is on, the
 * server scans this many RAW stores per call instead, because a sparse filter
 * over 25 raw rows would hand back empty page after empty page. Kept under
 * `2 × initialNumItems` survivors on a dense filter so `usePaginatedQuery`
 * rarely has to split a page. */
export type { AdminSellerRow } from "./lib/adminSellerRow";

const FILTER_RAW_PAGE = 60;
/** Search is sparser still and costs no reads per scanned row. */
const SEARCH_RAW_PAGE = 120;
/** The founding cohort is ~10; this is a safety bound, not a page size. */
const FOUNDING_HEAD_CAP = 200;

const sellerSortValidator = v.union(
	v.literal("founding"),
	v.literal("newest"),
	v.literal("name"),
);
/** A STATUS, never "all": the query takes a list, and an empty list is All.
 * The statuses combine with OR (z8r3fdzn6r). */
const sellerStatusFilterValidator = v.union(
	v.literal("past_due"),
	v.literal("unclaimed"),
	v.literal("wants_enterprise"),
	v.literal("unavailable"),
	v.literal("untagged_payers"),
	v.literal("trialing"),
	v.literal("active"),
	v.literal("on_hold"),
	v.literal("cancelled"),
	v.literal("comped"),
	v.literal("admin"),
	v.literal("none"),
);

/** The two per-store invoice facts the directory shows: the open bill and the
 * last settled one. Both are index reads that stop at the first hit — never a
 * collect over a store's whole billing history. */
async function loadInvoiceFacts(
	ctx: QueryCtx,
	retailerId: Id<"retailers">,
	fallback: { plan: Doc<"subscriptions">["plan"]; billingCycle: Doc<"subscriptions">["billingCycle"] },
): Promise<
	Pick<AdminSellerRow, "pendingInvoice" | "lastPaidInvoice"> & {
		/** Any bill has been paid, stamp or no stamp — what
		 * `referralEditable` reads. */
		hasPaidInvoice: boolean;
	}
> {
	const pending = await ctx.db
		.query("invoices")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
		.order("desc")
		.filter((q) => q.eq(q.field("status"), "pending"))
		.first();
	const paid = await ctx.db
		.query("invoices")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
		.order("desc")
		.filter((q) => q.eq(q.field("status"), "paid"))
		.first();
	return {
		...(pending
			? {
					pendingInvoice: {
						invoiceNumber: pending.invoiceNumber,
						dueDate: pending.dueDate,
						total: pending.total,
						currency: pending.currency,
						hasPayNowLink: pending.gatewayPayment !== undefined,
						plan: pending.plan ?? fallback.plan,
						billingCycle: pending.billingCycle ?? fallback.billingCycle,
						kind: pending.kind ?? "plan",
					},
				}
			: {}),
		...(paid?.markedPaidAt !== undefined
			? {
					lastPaidInvoice: {
						invoiceNumber: paid.invoiceNumber,
						paidAt: paid.markedPaidAt,
						total: paid.total,
						currency: paid.currency,
					},
				}
			: {}),
		hasPaidInvoice: paid !== null,
	};
}

/** The last time an admin entered this store (read-side trail). */
async function loadLastActAs(
	ctx: QueryCtx,
	retailerId: Id<"retailers">,
): Promise<number | undefined> {
	const row = await ctx.db
		.query("adminAuditLog")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
		.order("desc")
		.filter((q) => q.eq(q.field("action"), "actAs.sessionStart"))
		.first();
	return row?.ts;
}

/** What every row build shares: the admin allowlist (one env read) and the
 * small availability table, collected once per call rather than once per
 * store. */
type SellerRowDeps = {
	adminIds: Set<string>;
	availability: Map<string, Doc<"storeAvailability">>;
};

async function sellerRowDeps(ctx: QueryCtx): Promise<SellerRowDeps> {
	return {
		adminIds: new Set(adminUserIds()),
		availability: new Map(
			(await ctx.db.query("storeAvailability").collect()).map((a) => [
				a.retailerId as string,
				a,
			]),
		),
	};
}

/** Any bill ever paid — one index read that stops at the first hit. The same
 * question `loadInvoiceFacts` answers inside a full row; asked on its own here
 * so the `untagged_payers` filter can decide before paying for the row. */
async function hasPaidInvoiceFor(
	ctx: QueryCtx,
	retailerId: Id<"retailers">,
): Promise<boolean> {
	const paid = await ctx.db
		.query("invoices")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
		.order("desc")
		.filter((q) => q.eq(q.field("status"), "paid"))
		.first();
	return paid !== null;
}

/**
 * The filter facts for one store at the lowest read cost that still answers
 * the selection: the retailer doc, one subscription read, the availability
 * row only when `unavailable` is picked, and the paid-invoice probe only when
 * `untagged_payers` is picked AND no other picked status has already let the
 * store through AND the free checks haven't ruled it out. An empty selection
 * is "All", needs nothing and returns `null`.
 */
async function cheapSellerFacts(
	ctx: QueryCtx,
	r: Doc<"retailers">,
	filters: readonly SellerStatusFilter[],
	deps: SellerRowDeps,
): Promise<{ facts: SellerFacts; sub: Doc<"subscriptions"> | null } | null> {
	if (filters.length === 0) return null;
	const sub = await loadSubscription(ctx, r._id);
	const ownerIsAdmin = deps.adminIds.has(r.userId);
	const free: SellerFacts = {
		unclaimed: isUnclaimed(r),
		ownerIsAdmin,
		comped: sub?.comped === true,
		subscriptionStatus: sub?.status,
		enterpriseInterestAt: r.enterpriseInterestAt,
		hasEnterpriseContract: sub?.enterprise !== undefined,
		availabilityState: filters.includes("unavailable")
			? resolveStoreAvailability({
					holdPausedAt: r.orderingPausedAt,
					row: deps.availability.get(r._id),
				}).state
			: "open",
		hasPaidInvoice: false,
		acquisitionSetBy: r.acquisitionSetBy,
	};
	// The one read that costs: skipped when another picked status already
	// admits the store (an OR needs one yes), and when the free facts alone
	// rule an untagged payer out.
	const others = filters.filter((f) => f !== "untagged_payers");
	const probePaid =
		filters.includes("untagged_payers") &&
		!ownerIsAdmin &&
		r.acquisitionSetBy !== "admin" &&
		!others.some((f) => passesSellerFilter(free, f));
	return {
		sub,
		facts: probePaid
			? { ...free, hasPaidInvoice: await hasPaidInvoiceFor(ctx, r._id) }
			: free,
	};
}

/** Every fact, for the counts: the same reads `cheapSellerFacts` would make
 * across all filters at once — subscription, availability (already in hand),
 * and the paid probe for stores that could be untagged payers. */
async function fullSellerFacts(
	ctx: QueryCtx,
	r: Doc<"retailers">,
	deps: SellerRowDeps,
): Promise<SellerFacts> {
	const sub = await loadSubscription(ctx, r._id);
	const ownerIsAdmin = deps.adminIds.has(r.userId);
	const probePaid = !ownerIsAdmin && r.acquisitionSetBy !== "admin";
	return {
		unclaimed: isUnclaimed(r),
		ownerIsAdmin,
		comped: sub?.comped === true,
		subscriptionStatus: sub?.status,
		enterpriseInterestAt: r.enterpriseInterestAt,
		hasEnterpriseContract: sub?.enterprise !== undefined,
		availabilityState: resolveStoreAvailability({
			holdPausedAt: r.orderingPausedAt,
			row: deps.availability.get(r._id),
		}).state,
		hasPaidInvoice: probePaid ? await hasPaidInvoiceFor(ctx, r._id) : false,
		acquisitionSetBy: r.acquisitionSetBy,
	};
}

/** The fields the search reads — all on the retailer doc, zero extra reads. */
function searchFieldsOf(r: Doc<"retailers">) {
	return {
		storeName: r.storeName,
		slug: r.slug,
		emails: [r.notifyEmail, r.pendingOwnerEmail],
		phones: [r.waPhone, r.notifyWaPhone],
	};
}

/**
 * One store's directory row — the ONE author of `AdminSellerRow`, shared by the
 * paginated page and the legacy full list. Pass `sub` when the caller already
 * loaded it (the cheap filter did), so it isn't read twice.
 */
export async function buildAdminSellerRow(
	ctx: QueryCtx,
	r: Doc<"retailers">,
	deps: SellerRowDeps,
	subIn?: Doc<"subscriptions"> | null,
): Promise<AdminSellerRow> {
	const adminIds = deps.adminIds;
	const availabilityRow = deps.availability.get(r._id);
	const sub = subIn === undefined ? await loadSubscription(ctx, r._id) : subIn;
	// Dangling once the referrer is purged (no referential integrity) —
	// a missing doc simply reads as "no referrer".
	const referrer = r.signupReferrerId
		? await ctx.db.get(r.signupReferrerId)
		: null;
	const { hasPaidInvoice, ...invoiceFacts } = await loadInvoiceFacts(
		ctx,
		r._id,
		{ plan: sub?.plan ?? "pro", billingCycle: sub?.billingCycle ?? "monthly" },
	);
	const lastActAsAt = await loadLastActAs(ctx, r._id);
	// One index read per store (`by_referee`); the referrer's doc only
	// when there is a referral.
	const referral = await referralForReferee(ctx, r._id);
	const referralReferrer = referral
		? await ctx.db.get(referral.referrerId)
		: null;
	// One index read per store (`by_retailer`), the cached balances only.
	const creditAccount = await loadCreditAccount(ctx, r._id);
	// Seats (86exr91r4) — two short index reads per store; cap through
	// resolveAccess so comped stores read as unlimited here too.
	const activeMembers = await ctx.db
		.query("retailerMembers")
		.withIndex("by_retailer_status", (q) =>
			q.eq("retailerId", r._id).eq("status", "active"),
		)
		.collect();
	const invitedMembers = await ctx.db
		.query("retailerMembers")
		.withIndex("by_retailer_status", (q) =>
			q.eq("retailerId", r._id).eq("status", "invited"),
		)
		.collect();
	const seatCap = resolveAccess(sub, {
		adminFullAccess: adminIds.has(r.userId),
	}).caps.userCap;
	const country = r.country ?? DEFAULT_COUNTRY;
	return {
		_id: r._id,
		storeName: r.storeName,
		slug: r.slug,
		ownerUserId: r.userId,
		ownerIsAdmin: adminIds.has(r.userId),
		seats: {
			// The `1` is the OWNER. A pre-built store has none, so counting
			// one renders "1/3 seats" against a store with nobody in it —
			// spotted by rendering the card, not by reading the code.
			active: (isUnclaimed(r) ? 0 : 1) + activeMembers.length,
			cap: seatCap,
			capUnlimited: isUnlimited(seatCap),
			invited: invitedMembers.length,
		},
		isFoundingMember: r.isFoundingMember === true,
		foundingIntent: sub?.foundingIntent === true,
		foundingMemberRank: r.foundingMemberRank,
		subscriptionStatus: sub?.status,
		plan: sub?.plan,
		// The WHOLE deal minus `setBy` — allowances included. They were
		// once hand-listed here and the day they were left out,
		// reopening a contract showed them blank: a fee typo-fix away
		// from silently resetting a deal to unlimited seats (found
		// hands-on, 2 Oct). `contractForAdmin` is a rest spread, so no
		// future field can be dropped the same way; the admin.test.ts
		// pin stays as the second guard.
		enterprise: sub?.enterprise
			? contractForAdmin(sub.enterprise)
			: undefined,
		pendingPlanChange: sub?.pendingPlanChange,
		enterpriseInterestAt: r.enterpriseInterestAt,
		comped: sub?.comped === true,
		comp: sub?.comp
			? {
					kind: sub.comp.kind,
					label: sub.comp.label,
					note: sub.comp.note,
					grantedAt: sub.comp.grantedAt,
				}
			: undefined,
		compEnded:
			sub?.compEndedAt !== undefined ? { at: sub.compEndedAt } : undefined,
		signupSource: r.signupSource,
		...(referrer
			? {
					signupReferrer: {
						slug: referrer.slug,
						storeName: referrer.storeName,
					},
				}
			: {}),
		...(referral
			? {
					referral: {
						referrer: referralReferrer
							? {
									slug: referralReferrer.slug,
									storeName: referralReferrer.storeName,
								}
							: null,
						via: referral.via,
						at: referral.createdAt,
						...(referral.rewardedAt !== undefined
							? {
									reward: {
										refereeCredits: referral.refereeCredits ?? 0,
										referrerCredits: referral.referrerCredits,
										referrerOutcome: referral.referrerOutcome ?? "granted",
									},
								}
							: {}),
					},
				}
			: {}),
		// Any paid invoice means the first plan invoice is paid (a hold
		// bill only ever follows one) — the same answer
		// `referrals.hasPaidPlanInvoice` gives the mutations that
		// enforce it.
		referralEditable: !hasPaidInvoice,
		hasPaidInvoice,
		acquisition: {
			...(r.acquisitionSource !== undefined
				? {
						channel: r.acquisitionSource,
						setBy: r.acquisitionSetBy ?? "admin",
						...(r.acquisitionNote !== undefined
							? { note: r.acquisitionNote }
							: {}),
						...(r.acquisitionSetAt !== undefined
							? { at: r.acquisitionSetAt }
							: {}),
					}
				: {}),
			suggested: suggestChannel({
				signupSource: r.signupSource,
				hasReferral: referral !== null,
			}),
		},
		createdAt: r._creationTime,
		unclaimed: isUnclaimed(r),
		pendingOwnerEmail: r.pendingOwnerEmail,
		handoverInviteSentAt: r.handoverInviteSentAt,
		claimedAt: r.claimedAt,
		purging: r.purgeStartedAt !== undefined,
		availability: resolveStoreAvailability({
			holdPausedAt: r.orderingPausedAt,
			row: availabilityRow,
		}),
		adminAvailability:
			availabilityRow?.adminMode !== undefined
				? {
						mode: availabilityRow.adminMode,
						note: availabilityRow.adminNote,
						at: availabilityRow.adminAt,
					}
				: undefined,
		sellerPaused: availabilityRow?.sellerPausedAt !== undefined || undefined,
		marketplace: {
			unlistedAt: r.marketplaceUnlistedAt,
			sponsoredUntil: r.marketplaceSponsoredUntil,
			compHighlightOffAt: r.marketplaceCompHighlightOffAt,
			hidden: r.marketplaceHidden,
			internal: storeIsInternal(r, sub, adminUserIds()),
		},
		ownerEmail: r.notifyEmail,
		waPhone: r.waPhone,
		notifyWaPhone: r.notifyWaPhone,
		country,
		currency: storeCurrencyOf(r),
		billingCycle: sub?.billingCycle,
		trialEndsAt: sub?.trialEndsAt,
		freePeriodEndedAt: sub?.freePeriodEndedAt,
		freePeriodEndReason: sub?.freePeriodEndReason,
		currentPeriodEnd: sub?.currentPeriodEnd,
		cancelledAt: sub?.cancelledAt,
		heldAt: sub?.heldAt,
		autoRenew: sub?.autoRenew
			? {
					method: sub.autoRenew.method,
					methodLabel: sub.autoRenew.methodLabel,
					attachedAt: sub.autoRenew.attachedAt,
					failedAttempts: sub.autoRenew.failedAttempts,
					nextRetryAt: sub.autoRenew.nextRetryAt,
				}
			: undefined,
		...invoiceFacts,
		billingCurrency: storeBillingCurrency(r.country),
		lastActAsAt,
		...(creditAccount
			? {
					credits: {
						plan: creditAccount.planBalance,
						purchased: creditAccount.purchasedBalance,
						periodKey: creditAccount.periodKey,
						periodGrant: creditAccount.periodGrant,
						exhaustedAt: creditAccount.exhaustedAt,
						customGrant: creditAccount.grantOverride,
					},
				}
			: {}),
	};
}

/**
 * The paginated directory. One `.paginate()` per call; see the file header
 * for why pages may come back short and why the raw cursors pass through.
 */
export const listSellersPage = query({
	args: {
		paginationOpts: paginationOptsValidator,
		sort: v.optional(sellerSortValidator),
		/** Picked statuses, ORed; empty or absent = All (z8r3fdzn6r). */
		filters: v.optional(v.array(sellerStatusFilterValidator)),
		q: v.optional(v.string()),
	},
	handler: async (
		ctx,
		{ paginationOpts, sort = DEFAULT_SELLER_SORT, filters = [], q = "" },
	) => {
		await requireAdmin(ctx);
		const deps = await sellerRowDeps(ctx);
		const needle = q.trim();
		const rawN = Math.max(
			paginationOpts.numItems,
			needle ? SEARCH_RAW_PAGE : filters.length > 0 ? FILTER_RAW_PAGE : 0,
		);
		// The paginate chain depends on the ARGS only, never on the cursor: a
		// cursor is valid for exactly the query that minted it.
		const raw =
			sort === "name"
				? await ctx.db
						.query("retailers")
						.withIndex("by_storeNameKey")
						.order("asc")
						.paginate({ ...paginationOpts, numItems: rawN })
				: await ctx.db
						.query("retailers")
						.order("desc")
						.paginate({ ...paginationOpts, numItems: rawN });
		// Founders ride the FIRST page only. `gte(0)` leaves out every store with
		// no rank (undefined sorts below every number), so this is the cohort
		// and nothing else.
		const head =
			sort === "founding" && paginationOpts.cursor === null
				? await ctx.db
						.query("retailers")
						.withIndex("by_foundingRank", (ix) =>
							ix.gte("foundingMemberRank", 0),
						)
						.order("asc")
						.take(FOUNDING_HEAD_CAP)
				: [];
		const candidates = [
			...head,
			...raw.page.filter(
				(r) => sort !== "founding" || r.foundingMemberRank === undefined,
			),
		];
		const page: AdminSellerRow[] = [];
		for (const r of candidates) {
			if (!matchesSellerSearch(searchFieldsOf(r), needle)) continue;
			const cheap = await cheapSellerFacts(ctx, r, filters, deps);
			if (cheap && !passesAnySellerFilter(cheap.facts, filters)) continue;
			page.push(await buildAdminSellerRow(ctx, r, deps, cheap?.sub));
		}
		return {
			page,
			isDone: raw.isDone,
			continueCursor: raw.continueCursor,
			splitCursor: raw.splitCursor,
			pageStatus: raw.pageStatus,
		};
	},
});

/**
 * The Status menu's numbers, over the whole book. Cheap facts only — never a
 * full row — at one subscription read per store plus the paid probe for the
 * stores that could be untagged payers. Bounded: past `ADMIN_COUNT_SCAN_LIMIT`
 * it reports `capped` and the page says so beside the numbers.
 */
export const countSellerBuckets = query({
	args: {},
	handler: async (
		ctx,
	): Promise<{ counts: SellerBucketCounts; capped: boolean }> => {
		await requireAdmin(ctx);
		const deps = await sellerRowDeps(ctx);
		const scanned = await ctx.db
			.query("retailers")
			.order("desc")
			.take(ADMIN_COUNT_SCAN_LIMIT + 1);
		const capped = scanned.length > ADMIN_COUNT_SCAN_LIMIT;
		let counts = emptySellerBucketCounts();
		for (const r of scanned.slice(0, ADMIN_COUNT_SCAN_LIMIT)) {
			counts = tallySellerFacts(counts, await fullSellerFacts(ctx, r, deps));
		}
		return { counts, capped };
	},
});

/**
 * One store as the showcase picker draws it (`showcase-store-picker.tsx`):
 * a name, a slug and the three facts that decide its row state. `internal`
 * (a Kedaipal / test / unclaimed store — `storeIsInternal`, the same rule
 * `showcases.setMembers` refuses on) is greyed out with the reason;
 * `hidden` (by Kedaipal) and `unlisted` (by the seller) are warnings on a
 * store that is still addable, because it can come back.
 */
export type AdminPickerStore = {
	_id: Id<"retailers">;
	storeName: string;
	slug: string;
	internal: boolean;
	hidden: boolean;
	unlisted: boolean;
};

/**
 * The showcase store picker's read: every store in ONE country, A–Z by name,
 * as slim rows. Not the paginated directory, on purpose — the picker's
 * select-all is over "every store in the region", which a page can't promise,
 * and it draws four fields, which a full `AdminSellerRow` (~10 reads) would
 * overpay for. One retailer read per store scanned, one subscription read per
 * store in the country that isn't already internal for a cheaper reason.
 * Scans the newest `ADMIN_COUNT_SCAN_LIMIT` stores like the counts do and
 * says so (`capped`); the sheet names it beside the match count.
 */
export const listPickerStores = query({
	args: { country: countryValidator },
	handler: async (
		ctx,
		{ country },
	): Promise<{ stores: AdminPickerStore[]; capped: boolean }> => {
		await requireAdmin(ctx);
		const adminIds = adminUserIds();
		const scanned = await ctx.db
			.query("retailers")
			.order("desc")
			.take(ADMIN_COUNT_SCAN_LIMIT + 1);
		const capped = scanned.length > ADMIN_COUNT_SCAN_LIMIT;
		const stores: AdminPickerStore[] = [];
		for (const r of scanned.slice(0, ADMIN_COUNT_SCAN_LIMIT)) {
			if ((r.country ?? DEFAULT_COUNTRY) !== country) continue;
			// Unclaimed and admin-owned stores are internal before any
			// subscription is read; only the rest pay for the comp check.
			const internal =
				storeIsInternal(r, null, adminIds) ||
				storeIsInternal(r, await loadSubscription(ctx, r._id), adminIds);
			stores.push({
				_id: r._id,
				storeName: r.storeName,
				slug: r.slug,
				internal,
				hidden: r.marketplaceHidden !== undefined,
				unlisted: r.marketplaceUnlistedAt !== undefined,
			});
		}
		// A–Z on the same key the directory's Name sort indexes, derived here
		// so the order never depends on the `storeNameKey` backfill.
		stores.sort(
			(a, b) =>
				storeNameKeyOf(a.storeName).localeCompare(storeNameKeyOf(b.storeName)) ||
				a.slug.localeCompare(b.slug),
		);
		return { stores, capped };
	},
});
