/**
 * Counter Checkout — the in-person order spine (ClickUp 86ey0e82j, docs/counter-checkout.md).
 *
 * ONE QR (86ey5neg6): the seller prints/shows their PERMANENT store QR
 * (`wa.me/<shared_WABA>?text=…KPS-<retailers.counterQrToken>…`). A walk-in buyer
 * scans + sends; the inbound webhook's intent router (convex/lib/inboundIntent.ts)
 * spots `KPS-<token>` and calls `startSessionFromStoreQr`, which creates a
 * `buyer_identified` session bound to the buyer + mints a short **pairing code**
 * (e.g. "K7") the buyer shows the cashier. The seller's dashboard
 * `useQuery(listOpenSessions)` flips live (Convex reactive — no polling); the
 * cashier picks the session by its pairing code and rings up the order.
 *
 * The older per-session `KP-<token>` flow (cashier-minted `createCheckoutSession`
 * → buyer-bound `bindCheckoutSession`) was removed — the static store QR fully
 * replaces it. See docs/counter-checkout.md + the "Store QR poster" section below.
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
import { recordOrderCreated } from "./subscriptionUsage";
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

/**
 * A walk-in session is a seller-owned in-progress order, so it lives a while —
 * the vendor can juggle several customers and come back. The window slides on
 * every draft edit; abandoned ones are swept by the cron so the "open checkouts"
 * list stays clean.
 */
export const OPEN_SESSION_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days idle

const MAX_COUNTER_ITEMS = 100;
const SHORT_ID_RETRIES = 3;

// Short buyer pairing code (e.g. "K7"): 1 letter + 1 digit, both from
// unambiguous alphabets (no I/O/0/1) so it reads cleanly off a phone at a
// counter. ~192 combos — plenty vs the ≤10 concurrent open sessions per store,
// and collisions are regenerated against the live set (generatePairingCode).
const PAIRING_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const PAIRING_DIGITS = "23456789";

function pairingCodeCandidate(): string {
	const bytes = new Uint8Array(2);
	crypto.getRandomValues(bytes);
	return (
		PAIRING_LETTERS[bytes[0] % PAIRING_LETTERS.length] +
		PAIRING_DIGITS[bytes[1] % PAIRING_DIGITS.length]
	);
}

