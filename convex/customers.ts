import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import {
	logAdminAction,
	type RetailerAccess,
	requireRetailerAccess,
} from "./lib/auth";
import type { PermissionLevel } from "./lib/permissions";
import {
	creditGateFor,
	customerForSeller,
	forSeller,
} from "./creditLock";
import { buildSearchText } from "./lib/customer";
import { isCustomerGated, type SellerCustomer } from "./lib/orderGate";
import { revenueExcludingDeposit } from "./lib/order";
import { assertValidWaPhone } from "./lib/slug";
import {
	assertPlanFeature,
	assertSubscriptionActive,
} from "./subscriptions";

const SEARCH_DEFAULT_LIMIT = 20;
const SEARCH_MAX_LIMIT = 50;
const NOTES_MAX = 2000;
const NAME_MAX = 120;

const sortValidator = v.union(
	v.literal("recency"),
	v.literal("ltv"),
	v.literal("orderCount"),
);

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Assert the caller may operate `retailerId` (owner OR Kedaipal admin acting-as)
 * AND that their plan includes the CRM (Pro-and-above per the pricing table).
 * Every public surface in this file is the customer database, so the plan gate
 * lives in the shared helpers rather than per-endpoint. Admin act-as bypasses
 * the plan gate (support work on a Starter store), same as the soft-lock.
 * Internal linking helpers below are NOT gated — orders keep aggregating for
 * Starter sellers so the data is complete the day they upgrade.
 */
async function requireRetailerOwner(
	ctx: QueryCtx | MutationCtx,
	retailerId: Id<"retailers">,
	level: PermissionLevel,
): Promise<RetailerAccess> {
	const access = await requireRetailerAccess(ctx, retailerId, {
		area: "customers",
		level,
	});
	if (!access.actingAsAdmin) await assertPlanFeature(ctx, retailerId, "crm");
	return access;
}

/**
 * Load a customer and assert the caller may operate its retailer (owner OR
 * admin) + the CRM plan gate. Used by the detail-view queries and mutations
 * that take a `customerId`.
 */
async function requireOwnedCustomer(
	ctx: QueryCtx | MutationCtx,
	customerId: Id<"customers">,
	level: PermissionLevel,
): Promise<{ customer: Doc<"customers">; access: RetailerAccess }> {
	const customer = await ctx.db.get(customerId);
	if (!customer) throw new Error("Customer not found");
	const access = await requireRetailerOwner(ctx, customer.retailerId, level);
	return { customer, access };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const list = query({
	args: {
		retailerId: v.id("retailers"),
		sort: sortValidator,
		paginationOpts: paginationOptsValidator,
	},
	handler: async (ctx, { retailerId, sort, paginationOpts }) => {
		await requireRetailerOwner(ctx, retailerId, "read");

		const indexName =
			sort === "ltv"
				? "by_retailer_ltv"
				: sort === "orderCount"
					? "by_retailer_orderCount"
					: "by_retailer_lastOrder";

		// Credits (T3.1): a buyer whose EVERY order is waiting on credits is not
		// a customer the seller has been shown yet — the customer page carries a
		// phone number and a purchase history, which is the manual-settlement
		// loophole with extra steps (Zaki, 6 Oct 2026). Redacted rather than
		// filtered out, deliberately: `paginate` with a filter gives ragged
		// pages, and a row reading "Waiting on credits · RM 340 · 2 orders" is
		// both honest and the reason to top up. One funded order makes a buyer
		// known for good — see `isCustomerGated`.
		const gate = await creditGateFor(ctx, retailerId);
		const page = await ctx.db
			.query("customers")
			.withIndex(indexName, (q) => q.eq("retailerId", retailerId))
			.order("desc")
			.paginate(paginationOpts);
		return {
			...page,
			page: page.page.map((c) => customerForSeller(gate, c)),
		};
	},
});

/** Total customer count for the retailer — drives the dashboard stat tile. */
export const count = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<number> => {
		await requireRetailerOwner(ctx, retailerId, "read");
		const rows = await ctx.db
			.query("customers")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.collect();
		return rows.length;
	},
});

