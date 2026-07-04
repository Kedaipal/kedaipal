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
import { linkOrderToCustomer, refreshWaProfileName } from "./customers";
import { stampRetailerActivation } from "./lib/activation";
import {
	adminUserIds,
	logAdminAction,
	type RetailerAccess,
	requireRetailerAccess,
} from "./lib/auth";
import { getDisplayName } from "./lib/customer";
import { assertValidFulfilmentDate } from "./lib/fulfilmentDate";
import {
	computeOrderTotals,
	generateShortId,
	generateTrackingToken,
} from "./lib/order";
import { orderPaymentMethodValidator } from "./lib/paymentMethod";
import { rateLimiter } from "./lib/rateLimiter";
import { assertValidWaPhone } from "./lib/slug";
import { variantLabel } from "./lib/variant";
import { type Locale, pickLocale } from "./lib/whatsappCopy";

/** A counter session lives this long before it expires unscanned (QR window). */
export const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes
/**
 * Once a buyer is bound, the session is a seller-owned in-progress order, so it
 * lives much longer — the vendor can juggle several customers and come back. The
 * window slides on every draft edit; abandoned ones are swept by the cron so the
 * "open checkouts" list stays clean.
 */
export const OPEN_SESSION_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days idle

const MAX_COUNTER_ITEMS = 100;
const SHORT_ID_RETRIES = 3;

/**
 * The `wa.me` deep link the buyer scans. Built server-side from the shared WABA
 * number (`WHATSAPP_CHECKOUT_PHONE`) so the dashboard only has to render the QR —
 * the number never has to round-trip through the client. Undefined if the env
 * var is unset (the UI then shows a "messaging not configured" state).
 */
