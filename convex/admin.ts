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

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalMutation,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";
import { adminUserIds, requireAdmin } from "./lib/auth";
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
import { loadSubscription } from "./subscriptions";

/** How many sellers the directory pulls. The Founding cohort is ~10 and the whole
 * book is small for a while yet; 500 is generous headroom without pagination. */
const SELLER_LIMIT = 500;
/** Recent audit rows surfaced per store in the console. */
const AUDIT_LIMIT = 50;

export type AdminSellerRow = {
	_id: Id<"retailers">;
	storeName: string;
	slug: string;
	/** Clerk subject of the owner — shown so an admin can match a store to a person. */
	ownerUserId: string;
	/** True when the store's OWNER is a Kedaipal admin (in `ADMIN_USER_IDS`). The
	 * directory renders an "Admin" pill instead of a subscription/plan status for
	 * these — an admin runs the app for free with the highest tier unlocked, so a
	 * trial/plan countdown would be misleading. A boolean only: the allowlist
	 * itself never crosses to the client. See docs/admin-console.md. */
	ownerIsAdmin: boolean;
	isFoundingMember: boolean;
	foundingMemberRank?: number;
	subscriptionStatus?: Doc<"subscriptions">["status"];
	plan?: Doc<"subscriptions">["plan"];
	createdAt: number;
};

/**
 * Every seller, for the admin act-as directory. Richer than
 * `invoices.listRetailersForAdmin` (which is billing-focused): this carries the
 * owner + founding rank + subscription status the "Manage" flow needs. Sorted
 * Founding Members first (by rank), then newest store first — the onboarding
 * cohort floats to the top.
 */
export const listSellersForAdmin = query({
	args: {},
	handler: async (ctx): Promise<AdminSellerRow[]> => {
		await requireAdmin(ctx);
		const adminIds = new Set(adminUserIds());
		const retailers = await ctx.db
			.query("retailers")
			.order("desc")
			.take(SELLER_LIMIT);
		const rows: AdminSellerRow[] = [];
		for (const r of retailers) {
			const sub = await loadSubscription(ctx, r._id);
			rows.push({
				_id: r._id,
				storeName: r.storeName,
				slug: r.slug,
				ownerUserId: r.userId,
				ownerIsAdmin: adminIds.has(r.userId),
				isFoundingMember: r.isFoundingMember === true,
				foundingMemberRank: r.foundingMemberRank,
				subscriptionStatus: sub?.status,
				plan: sub?.plan,
				createdAt: r._creationTime,
			});
		}
		rows.sort((a, b) => {
			// Founding Members first, ordered by rank; everyone else by newest.
			const ra = a.foundingMemberRank;
			const rb = b.foundingMemberRank;
			if (ra !== undefined && rb !== undefined) return ra - rb;
			if (ra !== undefined) return -1;
			if (rb !== undefined) return 1;
			return b.createdAt - a.createdAt;
		});
		return rows;
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
