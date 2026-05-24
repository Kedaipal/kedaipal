import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { buildSearchText } from "./lib/customer";
import { assertValidWaPhone } from "./lib/slug";

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
 * Assert the caller owns `retailerId`, returning the retailer doc. Mirrors the
 * Clerk-subject ownership check used across orders.ts / retailers.ts.
 */
async function requireRetailerOwner(
	ctx: QueryCtx,
	retailerId: Id<"retailers">,
): Promise<Doc<"retailers">> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new Error("Not authenticated");
	const retailer = await ctx.db.get(retailerId);
	if (!retailer) throw new Error("Retailer not found");
	if (retailer.userId !== identity.subject) throw new Error("Forbidden");
	return retailer;
}

/**
 * Load a customer and assert the caller owns its retailer. Used by the
 * detail-view queries and mutations that take a `customerId`.
 */
async function requireOwnedCustomer(
	ctx: QueryCtx,
	customerId: Id<"customers">,
): Promise<Doc<"customers">> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new Error("Not authenticated");
	const customer = await ctx.db.get(customerId);
	if (!customer) throw new Error("Customer not found");
	const retailer = await ctx.db.get(customer.retailerId);
	if (!retailer) throw new Error("Retailer not found");
	if (retailer.userId !== identity.subject) throw new Error("Forbidden");
	return customer;
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
		await requireRetailerOwner(ctx, retailerId);

		const indexName =
			sort === "ltv"
				? "by_retailer_ltv"
				: sort === "orderCount"
					? "by_retailer_orderCount"
					: "by_retailer_lastOrder";

		return ctx.db
			.query("customers")
			.withIndex(indexName, (q) => q.eq("retailerId", retailerId))
			.order("desc")
			.paginate(paginationOpts);
	},
});

export const get = query({
	args: { customerId: v.id("customers") },
	handler: async (
		ctx,
		{ customerId },
	): Promise<(Doc<"customers"> & { averageOrderValue: number }) | null> => {
		const customer = await requireOwnedCustomer(ctx, customerId);
		const averageOrderValue =
			customer.orderCount > 0
				? Math.round(customer.totalSpent / customer.orderCount)
				: 0;
		return { ...customer, averageOrderValue };
	},
});

export const ordersByCustomer = query({
	args: {
		customerId: v.id("customers"),
		paginationOpts: paginationOptsValidator,
	},
	handler: async (ctx, { customerId, paginationOpts }) => {
		await requireOwnedCustomer(ctx, customerId);
		return ctx.db
			.query("orders")
			.withIndex("by_customer", (q) => q.eq("customerId", customerId))
			.order("desc")
			.paginate(paginationOpts);
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
		await requireRetailerOwner(ctx, retailerId);
		const trimmed = term.trim();
		if (trimmed.length === 0) return [];
		// Clamp to [1, SEARCH_MAX_LIMIT] so a stray 0/negative from the UI can't
		// reach .take() (which throws on a non-positive count).
		const take = Math.max(
			1,
			Math.min(limit ?? SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT),
		);
		return ctx.db
			.query("customers")
			.withSearchIndex("search_customers", (q) =>
				q.search("searchText", trimmed.toLowerCase()).eq("retailerId", retailerId),
			)
			.take(take);
	},
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const updateNotes = mutation({
	args: { customerId: v.id("customers"), notes: v.string() },
	handler: async (ctx, { customerId, notes }): Promise<void> => {
		await requireOwnedCustomer(ctx, customerId);
		const trimmed = notes.trim();
		if (trimmed.length > NOTES_MAX) {
			throw new Error(`Notes must be ${NOTES_MAX} characters or fewer`);
		}
		await ctx.db.patch(customerId, {
			notes: trimmed.length > 0 ? trimmed : undefined,
			updatedAt: Date.now(),
		});
	},
});

export const updateName = mutation({
	args: { customerId: v.id("customers"), name: v.string() },
	handler: async (ctx, { customerId, name }): Promise<void> => {
		const customer = await requireOwnedCustomer(ctx, customerId);
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
		});
		customerId = existing._id;
	} else {
		customerId = await ctx.db.insert("customers", {
			retailerId: args.retailerId,
			waPhone: args.waPhone,
			name: seedName,
			searchText: buildSearchText({ name: seedName, waPhone: args.waPhone }),
			orderCount: 1,
			totalSpent: args.orderTotal,
			firstOrderAt: args.orderCreatedAt,
			lastOrderAt: args.orderCreatedAt,
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
				orderTotal: order.total,
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