function buildCheckoutWaUrl(token: string): string | undefined {
	const phone = process.env.WHATSAPP_CHECKOUT_PHONE;
	if (!phone) return undefined;
	// A warm, first-person message the buyer sends by tapping the QR — nicer than a
	// bare token. The `KP-<token>` ref is the only load-bearing part (the inbound
	// intent router scans for it anywhere in the text, so the surrounding prose is
	// harmless); everything else is just human framing. There's no order number
	// yet — the order is created after the buyer binds — so the ref *is* the token.
	// URL-encoded because the message now carries spaces + emoji.
	const text = `Hi! 👋 I'd like to check out at the counter.\n\nMy order ref: KP-${token}`;
	return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

/**
 * Resolve the target retailer for a counter-checkout op. With an explicit
 * `retailerId` it's the admin act-as path (owner-or-admin, so a Kedaipal admin
 * can run Counter Checkout for a seller during white-glove); otherwise it's the
 * caller's own store (strict 1:1 user↔retailer). Returns the access descriptor
 * so admin-on-behalf writes are attributable. See docs/admin-console.md.
 */
async function requireCounterRetailer(
	ctx: QueryCtx | MutationCtx,
	retailerId?: Id<"retailers">,
): Promise<RetailerAccess> {
	if (retailerId) return requireRetailerAccess(ctx, retailerId);
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new ConvexError("Not authenticated");
	const retailer = await ctx.db
		.query("retailers")
		.withIndex("by_user", (q) => q.eq("userId", identity.subject))
		.unique();
	if (!retailer) throw new ConvexError("No store found for this account");
	return { retailer, actingAsAdmin: false, userId: identity.subject };
}

/**
 * Access to an existing session by id: the caller must own the session's retailer
 * OR be a Kedaipal admin acting-as. Returns the session + access. Returns null
 * when the session is gone (callers decide throw-vs-null per their contract).
 */
async function requireSessionAccess(
	ctx: QueryCtx | MutationCtx,
	sessionId: Id<"counterCheckoutSessions">,
): Promise<{ session: Doc<"counterCheckoutSessions">; access: RetailerAccess } | null> {
	const session = await ctx.db.get(sessionId);
	if (!session) return null;
	const access = await requireRetailerAccess(ctx, session.retailerId);
	return { session, access };
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
	// Both the unscanned QR window (awaiting_buyer) and the idle window of a
	// bound, in-progress order (buyer_identified) read as expired once past their
	// expiry, even if the cleanup cron hasn't flipped the row yet.
	if (
		(session.status === "awaiting_buyer" ||
			session.status === "buyer_identified") &&
		now > session.expiresAt
	)
		return "expired";
	return session.status;
}

/**
 * Seller opens a counter session. Returns the token (the dashboard builds the
 * `wa.me?text=KP-<token>` QR from it) + the session id to subscribe to.
 */
export const createCheckoutSession = mutation({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{
		sessionId: Id<"counterCheckoutSessions">;
		token: string;
		waUrl: string | undefined;
		expiresAt: number;
	}> => {
		const access = await requireCounterRetailer(ctx, retailerId);
		const retailer = access.retailer;
		await rateLimiter.limit(ctx, "checkoutSessionCreate", {
			key: retailer.userId,
			throws: true,
		});

		const now = Date.now();
		const expiresAt = now + SESSION_TTL_MS;
		const token = generateTrackingToken();
		const sessionId = await ctx.db.insert("counterCheckoutSessions", {
			retailerId: retailer._id,
			// The SELLER's userId (never the acting admin's) so the inbound-webhook
			// buyer binding + buyer confirmation still resolve to the right store.
			sellerUserId: retailer.userId,
			token,
			status: "awaiting_buyer",
			expiresAt,
			createdAt: now,
			updatedAt: now,
		});
		await logAdminAction(
			ctx,
			access,
			"counterCheckout.createCheckoutSession",
			sessionId,
		);
		return { sessionId, token, waUrl: buildCheckoutWaUrl(token), expiresAt };
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
		token: string;
		waUrl: string | undefined;
		waPhone: string | undefined;
		displayName: string | undefined;
		isNewCustomer: boolean | undefined;
		orderId: Id<"orders"> | undefined;
		// Lifetime history for a returning customer (null for new/anonymous).
		customer: { orderCount: number; totalSpent: number; lastOrderAt: number } | null;
		// Autosaved in-progress order, so a resume restores the cart + selections.
		draft: Doc<"counterCheckoutSessions">["draft"];
	} | null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new ConvexError("Not authenticated");
		const session = await ctx.db.get(sessionId);
		if (!session) return null;
		const retailer = await ctx.db.get(session.retailerId);
		// Not-found and not-owned both resolve to null (not a throw): the active
		// session id is now URL-addressable, so a stale/foreign id must degrade to
		// the friendly "checkout not found" screen, never an unhandled crash. null
		// also avoids leaking whether another store's session exists. Owner OR a
		// Kedaipal admin acting-as may read it.
		if (
			!retailer ||
			(retailer.userId !== identity.subject &&
				!adminUserIds().includes(identity.subject))
		)
			return null;

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
			token: session.token,
			waUrl: buildCheckoutWaUrl(session.token),
			waPhone: session.waPhone,
			displayName,
			isNewCustomer: session.isNewCustomer,
			orderId: session.orderId,
			customer,
			draft: session.draft,
		};
	},
});

const draftValidator = v.object({
	items: v.array(
		v.object({
			variantId: v.id("productVariants"),
			quantity: v.number(),
			unitPrice: v.optional(v.number()),
		}),
	),
	fulfilmentDate: v.optional(v.number()),
	paidInPerson: v.optional(v.boolean()),
	paymentMethod: v.optional(orderPaymentMethodValidator),
});

/**
 * Autosave the seller's in-progress order onto a bound session (debounced from
 * the client). Owner-only; only valid while the session is buyer_identified.
 * Slides the idle expiry so an actively-edited checkout never expires under the
 * vendor. Price/stock are NOT validated here — that happens authoritatively at
 * createOrderFromSession; this is a best-effort scratchpad.
 */
