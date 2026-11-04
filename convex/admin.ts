// Admin Console — the white-glove "act-as seller" surface (ClickUp 86ey25er1,
// docs/admin-console.md). These reads are the seller directory + audit trail
// behind /app/admin/sellers. Every function is `requireAdmin`-gated server-side
// (the client `billing.amIAdmin` check is cosmetic) so a normal seller can never
// reach another store's data here.
//
// The act-as WRITE path does NOT live here — it's the owner-OR-admin
// `requireRetailerAccess` gate threaded through the normal dashboard functions
// (products/orders/customers/retailers/pickupLocations/counterCheckout), with
// `logAdminAction` stamping an `adminAuditLog` row on each admin-on-behalf write.

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	internalMutation,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";
import {
	adminUserIds,
	logDestructiveAdminAction,
	requireAdmin,
} from "./lib/auth";
import {
	BUSINESS_REPORT_ORDER_SCAN_CAP,
	type BusinessReport,
	CREATION_SKEW_BUFFER_MS,
	mytWeekWindow,
	reduceBusinessReport,
	type ReportOrderInput,
} from "./lib/businessReport";
import {
	ADMIN_AUDIT_LOG_RETENTION_MS,
	LOG_PURGE_PAGE_SIZE,
} from "./lib/retention";
import {
	compHighlightEligible,
	sanitizeHiddenNote,
} from "./lib/marketplaceListing";
import { storeIsInternal } from "./marketplace";
import { listAllSellersForAdmin } from "./adminSellers";
import {
	cleanAvailabilityNote,
	type StoreAvailability,
} from "./lib/storeAvailability";
import { loadAvailabilityRow, storeAvailabilityOf } from "./storeAvailability";
import { loadSubscription } from "./subscriptions";

/** Recent audit rows surfaced per store in the console. */
const AUDIT_LIMIT = 50;

export type { AdminSellerRow } from "./adminSellers";

/**
 * Every seller, for the admin act-as directory — the legacy whole-book read.
 * The directory page itself is paginated now (`adminSellers.listSellersPage`);
 * this stays for the showcase store picker (`showcase-store-picker.tsx`),
 * which filters the book by country on the client. Founding Members first (by
 * rank), then newest store first. Capped at `ADMIN_STORE_LIST_LIMIT`, shared
 * with the billing picker so two lists of the same stores never disagree.
 */
export const listSellersForAdmin = query({
	args: {},
	handler: listAllSellersForAdmin,
});

/**
 * Start or move a store's marketplace "Store highlights" sponsorship window
 * (z8r3fdkmyp). Admin-only and audited: v1 sponsorship is sold by hand
 * (manual invoice), so the admin console is the ONE writer — a self-serve
 * purchase path would arrive as its own ticket, not as a widening of this.
 * A past `until` is refused rather than stored as an already-expired window
 * that reads like a bug in the directory. Expiry itself is read-time
 * (`sponsorshipActive`), so nothing needs a cron. Ending one early is its own
 * act — `endMarketplaceSponsorship` — so the audit log says which happened
 * (the setComp / revokeComp pair's shape).
 */
export const setMarketplaceSponsorship = mutation({
	args: { retailerId: v.id("retailers"), until: v.number() },
	handler: async (ctx, { retailerId, until }): Promise<void> => {
		const adminUserId = await requireAdmin(ctx);
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) throw new ConvexError("Store not found");
		if (until <= Date.now()) {
			throw new ConvexError("Sponsorship end must be in the future");
		}
		await ctx.db.patch(retailerId, {
			marketplaceSponsoredUntil: until,
			updatedAt: Date.now(),
		});
		await ctx.db.insert("adminAuditLog", {
			adminUserId,
			retailerId,
			action: "admin.setMarketplaceSponsorship",
			targetId: retailerId,
			ts: Date.now(),
		});
	},
});

/** End a store's sponsorship now (z8r3fdkmyp) — the card leaves the rail on
 * the next read. Idempotent: ending a window that isn't running writes
 * nothing, so a double-click can't litter the audit log. */