/** A pairing code not currently in use by the store's open walk-in sessions. */
function generatePairingCode(taken: ReadonlySet<string>): string {
	for (let i = 0; i < 30; i++) {
		const code = pairingCodeCandidate();
		if (!taken.has(code)) return code;
	}
	// Astronomically unlikely (≤10 taken of 192); a rare duplicate is harmless.
	return pairingCodeCandidate();
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
 * Reactive read for the one checkout the cashier is currently building. A
 * walk-in session starts life `buyer_identified` (created by the store-QR scan),
 * so this drives the build screen + done screen. Ownership-checked.
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
 * All of the retailer's OPEN counter checkouts — the in-progress, buyer-bound
 * walk-in sessions (`buyer_identified`) — so the cashier can juggle several
 * customers at once and resume any of them by matching the buyer's pairing code.
 * Effectively-expired rows are filtered out even before the cron sweeps them.
 * Owner-or-admin. Item count comes straight off the draft (no per-variant lookups).
 */
export const listOpenSessions = query({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<
		Array<{
			sessionId: Id<"counterCheckoutSessions">;
			// Short code the buyer shows the cashier to be matched here (86ey5neg6).
			pairingCode: string | undefined;
			// Drives the "Walk-in scan" badge — see the store QR poster (86ey5m35w).
			origin: "cashier" | "store_qr";
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
		const rows = await ctx.db
			.query("counterCheckoutSessions")
			.withIndex("by_retailer_status", (q) =>
				q.eq("retailerId", retailer._id).eq("status", "buyer_identified"),
			)
			.collect();
		const out: Array<{
			sessionId: Id<"counterCheckoutSessions">;
			pairingCode: string | undefined;
			origin: "cashier" | "store_qr";
			displayName: string | undefined;
			isNewCustomer: boolean | undefined;
			itemCount: number;
			createdAt: number;
			boundAt: number | undefined;
			expiresAt: number;
		}> = [];

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
				pairingCode: s.pairingCode,
				origin: s.origin ?? "cashier",
				displayName,
				isNewCustomer: s.isNewCustomer,
				itemCount: (s.draft?.items ?? []).reduce((n, i) => n + i.quantity, 0),
				createdAt: s.createdAt,
				boundAt: s.boundAt,
				expiresAt: s.expiresAt,
			});
		}

		// Most recently active first.
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

		// Meter against the monthly usage nudge (SOFT cap, never a block) —
		// counter orders count like storefront ones.
		await recordOrderCreated(ctx, retailer._id, now);

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

// ---------------------------------------------------------------------------
// Store QR poster — the PERMANENT printed QR (86ey5m35w, docs/counter-checkout.md)
//
// The poster QR encodes `wa.me/<shared_WABA>?text=…KPS-<retailers.counterQrToken>…`.
// The token is public by design (it's printed on a wall), so security is
// behavioural limits, never secrecy: per-phone-per-store rate limit
// (`storeQrScan`), a per-store cap on concurrent open walk-in sessions,
// the existing TTL sweep, and one-tap rotation (which kills old posters).
// A buyer's scan CREATES (or re-claims) a `buyer_identified` session with
// `origin: "store_qr"`; the cashier picks it up from the open-checkouts list.
// ---------------------------------------------------------------------------

/**
 * Max concurrent open walk-in (`store_qr`) sessions per store — bounds the
 * blast radius of poster spam. Cashier-started sessions are NOT counted (a
 * busy counter must never be blocked by scan noise).
 */
export const MAX_OPEN_STORE_QR_SESSIONS = 10;

/**
 * How long dead sessions (expired / cancelled) are retained before the purge
 * cron deletes the rows. They hold buyer PII (phone + pushname), and the
 * poster increases junk-scan volume, so they must not live forever (PDPA
 * retention principle). Completed sessions are exempt — they link to an
 * order, whose retention is the PDPA Compliance Pack's job (86ey5m3hx).
 */
export const STALE_SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // ~30 days

/** The poster's `wa.me` deep link. Same shape as the per-session prefill —
 * only the `KPS-` ref is load-bearing; the prose is human framing. */
function buildStoreQrWaUrl(token: string): string | undefined {
	const phone = process.env.WHATSAPP_CHECKOUT_PHONE;
	if (!phone) return undefined;
	const text = `Hi! 👋 I'd like to order at the counter.\n\nStore ref: KPS-${token}`;
	return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

/**
 * The seller's Store QR card read: the permanent token + poster wa.me link,
 * or nulls when no token has been generated yet. Owner-or-admin.
 */
export const getStoreQr = query({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{ token: string | null; waUrl: string | undefined }> => {
		const { retailer } = await requireCounterRetailer(ctx, retailerId);
		const token = retailer.counterQrToken ?? null;
		return { token, waUrl: token ? buildStoreQrWaUrl(token) : undefined };
	},
});

/**
 * Generate the store's permanent QR token if it doesn't exist yet (idempotent —
 * an existing token is returned unchanged, so the card's "Generate" button can
 * never rotate by accident). Owner-or-admin, admin-audited.
 */
export const ensureCounterQrToken = mutation({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{ token: string; waUrl: string | undefined }> => {
		const access = await requireCounterRetailer(ctx, retailerId);
		const retailer = access.retailer;
		let token = retailer.counterQrToken;
		if (!token) {
			token = generateTrackingToken();
			await ctx.db.patch(retailer._id, {
				counterQrToken: token,
				updatedAt: Date.now(),
			});
			await logAdminAction(
				ctx,
				access,
				"counterCheckout.ensureCounterQrToken",
				retailer._id,
			);
		}
		return { token, waUrl: buildStoreQrWaUrl(token) };
	},
});

/**
 * Replace the store's permanent QR token. Old printed posters STOP WORKING —
 * the UI confirms this explicitly before calling. Owner-or-admin, admin-audited.
 */
export const rotateCounterQrToken = mutation({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (
		ctx,
		{ retailerId },
	): Promise<{ token: string; waUrl: string | undefined }> => {
		const access = await requireCounterRetailer(ctx, retailerId);
		const token = generateTrackingToken();
		await ctx.db.patch(access.retailer._id, {
			counterQrToken: token,
			updatedAt: Date.now(),
		});
		await logAdminAction(
			ctx,
			access,
			"counterCheckout.rotateCounterQrToken",
			access.retailer._id,
		);
		return { token, waUrl: buildStoreQrWaUrl(token) };
	},
});

/** Outcome of an inbound `KPS-<token>` poster scan (drives the buyer reply). */
export type StoreQrStartResult =
	| {
			result: "started";
			retailerId: Id<"retailers">;
			storeName: string;
			locale: Locale;
			// Short pairing code the buyer shows the cashier (same code on re-claim).
			code: string;
			// True when the buyer already had an open walk-in session at this store
			// (a rescan) — the caller skips the payment-details push to avoid
			// repeating what they got on the first scan.
			reclaimed: boolean;
	  }
	| { result: "busy"; storeName: string; locale: Locale }
	| { result: "not_found" };

/**
 * Internal: start (or re-claim) a walk-in counter session from an inbound
 * `KPS-<token>` poster scan. Called from the WhatsApp webhook handler.
 *
 * Order of guards matters:
 *  1. token → retailer (unknown/rotated token leaks nothing — generic reply);
 *  2. re-claim an existing open walk-in session for this buyer (a rescan is
 *     free: no rate-limit charge, no duplicate row);
 *  3. rate limit per (store, phone) + per-store open-session cap — the actual
 *     security model for a public token;
 *  4. create the session already `buyer_identified` (the buyer IS identified —
 *     they messaged us), with the long idle TTL so the cashier has time.
 */
export const startSessionFromStoreQr = internalMutation({
	args: {
		token: v.string(),
		waPhone: v.string(),
		profileName: v.optional(v.string()),
	},
	handler: async (
		ctx,
		{ token, waPhone, profileName },
	): Promise<StoreQrStartResult> => {
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_counterQrToken", (q) => q.eq("counterQrToken", token))
			.unique();
		if (!retailer) return { result: "not_found" };

		const storeName = retailer.storeName;
		const locale = pickLocale(retailer.locale);
		const now = Date.now();

		// Normalize the inbound phone the same way the bind flow does.
		let normalizedPhone: string;
		try {
			normalizedPhone = assertValidWaPhone(waPhone);
		} catch {
			normalizedPhone = waPhone; // best-effort, mirrors bindCheckoutSession
		}

		// Open walk-in sessions at this store (bounded by the cap, so collect()
		// stays small). Also used for the re-claim lookup below.
		const openBound = await ctx.db
			.query("counterCheckoutSessions")
			.withIndex("by_retailer_status", (q) =>
				q.eq("retailerId", retailer._id).eq("status", "buyer_identified"),
			)
			.collect();
		const openWalkIns = openBound.filter(
			(s) => (s.origin ?? "cashier") === "store_qr" && now <= s.expiresAt,
		);

		// Re-claim: the buyer rescanned while already connected → same session,
		// slid idle window, no new row, no rate-limit charge. Backfill a pairing
		// code if the row predates the feature so the ack still carries one.
		const existing = openWalkIns.find((s) => s.waPhone === normalizedPhone);
		if (existing) {
			const code =
				existing.pairingCode ??
				generatePairingCode(
					new Set(
						openWalkIns
							.map((s) => s.pairingCode)
							.filter((c): c is string => Boolean(c)),
					),
				);
			await ctx.db.patch(existing._id, {
				pairingCode: code,
				expiresAt: now + OPEN_SESSION_TTL_MS,
				updatedAt: now,
			});
			return {
				result: "started",
				retailerId: retailer._id,
				storeName,
				locale,
				code,
				reclaimed: true,
			};
		}

		// The behavioural limits — the poster token is public, so these ARE the
		// security model (see the section comment).
		const limit = await rateLimiter.limit(ctx, "storeQrScan", {
			key: `${retailer._id}:${normalizedPhone}`,
		});
		if (!limit.ok) return { result: "busy", storeName, locale };
		if (openWalkIns.length >= MAX_OPEN_STORE_QR_SESSIONS) {
			return { result: "busy", storeName, locale };
		}

		// Resolve an existing customer (returning-buyer history panel) and refresh
		// their pushname — same as bindCheckoutSession.
		const customer = await ctx.db
			.query("customers")
			.withIndex("by_retailer_phone", (q) =>
				q.eq("retailerId", retailer._id).eq("waPhone", normalizedPhone),
			)
			.unique();
		const trimmedPushname = profileName?.trim() || undefined;
		if (customer && trimmedPushname) {
			await refreshWaProfileName(ctx, {
				customerId: customer._id,
				profileName: trimmedPushname,
			});
		}

		// Unique among the store's currently-open walk-in codes so the cashier
		// never sees two of the same at once.
		const code = generatePairingCode(
			new Set(
				openWalkIns
					.map((s) => s.pairingCode)
					.filter((c): c is string => Boolean(c)),
			),
		);

		await ctx.db.insert("counterCheckoutSessions", {
			retailerId: retailer._id,
			sellerUserId: retailer.userId,
			// Fresh internal session token — keeps the by_token capability unique.
			// The buyer never sees it (they're already bound).
			token: generateTrackingToken(),
			status: "buyer_identified",
			origin: "store_qr",
			pairingCode: code,
			customerId: customer?._id,
			waPhone: normalizedPhone,
			waProfileName: trimmedPushname,
			isNewCustomer: customer === null,
			boundAt: now,
			expiresAt: now + OPEN_SESSION_TTL_MS,
			createdAt: now,
			updatedAt: now,
		});

		return {
			result: "started",
			retailerId: retailer._id,
			storeName,
			locale,
			code,
			reclaimed: false,
		};
	},
});

/**
 * Daily purge (crons.ts): DELETE dead sessions (expired / cancelled) once
 * they're past the retention window — they hold buyer PII and serve no
 * further purpose (`expireStaleSessions` above only flips status, it never
 * deletes). Sweeps `expired` first, then chains to `cancelled`, paginated —
 * same self-chaining shape as expireStaleSessions. Completed sessions are
 * kept (they link to orders; order retention is 86ey5m3hx's job).
 */
export const purgeStaleSessions = internalMutation({
	args: {
		status: v.optional(v.union(v.literal("expired"), v.literal("cancelled"))),
		cursor: v.optional(v.union(v.string(), v.null())),
	},
	handler: async (ctx, { status, cursor }) => {
		const sweepStatus = status ?? "expired";
		const cutoff = Date.now() - STALE_SESSION_RETENTION_MS;
		const page = await ctx.db
			.query("counterCheckoutSessions")
			.withIndex("by_status_expiry", (q) =>
				q.eq("status", sweepStatus).lt("expiresAt", cutoff),
			)
			.paginate({ numItems: 100, cursor: cursor ?? null });

		for (const session of page.page) {
			await ctx.db.delete(session._id);
		}

		if (!page.isDone) {
			await ctx.scheduler.runAfter(0, internal.counterCheckout.purgeStaleSessions, {
				status: sweepStatus,
				cursor: page.continueCursor,
			});
		} else if (sweepStatus === "expired") {
			await ctx.scheduler.runAfter(0, internal.counterCheckout.purgeStaleSessions, {
				status: "cancelled",
			});
		}
	},
});