export const saveSessionDraft = mutation({
	args: {
		sessionId: v.id("counterCheckoutSessions"),
		draft: draftValidator,
	},
	handler: async (ctx, { sessionId, draft }): Promise<void> => {
		const resolved = await requireSessionAccess(ctx, sessionId);
		if (!resolved) throw new ConvexError("Session not found");
		const { session } = resolved;
		if (session.status !== "buyer_identified")
			throw new ConvexError("This checkout isn't open for editing");

		// Drop junk lines (non-positive / non-integer qty) and cap the count so a
		// rogue client can't bloat the row. Authoritative validation is at create.
		const items = draft.items
			.filter((i) => Number.isInteger(i.quantity) && i.quantity >= 1)
			.slice(0, MAX_COUNTER_ITEMS);

		const now = Date.now();
		await ctx.db.patch(sessionId, {
			draft: { ...draft, items },
			expiresAt: now + OPEN_SESSION_TTL_MS, // slide the idle window
			updatedAt: now,
		});
	},
});

/**
 * All of the retailer's OPEN counter checkouts — the unscanned QRs
 * (awaiting_buyer) plus the in-progress, buyer-bound orders (buyer_identified) —
 * so the seller can juggle several customers at once and resume any of them.
 * Effectively-expired rows are filtered out even before the cron sweeps them.
 * Owner-only. Item count comes straight off the draft (no per-variant lookups).
 */
export const listOpenSessions = query({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<
		Array<{
			sessionId: Id<"counterCheckoutSessions">;
			status: "awaiting_buyer" | "buyer_identified";
			displayName: string | undefined;
			isNewCustomer: boolean | undefined;
			itemCount: number;
			createdAt: number;
			boundAt: number | undefined;
			expiresAt: number;
		}>
	> => {
		const { retailer } = await requireCounterRetailer(ctx, retailerId);
		const now = Date.now();
		const out: Array<{
			sessionId: Id<"counterCheckoutSessions">;
			status: "awaiting_buyer" | "buyer_identified";
			displayName: string | undefined;
			isNewCustomer: boolean | undefined;
			itemCount: number;
			createdAt: number;
			boundAt: number | undefined;
			expiresAt: number;
		}> = [];

		for (const status of ["awaiting_buyer", "buyer_identified"] as const) {
			const rows = await ctx.db
				.query("counterCheckoutSessions")
				.withIndex("by_retailer_status", (q) =>
					q.eq("retailerId", retailer._id).eq("status", status),
				)
				.collect();
			for (const s of rows) {
				if (effectiveStatus(s, now) === "expired") continue;

				let displayName: string | undefined;
				if (s.customerId) {
					const c = await ctx.db.get(s.customerId);
					if (c) displayName = getDisplayName(c);
				} else if (s.waPhone || s.waProfileName) {
					displayName = getDisplayName({
						waProfileName: s.waProfileName,
						waPhone: s.waPhone ?? "",
					});
				}

				out.push({
					sessionId: s._id,
					status,
					displayName,
					isNewCustomer: s.isNewCustomer,
					itemCount: (s.draft?.items ?? []).reduce((n, i) => n + i.quantity, 0),
					createdAt: s.createdAt,
					boundAt: s.boundAt,
					expiresAt: s.expiresAt,
				});
			}
		}

		// Most recently active first: bound orders by boundAt, unscanned by createdAt.
		out.sort((a, b) => (b.boundAt ?? b.createdAt) - (a.boundAt ?? a.createdAt));
		return out;
	},
});

/**
 * Seller confirms the order keyed off a bound session. Resolves catalog variants
 * server-side (price + stock are NEVER trusted from the client), creates a
 * confirmed self-collect order linked to the bound buyer, optionally marks it
 * paid-in-person (cash / DuitNow-now), refreshes the customer aggregates, and
 * completes the session. Then sends the buyer a WhatsApp confirmation with their
 * tracking link — their KP scan opened the 24h CS window, so free-form is allowed.
 */