export const endMarketplaceSponsorship = mutation({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<void> => {
		const adminUserId = await requireAdmin(ctx);
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) throw new ConvexError("Store not found");
		if (retailer.marketplaceSponsoredUntil === undefined) return;
		await ctx.db.patch(retailerId, {
			marketplaceSponsoredUntil: undefined,
			updatedAt: Date.now(),
		});
		await ctx.db.insert("adminAuditLog", {
			adminUserId,
			retailerId,
			action: "admin.endMarketplaceSponsorship",
			targetId: retailerId,
			ts: Date.now(),
		});
	},
});

/**
 * The admin's one override of the comp-driven highlight (z8r3fdkmyp): comped
 * partner / sponsor / pilot stores ride Store highlights automatically, and
 * this switch keeps a particular one OFF (or puts it back). Only meaningful
 * for a comp-eligible store; refused otherwise rather than storing a stamp
 * that silently does nothing. Turning off keeps the FIRST stamp on a re-save.
 */
export const setCompHighlight = mutation({
	args: { retailerId: v.id("retailers"), on: v.boolean() },
	handler: async (ctx, { retailerId, on }): Promise<void> => {
		const adminUserId = await requireAdmin(ctx);
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) throw new ConvexError("Store not found");
		const sub = await loadSubscription(ctx, retailerId);
		if (!compHighlightEligible(sub?.comped === true, sub?.comp?.kind)) {
			throw new ConvexError(
				"Only comped partner, sponsor or pilot stores are featured automatically",
			);
		}
		const next = on
			? undefined
			: (retailer.marketplaceCompHighlightOffAt ?? Date.now());
		if (next === retailer.marketplaceCompHighlightOffAt) return;
		await ctx.db.patch(retailerId, {
			marketplaceCompHighlightOffAt: next,
			updatedAt: Date.now(),
		});
		await ctx.db.insert("adminAuditLog", {
			adminUserId,
			retailerId,
			action: "admin.setCompHighlight",
			targetId: retailerId,
			ts: Date.now(),
		});
	},
});

/**
 * Take a store off /stores (z8r3fdkmyp, Zaki 1 Oct 2026) — junk trials,
 * quality, policy. It outranks the seller's own "List my store" switch, and
 * touches nothing else: the storefront, orders and WhatsApp all carry on.
 * The optional `note` is shown to the seller on their settings card, so a
 * hide for a fixable reason tells them what to fix. Refused for an internal
 * store (never listed anyway — a stamp there would do nothing). Hiding a
 * store that is already hidden writes nothing, so the first stamp and note
 * stand and a double-click can't litter the audit log. Undone by its own act,
 * `showOnMarketplace`, so the log says which happened.
 */
export const hideFromMarketplace = mutation({
	args: { retailerId: v.id("retailers"), note: v.optional(v.string()) },
	handler: async (ctx, { retailerId, note }): Promise<void> => {
		const adminUserId = await requireAdmin(ctx);
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) throw new ConvexError("Store not found");
		const sub = await loadSubscription(ctx, retailerId);
		if (storeIsInternal(retailer, sub, adminUserIds())) {
			throw new ConvexError(
				"Internal stores are never listed on /stores — nothing to hide",
			);
		}
		const cleanNote = sanitizeHiddenNote(note);
		if (retailer.marketplaceHidden !== undefined) return;
		await ctx.db.patch(retailerId, {
			marketplaceHidden: {
				at: Date.now(),
				...(cleanNote ? { note: cleanNote } : {}),
			},
			updatedAt: Date.now(),
		});
		await ctx.db.insert("adminAuditLog", {
			adminUserId,
			retailerId,
			action: "admin.hideFromMarketplace",
			targetId: retailerId,
			ts: Date.now(),
		});
	},
});

/** Put a hidden store back (z8r3fdkmyp). It lists again once the rest of the
 * listable rule holds — the seller's own opt-out still applies. Idempotent,
 * like the hide. */