export const get = query({
	args: { customerId: v.id("customers") },
	handler: async (
		ctx,
		{ customerId },
		// `SellerCustomer`, not `Doc<"customers">`: the redaction stamps
		// `creditGated` and the narrower annotation silently dropped it from the
		// wire type, so the detail page couldn't tell a gated customer from one
		// with no name — which is exactly how it shipped rendering a blank.
	): Promise<(SellerCustomer & { averageOrderValue: number }) | null> => {
		const { customer } = await requireOwnedCustomer(ctx, customerId, "read");
		const averageOrderValue =
			customer.orderCount > 0
				? Math.round(customer.totalSpent / customer.orderCount)
				: 0;
		// Credits (T3.1) — same rule as `list`, applied to the detail page.
		const gate = await creditGateFor(ctx, customer.retailerId);
		return { ...customerForSeller(gate, customer), averageOrderValue };
	},
});

export const ordersByCustomer = query({
	args: {
		customerId: v.id("customers"),
		paginationOpts: paginationOptsValidator,
	},
	handler: async (ctx, { customerId, paginationOpts }) => {
		const { customer } = await requireOwnedCustomer(ctx, customerId, "read");
		// Credits (T3.1): the purchase history is where a seller would read a
		// gated order's contents from, so it redacts per row like the inbox. A
		// returning buyer stays visible (their earlier orders are funded) and
		// only the waiting orders go blank.
		const gate = await creditGateFor(ctx, customer.retailerId);
		const page = await ctx.db
			.query("orders")
			.withIndex("by_customer", (q) => q.eq("customerId", customerId))
			.order("desc")
			.paginate(paginationOpts);
		return { ...page, page: page.page.map((o) => forSeller(gate, o)) };
	},
});