export const createOrderFromSession = mutation({
	args: {
		sessionId: v.id("counterCheckoutSessions"),
		items: v.array(
			v.object({
				variantId: v.id("productVariants"),
				quantity: v.number(),
				// Vendor-entered unit price (sen) — REQUIRED for a custom/quote line
				// (whose catalog price is 0; price is agreed in person), IGNORED for a
				// normal line (which always uses the authoritative variant price, so a
				// tampered client can't reprice a fixed product). Validated as a
				// positive integer, no upper cap (same rule as any product price).
				unitPrice: v.optional(v.number()),
			}),
		),
		// Settled at the counter. When false the order is left unpaid and the buyer
		// can still pay later via their tracking link.
		paidInPerson: v.boolean(),
		// How it was settled — only meaningful when paidInPerson. Defaults to cash.
		paymentMethod: v.optional(orderPaymentMethodValidator),
		// When the buyer collects — epoch-ms of a MYT-midnight day. Optional (a
		// walk-in collecting now leaves it unset). The seller is keying this in
		// person, so it's validated against a 0-day notice (today always allowed),
		// ignoring the storefront buyer-notice setting. See convex/lib/fulfilmentDate.ts.
		fulfilmentDate: v.optional(v.number()),
	},
	handler: async (
		ctx,
		args,
	): Promise<{ shortId: string; orderId: Id<"orders"> }> => {
		const resolved = await requireSessionAccess(ctx, args.sessionId);
		if (!resolved) throw new ConvexError("Session not found");
		const { session, access } = resolved;
		const retailer = access.retailer;
		if (session.status !== "buyer_identified")
			throw new ConvexError(
				"Bind a buyer to this checkout before creating the order",
			);
		if (!session.waPhone) throw new ConvexError("This session has no buyer phone");
		if (args.items.length === 0) throw new ConvexError("Add at least one item");
		if (args.items.length > MAX_COUNTER_ITEMS)
			throw new ConvexError(`Maximum ${MAX_COUNTER_ITEMS} items per order`);

		let sanitizedFulfilmentDate: number | undefined;
		if (args.fulfilmentDate !== undefined) {
			try {
				// Notice 0: the seller is at the counter, so today is always valid
				// regardless of the storefront buyer-notice setting.
				sanitizedFulfilmentDate = assertValidFulfilmentDate(
					args.fulfilmentDate,
					0,
				);
			} catch (err) {
				throw new ConvexError((err as Error).message);
			}
		}

		const currency = retailer.currency ?? "MYR";
		const now = Date.now();

		// Resolve variants server-side — price + stock are authoritative here.
		const snapshotItems: {
			productId: Id<"products">;
			variantId: Id<"productVariants">;
			name: string;
			variantLabel?: string;
			price: number;
			quantity: number;
		}[] = [];
		const requestedByVariant = new Map<
			Id<"productVariants">,
			{ qty: number; block: boolean; onHand: number }
		>();
		for (const item of args.items) {
			if (!Number.isInteger(item.quantity) || item.quantity < 1)
				throw new ConvexError("Quantity must be a positive integer");
			const variant = await ctx.db.get(item.variantId);
			if (!variant || variant.retailerId !== retailer._id)
				throw new ConvexError("Item not found");
			const product = await ctx.db.get(variant.productId);
			if (!product) throw new ConvexError("Product not found");
			const label = variant.isCustom
				? (variant.customLabel ?? "Custom")
				: variantLabel(variant.optionValues);
			const displayName = label ? `${product.name} (${label})` : product.name;
			if (!product.active || !variant.active)
				throw new ConvexError(`"${displayName}" is not available`);
			// Made-to-order items (custom / mockup-gated) ARE sellable at the counter:
			// the buyer is present, so design + price are agreed in person and the
			// storefront's mockup-approval round-trip is moot. Counter orders are
			// created `confirmed` with no mockup gate. A CUSTOM (quote) line carries
			// no catalog price, so the vendor supplies it; everything else stays on
			// the authoritative variant price. See docs/custom-option.md.
			let unitPrice: number;
			if (variant.isCustom === true) {
				// A positive integer in sen — the SAME rule as any other price
				// (products.ts). No artificial ceiling: we can't know the vendor's
				// business (watches, renovations, B2B services can run six figures+),
				// and the price is the vendor's own call with the buyer present.
				const entered = item.unitPrice;
				if (
					entered === undefined ||
					!Number.isInteger(entered) ||
					entered <= 0
				)
					throw new ConvexError(`Set a price for "${displayName}"`);
				unitPrice = entered;
			} else {
				unitPrice = variant.price;
			}
			const block =
				(variant.blockWhenOutOfStock ?? product.blockWhenOutOfStock) === true;
			const prior = requestedByVariant.get(item.variantId);
			const newQty = (prior?.qty ?? 0) + item.quantity;
			if (block && variant.onHand < newQty)
				throw new ConvexError(`Only ${variant.onHand} of "${displayName}" in stock`);
			requestedByVariant.set(item.variantId, {
				qty: newQty,
				block,
				onHand: variant.onHand,
			});
			snapshotItems.push({
				productId: variant.productId,
				variantId: item.variantId,
				name: product.name,
				variantLabel: label || undefined,
				price: unitPrice,
				quantity: item.quantity,
			});
		}

		const { subtotal, total } = computeOrderTotals(snapshotItems);

		// Reserve stock for hard-block variants (same OCC transaction).
		for (const [variantId, { qty, block, onHand }] of requestedByVariant) {
			if (!block) continue;
			await ctx.db.patch(variantId, { onHand: onHand - qty, updatedAt: now });
		}

		// Collision-safe shortId.
		let shortId: string | null = null;
		for (let i = 0; i < SHORT_ID_RETRIES; i++) {
			const candidate = generateShortId();
			const clash = await ctx.db
				.query("orders")
				.withIndex("by_shortId", (q) => q.eq("shortId", candidate))
				.first();
			if (!clash) {
				shortId = candidate;
				break;
			}
		}
		if (!shortId)
			throw new ConvexError("Failed to generate order ID, please retry");

		const customerName = session.waProfileName;
		const orderId = await ctx.db.insert("orders", {
			retailerId: retailer._id,
			shortId,
			trackingToken: generateTrackingToken(),
			items: snapshotItems,
			subtotal,
			total,
			currency,
			status: "confirmed", // seller-created with the buyer present
			channel: "whatsapp",
			customer: { name: customerName, waPhone: session.waPhone },
			deliveryMethod: "self_collect", // collected at the counter
			fulfilmentDate: sanitizedFulfilmentDate,
			paymentStatus: args.paidInPerson ? "received" : "unpaid",
			paymentReceivedAt: args.paidInPerson ? now : undefined,
			paymentMethod: args.paidInPerson
				? (args.paymentMethod ?? "cash")
				: undefined,
			statusChangedAt: now,
			createdAt: now,
			updatedAt: now,
		});

		await ctx.db.insert("orderEvents", {
			orderId,
			status: "confirmed",
			note: "counter_checkout",
			createdAt: now,
		});
		if (args.paidInPerson) {
			await ctx.db.insert("orderEvents", {
				orderId,
				status: "confirmed",
				note: `payment_received: in-person (${args.paymentMethod ?? "cash"})`,
				createdAt: now,
			});
		}

		// Counter orders are born confirmed (seller + buyer present), so this is a
		// real first order — activate the store (one-time stamp).
		await stampRetailerActivation(ctx, retailer._id, now);

		// Link customer aggregates (creates the row for a brand-new buyer).
		await linkOrderToCustomer(ctx, {
			retailerId: retailer._id,
			waPhone: session.waPhone,
			orderId,
			orderTotal: total,
			orderCreatedAt: now,
			customerName,
		});

		await ctx.db.patch(session._id, {
			status: "completed",
			orderId,
			updatedAt: now,
		});

		// Buyer confirmation + tracking link over WhatsApp.
		await ctx.scheduler.runAfter(
			0,
			internal.whatsapp.notifyCounterOrderCreated,
			{ orderId },
		);

		await logAdminAction(
			ctx,
			access,
			"counterCheckout.createOrderFromSession",
			orderId,
		);
		return { shortId, orderId };
	},
});