export const showOnMarketplace = mutation({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<void> => {
		const adminUserId = await requireAdmin(ctx);
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) throw new ConvexError("Store not found");
		if (retailer.marketplaceHidden === undefined) return;
		await ctx.db.patch(retailerId, {
			marketplaceHidden: undefined,
			updatedAt: Date.now(),
		});
		await ctx.db.insert("adminAuditLog", {
			adminUserId,
			retailerId,
			action: "admin.showOnMarketplace",
			targetId: retailerId,
			ts: Date.now(),
		});
	},
});

/**
 * Kedaipal switches a store off (`z8r3fdudf7`): `paused` keeps the storefront
 * browse-only and closes every order door INCLUDING the counter; `offline`
 * takes the storefront itself down (neutral unavailable page, off /stores and
 * the sitemap). Its own stamp, so it never clears the seller's pause or an
 * Off-Season Hold, and lifting it reveals whichever of those is still on.
 * The note is shown to the SELLER ("Kedaipal paused this store: …") — never
 * to buyers, who only ever see a neutral "isn't available right now".
 * Existing orders are untouched: tracking pages, transactional messages and
 * the seller's progress / refund controls all keep working.
 */
export const setStoreAvailability = mutation({
	args: {
		retailerId: v.id("retailers"),
		mode: v.union(v.literal("paused"), v.literal("offline")),
		note: v.optional(v.string()),
	},
	handler: async (ctx, { retailerId, mode, note }): Promise<void> => {
		const adminUserId = await requireAdmin(ctx);
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) throw new ConvexError("Store not found");
		const now = Date.now();
		const fields = {
			adminMode: mode,
			adminNote: cleanAvailabilityNote(note),
			adminAt: now,
			adminByUserId: adminUserId,
			updatedAt: now,
		};
		const row = await loadAvailabilityRow(ctx, retailerId);
		if (row) await ctx.db.patch(row._id, fields);
		else await ctx.db.insert("storeAvailability", { retailerId, ...fields });
		await ctx.db.insert("adminAuditLog", {
			adminUserId,
			retailerId,
			action: mode === "offline" ? "admin.takeStoreOffline" : "admin.pauseStore",
			targetId: retailerId,
			ts: now,
		});
	},
});

/** Lift Kedaipal's switch. The seller's own pause and a hold, if either is
 * on, keep speaking — a reopen never silently reopens what someone else shut. */
/**
 * "Reopen store" — lifts Kedaipal's switch only. Returns the store's state
 * AFTERWARDS from the resolver, so the admin toast says what still keeps
 * orders off (a hold, the seller's own pause) from the same author every
 * door uses, never from a status proxy (PR #369 review).
 */
export const clearStoreAvailability = mutation({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<StoreAvailability> => {
		const adminUserId = await requireAdmin(ctx);
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) throw new ConvexError("Store not found");
		const row = await loadAvailabilityRow(ctx, retailerId);
		if (!row || row.adminMode === undefined)
			return storeAvailabilityOf(ctx, retailer);
		const now = Date.now();
		await ctx.db.patch(row._id, {
			adminMode: undefined,
			adminNote: undefined,
			adminAt: undefined,
			adminByUserId: undefined,
			updatedAt: now,
		});
		await ctx.db.insert("adminAuditLog", {
			adminUserId,
			retailerId,
			action: "admin.reopenStore",
			targetId: retailerId,
			ts: now,
		});
		return storeAvailabilityOf(ctx, retailer);
	},
});

export type AdminAuditRow = {
	_id: Id<"adminAuditLog">;
	adminUserId: string;
	action: string;
	targetId?: string;
	ts: number;
};

/**
 * Recent admin-on-behalf edits for one store — the attributability surface. Lets
 * an admin (and, later, a seller-facing "changes by Kedaipal" view) see exactly
 * what was done on a store during white-glove. Admin-gated; newest first.
 */