export const search = query({
	args: {
		retailerId: v.id("retailers"),
		term: v.string(),
		limit: v.optional(v.number()),
	},
	handler: async (
		ctx,
		{ retailerId, term, limit },
	): Promise<Doc<"customers">[]> => {
		await requireRetailerOwner(ctx, retailerId, "read");
		const trimmed = term.trim();
		if (trimmed.length === 0) return [];
		// Clamp to [1, SEARCH_MAX_LIMIT] so a stray 0/negative from the UI can't
		// reach .take() (which throws on a non-positive count).
		const take = Math.max(
			1,
			Math.min(limit ?? SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT),
		);
		// Credits (T3.1): gated buyers are FILTERED OUT here, not redacted as
		// they are in `list` and `get`.
		//
		// The search index reads the STORED `searchText`, which the redaction
		// never touches (it blanks the copy that crosses the wire). So a
		// redacted hit would still be a hit — type a phone number, get a row
		// back, and the seller has confirmed the buyer without ever seeing the
		// record. That is an oracle, and an oracle is a leak.
		//
		// Dropping them is also the honest semantic: search is a lookup BY
		// IDENTITY, and a gated buyer has no identity on screen to look up.
		// They are still fully accounted for in the customer list, as a row that
		// says what it is waiting for.
		const gate = await creditGateFor(ctx, retailerId);
		const hits = await ctx.db
			.query("customers")
			.withSearchIndex("search_customers", (q) =>
				q.search("searchText", trimmed.toLowerCase()).eq("retailerId", retailerId),
			)
			.take(take);
		return hits.filter(
			(c) => gate.exempt || !isCustomerGated(c, gate.fundedThrough),
		);
	},
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const updateNotes = mutation({
	args: { customerId: v.id("customers"), notes: v.string() },
	handler: async (ctx, { customerId, notes }): Promise<void> => {
		const { access } = await requireOwnedCustomer(ctx, customerId, "write");
		await assertSubscriptionActive(ctx, access.retailer._id);
		const trimmed = notes.trim();
		if (trimmed.length > NOTES_MAX) {
			throw new Error(`Notes must be ${NOTES_MAX} characters or fewer`);
		}
		await ctx.db.patch(customerId, {
			notes: trimmed.length > 0 ? trimmed : undefined,
			updatedAt: Date.now(),
		});
		await logAdminAction(ctx, access, "customers.updateNotes", customerId);
	},
});

export const updateName = mutation({
	args: { customerId: v.id("customers"), name: v.string() },
	handler: async (ctx, { customerId, name }): Promise<void> => {
		const { customer, access } = await requireOwnedCustomer(
			ctx,
			customerId,
			"write",
		);
		await assertSubscriptionActive(ctx, access.retailer._id);
		const trimmed = name.trim();
		if (trimmed.length > NAME_MAX) {
			throw new Error(`Name must be ${NAME_MAX} characters or fewer`);
		}
		const nextName = trimmed.length > 0 ? trimmed : undefined;
		await ctx.db.patch(customerId, {
			name: nextName,
			searchText: buildSearchText({
				name: nextName,
				waProfileName: customer.waProfileName,
				waPhone: customer.waPhone,
			}),
			updatedAt: Date.now(),
		});
		await logAdminAction(ctx, access, "customers.updateName", customerId);
	},
});

// ---------------------------------------------------------------------------
// Internal helpers — called directly (not via ctx.runMutation) from orders.ts,
// whatsapp.ts, and the backfill migration so each stays a single transaction.
// ---------------------------------------------------------------------------

type LinkOrderArgs = {
	retailerId: Id<"retailers">;
	waPhone: string;
	orderId: Id<"orders">;
	orderTotal: number;
	orderCreatedAt: number;
	/** Name captured at checkout (order.customer.name); seeds a new customer. */
	customerName?: string;
};

/**
 * Find-or-create the customer for `(retailerId, waPhone)`, fold this order into
 * the denormalized aggregates, and stamp `order.customerId`. Returns the
 * customer id. Callers must only invoke this for an order that is not already
 * linked, so aggregates are counted exactly once.
 */
export async function linkOrderToCustomer(
	ctx: MutationCtx,
	args: LinkOrderArgs,
): Promise<Id<"customers">> {
	const now = Date.now();
	const seedName = args.customerName?.trim() || undefined;

	const existing = await ctx.db
		.query("customers")
		.withIndex("by_retailer_phone", (q) =>
			q.eq("retailerId", args.retailerId).eq("waPhone", args.waPhone),
		)
		.unique();

	let customerId: Id<"customers">;
	if (existing) {
		// Fill the display name from the checkout name only when the customer
		// has none yet. This seed takes precedence over any pushname that a
		// subsequent refreshWaProfileName call (in the same WhatsApp confirm
		// flow) would otherwise fill in — checkout name beats raw pushname.
		const name = existing.name ?? seedName;
		// Credits (T3.1): a buyer whose record was closed because their only
		// order was cancelled while gated (`neverFunded`) gets a fresh start
		// here. Re-point `firstOrderCreditSeq` at THIS order and drop the
		// stamp, so the new order's own funding decides whether they are
		// visible — a returning buyer who is paid for must not stay hidden by
		// a cancellation months ago, and one whose new order is also gated
		// stays hidden on that order's own merit.
		const reopened =
			existing.neverFunded === true
				? {
						neverFunded: undefined,
						firstOrderCreditSeq: (await ctx.db.get(args.orderId))?.creditSeq,
					}
				: {};
		await ctx.db.patch(existing._id, {
			name,
			orderCount: existing.orderCount + 1,
			totalSpent: existing.totalSpent + args.orderTotal,
			firstOrderAt: Math.min(existing.firstOrderAt, args.orderCreatedAt),
			lastOrderAt: Math.max(existing.lastOrderAt, args.orderCreatedAt),
			searchText: buildSearchText({
				name,
				waProfileName: existing.waProfileName,
				waPhone: existing.waPhone,
			}),
			updatedAt: now,
			...reopened,
		});
		customerId = existing._id;
	} else {
		// Credits (T3.1): a BRAND-NEW buyer inherits their first order's queue
		// position, so a customer record created by a gated order doesn't hand
		// the seller the phone number that order is holding back. Stamped only
		// here, on the insert — a RETURNING buyer is already known, and nothing
		// a later order does should hide them again ("funded stays funded").
		//
		// `recordOrderCreated` runs before every `linkOrderToCustomer` call site,
		// so the order's `creditSeq` is already written by the time we read it.
		// Absent (a debit that faulted, or an order from before the gate) leaves
		// this absent too, which reads as visible — the gate fails open.
		const order = await ctx.db.get(args.orderId);
		customerId = await ctx.db.insert("customers", {
			retailerId: args.retailerId,
			waPhone: args.waPhone,
			name: seedName,
			searchText: buildSearchText({ name: seedName, waPhone: args.waPhone }),
			orderCount: 1,
			totalSpent: args.orderTotal,
			firstOrderAt: args.orderCreatedAt,
			lastOrderAt: args.orderCreatedAt,
			firstOrderCreditSeq: order?.creditSeq,
			createdAt: now,
			updatedAt: now,
		});
	}

	await ctx.db.patch(args.orderId, { customerId, updatedAt: now });
	return customerId;
}

/**
 * Refresh the WhatsApp pushname for a customer. Always overwrites
 * `waProfileName` with the latest non-empty pushname, but fills `name` only
 * when the retailer hasn't set their own override — the retailer edit is the
 * source of truth and must never be clobbered by a pushname change.
 */
export async function refreshWaProfileName(
	ctx: MutationCtx,
	{ customerId, profileName }: { customerId: Id<"customers">; profileName: string },
): Promise<void> {
	const trimmed = profileName.trim();
	if (trimmed.length === 0) return;
	const customer = await ctx.db.get(customerId);
	if (!customer) return;
	const name = customer.name ?? trimmed;
	await ctx.db.patch(customerId, {
		waProfileName: trimmed,
		name,
		searchText: buildSearchText({
			name,
			waProfileName: trimmed,
			waPhone: customer.waPhone,
		}),
		updatedAt: Date.now(),
	});
}

/**
 * Reverse an order's contribution to the customer aggregates when it is
 * cancelled. Floors at zero so a double-cancel or data drift can't drive the
 * counters negative. Order-date aggregates are intentionally left as-is for v1.
 */
export async function decrementAggregatesForCancel(
	ctx: MutationCtx,
	{ customerId, orderTotal }: { customerId: Id<"customers">; orderTotal: number },
): Promise<void> {
	const customer = await ctx.db.get(customerId);
	if (!customer) return;
	await ctx.db.patch(customerId, {
		orderCount: Math.max(0, customer.orderCount - 1),
		totalSpent: Math.max(0, customer.totalSpent - orderTotal),
		updatedAt: Date.now(),
	});
}

/**
 * Adjust a customer's `totalSpent` by a signed delta (minor units) when an
 * order's total changes *without* changing the order count — e.g. a made-to-order
 * quote is added/revised on the mockup, or the buyer declines the custom item.
 * `orderCount` is intentionally left alone (still one order). Floors at zero.
 */
export async function adjustAggregatesForTotalChange(
	ctx: MutationCtx,
	{ customerId, delta }: { customerId: Id<"customers">; delta: number },
): Promise<void> {
	if (delta === 0) return;
	const customer = await ctx.db.get(customerId);
	if (!customer) return;
	await ctx.db.patch(customerId, {
		totalSpent: Math.max(0, customer.totalSpent + delta),
		updatedAt: Date.now(),
	});
}

/**
 * Move an order onto a different WhatsApp number, carrying its CRM history with
 * it. Used by the two confirmation-push repair paths (86eyf1rck): the buyer
 * sending the ORD message manually from their real WhatsApp, and the buyer
 * correcting the number on their order page. Both mean the same thing — the
 * number captured at checkout was wrong — so both must move the order's
 * aggregates off the wrong customer record and onto the right one, or the
 * seller's CRM shows a phantom customer who ordered once and a real customer
 * who never did.
 *
 * **Cancelled orders move the phone only.** Cancelling already ran
 * `decrementAggregatesForCancel` (see `reverseCancellationEffects`) while
 * leaving `customerId` set, and neither repair route gates on status — a
 * cancelled order is still reachable via its failed-push card. Re-running the
 * decrement here would subtract a second time (silently eating a *different*
 * real order's count/spend if that customer has others) and the re-link would
 * then credit the new customer with an order that no longer exists. A cancelled
 * order contributes nothing to either record, so there is nothing to move — the
 * same trap `deleteOrderCascade` guards.
 *
 * No-ops when the phone hasn't actually changed. Caller is responsible for
 * authorization and for validating/normalizing `newPhone` first.
 */
export async function moveOrderToPhone(
	ctx: MutationCtx,
	{ order, newPhone }: { order: Doc<"orders">; newPhone: string },
): Promise<Id<"customers"> | undefined> {
	if (order.customer.waPhone === newPhone) return order.customerId;

	// Always correct the number itself, so later messages reach the buyer.
	await ctx.db.patch(order._id, {
		customer: { ...order.customer, waPhone: newPhone },
		updatedAt: Date.now(),
	});
	if (order.status === "cancelled") return order.customerId;

	// Un-count it from the record it was (wrongly) attributed to at checkout.
	if (order.customerId) {
		await decrementAggregatesForCancel(ctx, {
			customerId: order.customerId,
			orderTotal: revenueExcludingDeposit(order),
		});
	}
	// Re-link against the real number (also re-stamps order.customerId).
	return linkOrderToCustomer(ctx, {
		retailerId: order.retailerId,
		waPhone: newPhone,
		orderId: order._id,
		orderTotal: revenueExcludingDeposit(order),
		orderCreatedAt: order.createdAt,
		customerName: order.customer.name,
	});
}

// ---------------------------------------------------------------------------
// Backfill migration
// ---------------------------------------------------------------------------

const BACKFILL_BATCH_SIZE = 100;

/**
 * One-shot migration: scan existing orders and create/link the customer record
 * for every unique (retailerId, waPhone). Runs in batches and self-schedules to
 * stay within Convex transaction limits. Idempotent — orders already linked
 * (customerId set) are skipped, so re-running never double-counts.
 *
 *   npx convex run customers:backfillCustomers '{"cursor": null}'
 */
export const backfillCustomers = internalMutation({
	args: { cursor: v.union(v.string(), v.null()) },
	handler: async (
		ctx,
		{ cursor },
	): Promise<{ processed: number; isDone: boolean }> => {
		const batch = await ctx.db
			.query("orders")
			.order("asc")
			.paginate({ numItems: BACKFILL_BATCH_SIZE, cursor });

		let processed = 0;
		for (const order of batch.page) {
			if (order.customerId) continue; // already linked
			if (!order.customer.waPhone) continue; // no phone → nothing to key on
			let waPhone: string;
			try {
				waPhone = assertValidWaPhone(order.customer.waPhone);
			} catch {
				continue; // malformed legacy phone — skip rather than abort the batch
			}
			await linkOrderToCustomer(ctx, {
				retailerId: order.retailerId,
				waPhone,
				orderId: order._id,
				orderTotal: revenueExcludingDeposit(order),
				orderCreatedAt: order.createdAt,
				customerName: order.customer.name,
			});
			processed++;
		}

		if (!batch.isDone) {
			await ctx.scheduler.runAfter(0, internal.customers.backfillCustomers, {
				cursor: batch.continueCursor,
			});
		}
		return { processed, isDone: batch.isDone };
	},
});