/** Seller dismisses an active session (status → cancelled). Ownership-checked. */
export const cancelCheckoutSession = mutation({
	args: { sessionId: v.id("counterCheckoutSessions") },
	handler: async (ctx, { sessionId }): Promise<void> => {
		const resolved = await requireSessionAccess(ctx, sessionId);
		if (!resolved) throw new ConvexError("Session not found");
		const { session, access } = resolved;
		if (session.status === "awaiting_buyer" || session.status === "buyer_identified") {
			await ctx.db.patch(sessionId, {
				status: "cancelled",
				updatedAt: Date.now(),
			});
			await logAdminAction(
				ctx,
				access,
				"counterCheckout.cancelCheckoutSession",
				sessionId,
			);
		}
	},
});

/** Outcome of an inbound `KP-<token>` bind attempt (drives the buyer reply).
 * `locale` (the store's, for a localized reply) rides along on every outcome that
 * resolved a retailer; `not_found` has no retailer, so the caller defaults to en. */
export type BindResult =
	| {
			result: "bound";
			retailerId: Id<"retailers">;
			storeName: string;
			displayName: string;
			locale: Locale;
	  }
	| { result: "expired"; storeName: string; locale: Locale }
	| { result: "already_used"; storeName: string; locale: Locale }
	| { result: "not_found" };

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
		const locale = pickLocale(retailer?.locale);

		const now = Date.now();
		// Expiry takes precedence over the generic status check so a buyer always
		// gets the "expired" message for a stale QR — whether they scan before the
		// cron sweeps it (status still awaiting_buyer, past TTL) or after (status
		// already flipped to "expired"). Otherwise the timing of the 5-min cron
		// would flip the buyer-facing message between "expired" and a generic reply.
		const isExpired =
			session.status === "expired" ||
			(session.status === "awaiting_buyer" && now > session.expiresAt);
		if (isExpired) {
			if (session.status === "awaiting_buyer")
				await ctx.db.patch(session._id, { status: "expired", updatedAt: now });
			return { result: "expired", storeName, locale };
		}

		// Single-use: any other non-awaiting status (buyer_identified / completed /
		// cancelled) is a replay of a used session — ignored.
		if (session.status !== "awaiting_buyer")
			return { result: "already_used", storeName, locale };

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
			// Promote to the long idle window now that it's a real in-progress order.
			expiresAt: now + OPEN_SESSION_TTL_MS,
			updatedAt: now,
		});

		const displayName = existing
			? getDisplayName(existing)
			: getDisplayName({ waProfileName: trimmedPushname, waPhone: normalizedPhone });
		return {
			result: "bound",
			retailerId: session.retailerId,
			storeName,
			displayName,
			locale,
		};
	},
});