export const recentAuditForRetailer = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<AdminAuditRow[]> => {
		await requireAdmin(ctx);
		const rows = await ctx.db
			.query("adminAuditLog")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.order("desc")
			.take(AUDIT_LIMIT);
		return rows.map((r) => ({
			_id: r._id,
			adminUserId: r.adminUserId,
			action: r.action,
			targetId: r.targetId,
			ts: r.ts,
		}));
	},
});

/**
 * Record that an admin ENTERED a seller's store (act-as session start). Fired by
 * the directory's "Manage" action. This is the read-side attributability trail:
 * individual act-as reads (order history, customer PII, payment proofs, bank
 * details) aren't logged, but the ENTRY into a tenant is — so "who at Kedaipal
 * opened my store, and when?" is always answerable, not just "who edited it".
 * Admin-gated; a no-op for a bogus/missing retailer id. See docs/admin-console.md.
 */
export const startActAsSession = mutation({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<void> => {
		const adminUserId = await requireAdmin(ctx);
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) return; // stale id — the client redirect handles it
		// A purge cascade is mid-flight — entering the store now would race the
		// deletes and could even write an orphan row (the cascade doc's warning).
		if (retailer.purgeStartedAt !== undefined) {
			throw new ConvexError("This store is being purged — hands off until it finishes.");
		}
		await ctx.db.insert("adminAuditLog", {
			adminUserId,
			retailerId,
			action: "actAs.sessionStart",
			ts: Date.now(),
		});
	},
});

/**
 * Kedaipal's OWN weekly business numbers — MRR, who lapsed, signups, order
 * volume. Feeds the secret-guarded `GET /internal/business-report` route, which
 * is its only caller; the pure reduce lives in `lib/businessReport.ts`.
 *
 * Deliberately an `internalQuery` with no `requireAdmin`: it isn't reachable
 * from the client API surface at all, and the HTTP route's shared secret is the
 * gate. Adding an auth check here would imply a caller that can't exist.
 *
 * Read plan (all indexed, N+1-free — see docs/founder-business-report.md):
 * one `retailers` collect, four `by_status` subscription collects, ONE paid +
 * ONE pending invoice collect reduced to per-retailer maps, `foundingMembers`,
 * and a bounded newest-first order scan.
 */
