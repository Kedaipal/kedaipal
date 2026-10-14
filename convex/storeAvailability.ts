// Store availability (`z8r3fdudf7`) — the seller's "Accepting orders" switch,
// the guards every order door calls, and the read the dashboard shows. The
// rules themselves live in `convex/lib/storeAvailability.ts`; Kedaipal's
// pause / take-offline writes live in `convex/admin.ts` beside the
// marketplace hide they sit next to in the seller sheet.
//
// See docs/store-availability.md.

import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type QueryCtx, query } from "./_generated/server";
import { logAdminAction, requireRetailerAccess } from "./lib/auth";
import {
	cleanAvailabilityNote,
	counterClosedMessage,
	resolveStoreAvailability,
	type StoreAvailability,
	takesBuyerOrders,
	takesCounterOrders,
	unavailableMessage,
} from "./lib/storeAvailability";
import { assertSubscriptionActive } from "./subscriptions";

export async function loadAvailabilityRow(
	ctx: QueryCtx,
	retailerId: Id<"retailers">,
): Promise<Doc<"storeAvailability"> | null> {
	return ctx.db
		.query("storeAvailability")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
		.first();
}

/** The resolved state for one store — hold stamp + availability row. */
export async function storeAvailabilityOf(
	ctx: QueryCtx,
	retailer: Doc<"retailers">,
): Promise<StoreAvailability> {
	return resolveStoreAvailability({
		holdPausedAt: retailer.orderingPausedAt,
		row: await loadAvailabilityRow(ctx, retailer._id),
	});
}

/**
 * Every BUYER order door calls this (storefront checkout, event RSVP, booking
 * request, claim link commit + send). The refusal is the same sentence the
 * storefront banner shows. `storeAvailabilityCoverage.test.ts` fails if a door
 * that inserts an order stops calling it.
 */
export async function assertTakesBuyerOrders(
	ctx: QueryCtx,
	retailer: Doc<"retailers">,
): Promise<void> {
	const availability = await storeAvailabilityOf(ctx, retailer);
	if (!takesBuyerOrders(availability))
		throw new ConvexError(unavailableMessage(availability, retailer.storeName));
}

/** The COUNTER's door — open under the seller's own pause (they paused
 * online orders, not their till), closed by a hold or any admin switch.
 * `audience` is REQUIRED because the door is reached from both sides of the
 * counter: the seller ringing up or sending a claim link gets the seller's
 * sentence (who closed it, and the way back); a buyer committing a claim gets
 * the storefront's. */
export async function assertTakesCounterOrders(
	ctx: QueryCtx,
	retailer: Doc<"retailers">,
	audience: "seller" | "buyer",
): Promise<void> {
	const availability = await storeAvailabilityOf(ctx, retailer);
	if (takesCounterOrders(availability)) return;
	throw new ConvexError(
		audience === "seller"
			? counterClosedMessage(availability)
			: unavailableMessage(availability, retailer.storeName),
	);
}

/** Every store Kedaipal has taken OFFLINE — for the directory and the
 * sitemaps, which walk all stores. The table only holds stores that ever
 * used a switch, so one read of it beats a per-store lookup. */
export async function offlineStoreIds(ctx: QueryCtx): Promise<Set<string>> {
	const rows = await ctx.db.query("storeAvailability").collect();
	return new Set(
		rows.filter((r) => r.adminMode === "offline").map((r) => r.retailerId),
	);
}

/**
 * The resolver for a walk over MANY stores (the /stores directory): the
 * availability table is read ONCE and each store resolves from it in memory,
 * instead of an indexed read per store on top of a full read for the offline
 * filter (PR #369 review). Same answer as `storeAvailabilityOf`.
 */
export async function availabilityResolver(
	ctx: QueryCtx,
): Promise<(retailer: Doc<"retailers">) => StoreAvailability> {
	const rows = new Map(
		(await ctx.db.query("storeAvailability").collect()).map((r) => [
			r.retailerId as string,
			r,
		]),
	);
	return (retailer) =>
		resolveStoreAvailability({
			holdPausedAt: retailer.orderingPausedAt,
			row: rows.get(retailer._id),
		});
}

/**
 * Is this store OFFLINE (Kedaipal took it down)? For the public catalogue
 * reads — product list, product page, category rail and page, the popular
 * shelf — which answer empty for an offline store, so "no catalogue" holds
 * for a direct Convex call too, not just for the routes that gate on
 * `getRetailerBySlug` first (PR #369 review). One indexed read; offline is
 * admin-only state, so the retailer row isn't needed. Paused stores keep
 * their catalogue: buyers can still browse.
 */
export async function isStoreOffline(
	ctx: QueryCtx,
	retailerId: Id<"retailers">,
): Promise<boolean> {
	return (await loadAvailabilityRow(ctx, retailerId))?.adminMode === "offline";
}

/** The seller's switch: "Accepting orders" on or off, with an optional note
 * buyers see on the paused banner. Never touches billing. */
export const setAcceptingOrders = mutation({
	args: {
		retailerId: v.id("retailers"),
		accepting: v.boolean(),
		note: v.optional(v.string()),
	},
	handler: async (ctx, { retailerId, accepting, note }): Promise<void> => {
		const access = await requireRetailerAccess(ctx, retailerId, {
			area: "store_settings",
			level: "write",
		});
		if (!access.actingAsAdmin) {
			await assertSubscriptionActive(ctx, retailerId);
		}
		const row = await loadAvailabilityRow(ctx, retailerId);
		// Disabled-with-reason in the UI; refused here for a stale tab. A
		// seller switch under an admin one would read "open" and do nothing.
		if (row?.adminMode !== undefined)
			throw new ConvexError(
				"Kedaipal has switched this store off, so its ordering can't be changed from here. Contact us to reopen.",
			);
		const now = Date.now();
		const patch = accepting
			? { sellerPausedAt: undefined, sellerPauseNote: undefined, updatedAt: now }
			: {
					sellerPausedAt: row?.sellerPausedAt ?? now,
					sellerPauseNote: cleanAvailabilityNote(note),
					updatedAt: now,
				};
		if (row) await ctx.db.patch(row._id, patch);
		else if (!accepting)
			await ctx.db.insert("storeAvailability", { retailerId, ...patch });
		await logAdminAction(
			ctx,
			access,
			accepting ? "storeAvailability.resume" : "storeAvailability.pause",
			retailerId,
		);
	},
});

/** What the dashboard shows: the resolved state, plus the seller's own note
 * (the card's field) and Kedaipal's note to the seller when an admin switched
 * the store off. Every teammate sees the banner — a paused store is
 * everyone's business. */
export const forSeller = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }) => {
		const access = await requireRetailerAccess(ctx, retailerId, {
			anyMember: true,
		});
		const row = await loadAvailabilityRow(ctx, retailerId);
		const availability = resolveStoreAvailability({
			holdPausedAt: access.retailer.orderingPausedAt,
			row,
		});
		return {
			availability,
			sellerPaused: row?.sellerPausedAt !== undefined,
			sellerPauseNote: row?.sellerPauseNote,
			sellerPausedAt: row?.sellerPausedAt,
			adminMode: row?.adminMode,
			adminNote: row?.adminNote,
		};
	},
});
