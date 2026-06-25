/**
 * Counter Checkout — the in-person order spine (ClickUp 86ey0e82j, docs/counter-checkout.md).
 *
 * A seller opens Counter Checkout → `createCheckoutSession` mints an unguessable,
 * single-use, short-TTL `token`; the dashboard renders a QR of
 * `wa.me/<shared_WABA>?text=KP-<token>`. The buyer scans + sends, the inbound
 * webhook's intent router (convex/lib/inboundIntent.ts) spots `KP-<token>` and
 * calls `bindCheckoutSession`, which ties the buyer's WhatsApp identity to the
 * session. The seller's dashboard `useQuery(getCheckoutSession)` flips live
 * (Convex reactive — no polling).
 *
 * Security (mirrors the order tracking-token hardening, ticket 86ey1fggw):
 *   - token is high-entropy (`generateTrackingToken`, ~142 bits) — unguessable.
 *   - single-use: a bind only succeeds while `awaiting_buyer`; a second scan of
 *     the same token is ignored (replay-safe).
 *   - short TTL: a session expires ~10 min after creation if no scan arrives.
 *   - session creation is rate-limited per seller.
 */

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalMutation,
	mutation,
	type MutationCtx,
	type QueryCtx,
	query,
} from "./_generated/server";
import { refreshWaProfileName } from "./customers";
import { getDisplayName } from "./lib/customer";
import { generateTrackingToken } from "./lib/order";
import { rateLimiter } from "./lib/rateLimiter";
import { assertValidWaPhone } from "./lib/slug";

/** A counter session lives this long before it expires unscanned. */
export const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Resolve the authenticated seller's own retailer (strict 1:1 user↔retailer). */
async function requireOwnRetailer(
	ctx: QueryCtx | MutationCtx,
): Promise<Doc<"retailers">> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new ConvexError("Not authenticated");
	const retailer = await ctx.db
		.query("retailers")
		.withIndex("by_user", (q) => q.eq("userId", identity.subject))
		.unique();
	if (!retailer) throw new ConvexError("No store found for this account");
	return retailer;
}

/**
 * The session's status as the buyer/seller should see it RIGHT NOW. A session
 * past its TTL reads as `expired` even if the cleanup cron hasn't flipped the
 * row yet — so the UI never shows "waiting" for a dead session.
 */
function effectiveStatus(
	session: Doc<"counterCheckoutSessions">,
	now: number,
): Doc<"counterCheckoutSessions">["status"] {
	if (session.status === "awaiting_buyer" && now > session.expiresAt)
		return "expired";
	return session.status;
}

/**
 * Seller opens a counter session. Returns the token (the dashboard builds the
 * `wa.me?text=KP-<token>` QR from it) + the session id to subscribe to.
 */
export const createCheckoutSession = mutation({
	args: {},
	handler: async (
		ctx,
	): Promise<{ sessionId: Id<"counterCheckoutSessions">; token: string; expiresAt: number }> => {
		const retailer = await requireOwnRetailer(ctx);
		await rateLimiter.limit(ctx, "checkoutSessionCreate", {
			key: retailer.userId,
			throws: true,
		});

		const now = Date.now();
		const expiresAt = now + SESSION_TTL_MS;
		const token = generateTrackingToken();
		const sessionId = await ctx.db.insert("counterCheckoutSessions", {
			retailerId: retailer._id,
			sellerUserId: retailer.userId,
			token,
			status: "awaiting_buyer",
			expiresAt,
			createdAt: now,
			updatedAt: now,
		});
		return { sessionId, token, expiresAt };
	},
});

/**
 * Reactive read for the seller's Counter Checkout screen. Flips live from
 * `awaiting_buyer` → `buyer_identified` (with the buyer's name + history) the
 * instant the webhook binds the scan. Ownership-checked.
 */
export const getCheckoutSession = query({
	args: { sessionId: v.id("counterCheckoutSessions") },
	handler: async (
		ctx,
		{ sessionId },
	): Promise<{
		status: Doc<"counterCheckoutSessions">["status"];
		expiresAt: number;
		waPhone: string | undefined;
		displayName: string | undefined;
		isNewCustomer: boolean | undefined;
		orderId: Id<"orders"> | undefined;
		// Lifetime history for a returning customer (null for new/anonymous).
		customer: { orderCount: number; totalSpent: number; lastOrderAt: number } | null;
	} | null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new ConvexError("Not authenticated");
		const session = await ctx.db.get(sessionId);
		if (!session) return null;
		const retailer = await ctx.db.get(session.retailerId);
		if (!retailer || retailer.userId !== identity.subject)
			throw new ConvexError("Forbidden");

		let displayName: string | undefined;
		let customer: { orderCount: number; totalSpent: number; lastOrderAt: number } | null =
			null;
		if (session.customerId) {
			const c = await ctx.db.get(session.customerId);
			if (c) {
				displayName = getDisplayName(c);
				customer = {
					orderCount: c.orderCount,
					totalSpent: c.totalSpent,
					lastOrderAt: c.lastOrderAt,
				};
			}
		} else if (session.waPhone || session.waProfileName) {
			// New buyer — no customer row yet; name resolves pushname → phone.
			displayName = getDisplayName({
				waProfileName: session.waProfileName,
				waPhone: session.waPhone ?? "",
			});
		}

		return {
			status: effectiveStatus(session, Date.now()),
			expiresAt: session.expiresAt,
			waPhone: session.waPhone,
			displayName,
			isNewCustomer: session.isNewCustomer,
			orderId: session.orderId,
			customer,
		};
	},
});