export const businessReport = internalQuery({
	args: {},
	handler: async (ctx): Promise<BusinessReport> => {
		const now = Date.now();

		const retailers = await ctx.db.query("retailers").collect();

		// The cron's own scan shape. Also yields the status counts for free.
		const [trialing, active, pastDue, cancelled] = await Promise.all(
			(["trialing", "active", "past_due", "cancelled"] as const).map((status) =>
				ctx.db
					.query("subscriptions")
					.withIndex("by_status", (q) => q.eq("status", status))
					.collect(),
			),
		);

		// ONE pass per invoice status. Deliberately NOT the daily cron's
		// per-subscription `by_retailer` read: `invoices` has no compound index,
		// so that shape is N+1 once it runs across every retailer.
		const [paidInvoices, pendingInvoices] = await Promise.all([
			ctx.db
				.query("invoices")
				.withIndex("by_status", (q) => q.eq("status", "paid"))
				.collect(),
			ctx.db
				.query("invoices")
				.withIndex("by_status", (q) => q.eq("status", "pending"))
				.collect(),
		]);

		const founding = await ctx.db.query("foundingMembers").collect();

		// `orders` has no cross-retailer time index (every index is
		// retailerId-prefixed), so this rides Convex's system creation-time index,
		// widened by a skew buffer and then filtered precisely on `createdAt` in
		// the reduce — the technique analytics.ts documents.
		// Derived from the SAME window the reduce filters on, so the scan bound and
		// the filter can never drift apart.
		const window = mytWeekWindow(now);
		const scanned = await ctx.db
			.query("orders")
			.withIndex("by_creation_time", (q) =>
				q
					.gte("_creationTime", window.start - CREATION_SKEW_BUFFER_MS)
					.lt("_creationTime", window.endExclusive + CREATION_SKEW_BUFFER_MS),
			)
			.order("desc")
			.take(BUSINESS_REPORT_ORDER_SCAN_CAP + 1);
		const ordersCapped = scanned.length > BUSINESS_REPORT_ORDER_SCAN_CAP;
		const orders: ReportOrderInput[] = scanned
			.slice(0, BUSINESS_REPORT_ORDER_SCAN_CAP)
			.map((o) => ({
				retailerId: o.retailerId,
				createdAt: o.createdAt,
				status: o.status,
				total: o.total,
			}));

		return reduceBusinessReport({
			now,
			adminUserIds: adminUserIds(),
			retailers: retailers.map((r) => ({
				id: r._id,
				slug: r.slug,
				userId: r.userId,
				notifyEmail: r.notifyEmail,
				createdAt: r.createdAt,
			})),
			subscriptions: [...trialing, ...active, ...pastDue, ...cancelled].map(
				(s) => ({
					retailerId: s.retailerId,
					status: s.status,
					comped: s.comped,
					compEndedAt: s.compEndedAt,
					updatedAt: s.updatedAt,
				}),
			),
			paidInvoices: paidInvoices.map((i) => ({
				retailerId: i.retailerId,
				total: i.total,
				currency: i.currency,
				periodStart: i.periodStart,
				periodEnd: i.periodEnd,
				billingCycle: i.billingCycle,
				markedPaidAt: i.markedPaidAt,
				createdAt: i.createdAt,
			})),
			pendingInvoices: pendingInvoices.map((i) => ({
				retailerId: i.retailerId,
				dueDate: i.dueDate,
			})),
			orders,
			ordersCapped,
			founding: {
				reserved: founding.length,
				paid: founding.filter((f) => f.paidAt !== undefined).length,
			},
		});
	},
});

/**
 * Log retention (ClickUp 86eyetzt7, docs/data-retention.md): purge
 * adminAuditLog rows past the 24-month compliance window — old enough that the
 * trail has outlived any plausible dispute or PDPA access request. Window
 * lives in convex/lib/retention.ts; daily cron in convex/crons.ts. Paginated
 * self-chaining (counterCheckout.purgeStaleSessions house pattern) over the
 * `by_ts` index — a bounded range read, never a full scan.
 */
export const purgeExpiredAdminAudit = internalMutation({
	args: {},
	handler: async (ctx): Promise<void> => {
		const cutoff = Date.now() - ADMIN_AUDIT_LOG_RETENTION_MS;
		const page = await ctx.db
			.query("adminAuditLog")
			.withIndex("by_ts", (q) => q.lt("ts", cutoff))
			.take(LOG_PURGE_PAGE_SIZE);
		for (const row of page) {
			await ctx.db.delete(row._id);
		}
		if (page.length === LOG_PURGE_PAGE_SIZE) {
			await ctx.scheduler.runAfter(0, internal.admin.purgeExpiredAdminAudit, {});
		}
	},
});

// ── Dev-only store purge (z8r3fdbmc9) ────────────────────────────────────────

/** The production Convex deployment. A hard deny-list for dev-only tooling —
 * checked against `CONVEX_CLOUD_URL`, which Convex sets on every deployment. */
const PROD_DEPLOYMENT_NAME = "peaceful-falcon-152";

/** How long a `purgeStartedAt` stamp locks the store before a re-purge is
 * allowed. The cascade normally finishes in seconds; a stamp older than this
 * means it crashed, and re-running (idempotent phases) is the recovery. */
const PURGE_RETRY_AFTER_MS = 10 * 60 * 1000;