/**
 * Cron: flip `awaiting_buyer` sessions past their TTL to `expired`. Reads compute
 * effective expiry already (effectiveStatus), so this is housekeeping — it keeps
 * stale rows out of "active session" listings. Batched + self-scheduling.
 */
export const expireStaleSessions = internalMutation({
	args: {
		// Which open status to sweep this pass. The cron kicks off with the default
		// (awaiting_buyer = unscanned QR window); when that's done it chains to
		// buyer_identified (the 3-day idle window for in-progress orders).
		status: v.optional(
			v.union(
				v.literal("awaiting_buyer"),
				v.literal("buyer_identified"),
			),
		),
		cursor: v.optional(v.union(v.string(), v.null())),
	},
	handler: async (ctx, { status, cursor }) => {
		const sweepStatus = status ?? "awaiting_buyer";
		const now = Date.now();
		const page = await ctx.db
			.query("counterCheckoutSessions")
			.withIndex("by_status_expiry", (q) =>
				q.eq("status", sweepStatus).lt("expiresAt", now),
			)
			.paginate({ numItems: 100, cursor: cursor ?? null });

		for (const session of page.page) {
			await ctx.db.patch(session._id, { status: "expired", updatedAt: now });
		}

		if (!page.isDone) {
			await ctx.scheduler.runAfter(
				0,
				internal.counterCheckout.expireStaleSessions,
				{ status: sweepStatus, cursor: page.continueCursor },
			);
		} else if (sweepStatus === "awaiting_buyer") {
			// Chain to the bound-session idle sweep once the QR window is cleared.
			await ctx.scheduler.runAfter(
				0,
				internal.counterCheckout.expireStaleSessions,
				{ status: "buyer_identified", cursor: null },
			);
		}
		return { status: sweepStatus, expired: page.page.length, isDone: page.isDone };
	},
});