/** Seller dismisses an active session (status → cancelled). Ownership-checked. */
export const cancelCheckoutSession = mutation({
	args: { sessionId: v.id("counterCheckoutSessions") },
	handler: async (ctx, { sessionId }): Promise<void> => {
		const retailer = await requireOwnRetailer(ctx);
		const session = await ctx.db.get(sessionId);
		if (!session) throw new ConvexError("Session not found");
		if (session.retailerId !== retailer._id)
			throw new ConvexError("Forbidden");
		if (session.status === "awaiting_buyer" || session.status === "buyer_identified") {
			await ctx.db.patch(sessionId, {
				status: "cancelled",
				updatedAt: Date.now(),
			});
		}
	},
});

/** Outcome of an inbound `KP-<token>` bind attempt (drives the buyer reply). */
export type BindResult =
	| { result: "bound"; storeName: string; displayName: string }
	| { result: "expired"; storeName: string }
	| { result: "not_found" }
	| { result: "already_used" };

/**
 * Internal: bind an inbound buyer (phone + pushname) to the session named by a
 * `KP-<token>` message. Called from the WhatsApp webhook handler. Single-use +
 * TTL-guarded + replay-safe. Resolves an EXISTING customer for the live history
 * panel; a brand-new buyer is bound by phone/pushname only (the customer row is
 * created later by the order-creation path).
 */
export const bindCheckoutSession = internalMutation({
	args: {
		token: v.string(),
		waPhone: v.string(),
		profileName: v.optional(v.string()),
	},
	handler: async (ctx, { token, waPhone, profileName }): Promise<BindResult> => {
		const session = await ctx.db
			.query("counterCheckoutSessions")
			.withIndex("by_token", (q) => q.eq("token", token))
			.unique();
		if (!session) return { result: "not_found" };

		const retailer = await ctx.db.get(session.retailerId);
		const storeName = retailer?.storeName ?? "the store";

		// Single-use: only an awaiting session binds. A second scan (already bound,
		// completed, cancelled) is ignored — replay-safe.
		if (session.status !== "awaiting_buyer") return { result: "already_used" };

		const now = Date.now();
		if (now > session.expiresAt) {
			await ctx.db.patch(session._id, { status: "expired", updatedAt: now });
			return { result: "expired", storeName };
		}

		// Normalize the inbound phone the same way the order flow does.
		let normalizedPhone: string;
		try {
			normalizedPhone = assertValidWaPhone(waPhone);
		} catch {
			normalizedPhone = waPhone; // fall back to raw; binding is best-effort
		}

		// Resolve an existing customer (for the returning-customer history panel).
		const existing = await ctx.db
			.query("customers")
			.withIndex("by_retailer_phone", (q) =>
				q.eq("retailerId", session.retailerId).eq("waPhone", normalizedPhone),
			)
			.unique();

		const trimmedPushname = profileName?.trim() || undefined;
		if (existing && trimmedPushname) {
			await refreshWaProfileName(ctx, {
				customerId: existing._id,
				profileName: trimmedPushname,
			});
		}

		await ctx.db.patch(session._id, {
			status: "buyer_identified",
			customerId: existing?._id,
			waPhone: normalizedPhone,
			waProfileName: trimmedPushname,
			isNewCustomer: existing === null,
			boundAt: now,
			updatedAt: now,
		});

		const displayName = existing
			? getDisplayName(existing)
			: getDisplayName({ waProfileName: trimmedPushname, waPhone: normalizedPhone });
		return { result: "bound", storeName, displayName };
	},
});

/**
 * Cron: flip `awaiting_buyer` sessions past their TTL to `expired`. Reads compute
 * effective expiry already (effectiveStatus), so this is housekeeping — it keeps
 * stale rows out of "active session" listings. Batched + self-scheduling.
 */
export const expireStaleSessions = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, { cursor }) => {
		const now = Date.now();
		const page = await ctx.db
			.query("counterCheckoutSessions")
			.withIndex("by_status_expiry", (q) =>
				q.eq("status", "awaiting_buyer").lt("expiresAt", now),
			)
			.paginate({ numItems: 100, cursor: cursor ?? null });

		for (const session of page.page) {
			await ctx.db.patch(session._id, { status: "expired", updatedAt: now });
		}

		if (!page.isDone) {
			await ctx.scheduler.runAfter(
				0,
				internal.counterCheckout.expireStaleSessions,
				{ cursor: page.continueCursor },
			);
		}
		return { expired: page.page.length, isDone: page.isDone };
	},
});