/**
 * Whether the dev-only store purge is armed on THIS deployment. Two
 * independent, fail-closed guards, because the action is total erasure:
 *
 *  1. A hard deny on the production deployment — even a fat-fingered
 *     `DEV_STORE_PURGE_ENABLED` set on prod must not arm it.
 *  2. An explicit opt-in env flag, which prod simply never sets. Absent,
 *     empty, or any value but "true"/"1" reads as OFF — including on a
 *     deployment we can't identify.
 *
 * Exported for tests (each guard is mutation-tested on its own).
 */
export function devStorePurgeAllowed(): boolean {
	if ((process.env.CONVEX_CLOUD_URL ?? "").includes(PROD_DEPLOYMENT_NAME)) {
		return false;
	}
	const flag = process.env.DEV_STORE_PURGE_ENABLED;
	return flag === "true" || flag === "1";
}

/**
 * Whether the sellers directory should render the purge control. Cosmetic —
 * `purgeStoreForAdmin` re-checks server-side — but querying it keeps the
 * button honest instead of rendering a control that always refuses on prod.
 */
export const devStorePurgeEnabled = query({
	args: {},
	handler: async (ctx): Promise<boolean> => {
		await requireAdmin(ctx);
		return devStorePurgeAllowed();
	},
});

/**
 * DEV-ONLY: erase a store back to nothing so its Clerk account onboards fresh.
 *
 * Reuses the PDPA erasure cascade wholesale (`internal.retailers.deleteUser` →
 * `runDeletionPhase`, every phase, self-chaining) rather than a second sweep
 * that would drift on the next table. The Clerk USER is untouched — that's the
 * point: after the cascade, `getMyRetailer` returns null and `/onboarding`
 * treats the login as brand-new. Erasure is asynchronous (the cascade batches
 * itself through the scheduler), so the directory row disappears a moment
 * after the call returns, not synchronously.
 *
 * Guards, in order: admin allowlist → the two-guard dev gate above → the
 * caller must echo the store's SLUG (proves the click matched the row — the
 * same typed-phrase contract the confirm dialog enforces client-side). The
 * audit row goes through `logDestructiveAdminAction` (recorded even for an
 * admin's own store — 86eyhz189's rule for irreversible erasures) and survives
 * the cascade, which retains `adminAuditLog` by decision.
 */
export const purgeStoreForAdmin = mutation({
	args: {
		retailerId: v.id("retailers"),
		/** The store's slug, echoed back — a wrong-row misfire guard. */
		confirmSlug: v.string(),
	},
	handler: async (
		ctx,
		args,
	): Promise<{ storeName: string; ownerUserId: string }> => {
		const adminUserId = await requireAdmin(ctx);
		if (!devStorePurgeAllowed()) {
			throw new ConvexError(
				"Store purge is a dev-deployment tool and is disabled here.",
			);
		}
		const retailer = await ctx.db.get(args.retailerId);
		if (!retailer) {
			throw new ConvexError("Store not found — already purged?");
		}
		if (args.confirmSlug.trim().toLowerCase() !== retailer.slug) {
			throw new ConvexError("Slug confirmation doesn't match this store.");
		}
		// One cascade at a time. A stamp INSIDE the window means it's still
		// running (normal case: seconds); one OLDER than the window means a
		// crashed cascade, and re-running is the recovery path — every phase is
		// idempotent, so re-scheduling just resumes the erase.
		if (
			retailer.purgeStartedAt !== undefined &&
			Date.now() - retailer.purgeStartedAt < PURGE_RETRY_AFTER_MS
		) {
			throw new ConvexError("A purge is already running for this store.");
		}
		await ctx.db.patch(retailer._id, { purgeStartedAt: Date.now() });
		await logDestructiveAdminAction(
			ctx,
			{
				retailer,
				role: retailer.userId === adminUserId ? "owner" : "admin",
				actingAsAdmin: retailer.userId !== adminUserId,
				userId: adminUserId,
			},
			"admin.purgeStore",
			retailer._id,
		);
		await ctx.scheduler.runAfter(0, internal.retailers.deleteUser, {
			userId: retailer.userId,
		});
		return { storeName: retailer.storeName, ownerUserId: retailer.userId };
	},
});
