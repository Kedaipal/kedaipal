// Kedaipal Credits T2 — top-up packs (ClickUp z8r3fdf8ht,
// docs/credits.md#top-up-packs-t2).
//
// A seller (or a teammate holding credits WRITE) picks a pack; `createTopUp`
// opens a pending purchase and mints a one-off HitPay payment request on
// KEDAIPAL's own account — the subscription Pay-now rail, never the seller's
// BYO HitPay — and hands back the checkout URL. The v1 completion webhook (or
// the return reconcile, or the expiry's last look) settles it through ONE
// mutation, `settlePurchase`, which lands the credits exactly once as a
// 12-month lot via `credits.addPurchasedCredits`. An unpaid checkout expires
// 24h after it opened and never credits.
//
// Purchases live in their own table, never `invoices`: a pending invoice past
// its due date locks the store and blocks renewals (docs/hitpay-recurring.md),
// and an abandoned top-up must do neither.

import { ConvexError, v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	type ActionCtx,
	action,
	internalAction,
	internalMutation,
	internalQuery,
	type MutationCtx,
	type QueryCtx,
	query,
} from "./_generated/server";
import { billingPageUrl } from "./lib/billingUrl";
import { addPurchasedCredits } from "./credits";
import {
	type RetailerAccess,
	requireRetailerAccess,
	resolveMyRetailer,
	resolveMyRetailerFor,
	storeOwnerIsAdmin,
} from "./lib/auth";
import {
	CREDIT_PURCHASE_TTL_MS,
	creditPackLabel,
	generatePurchaseNumber,
	TOP_UP_UNAVAILABLE_MESSAGE,
	TOP_UP_VIEW_ONLY_MESSAGE,
	type TopUpRefusal,
	topUpRefusal,
	topUpRefusalMessage,
} from "./lib/creditPurchases";
import {
	buildCreditPackPaymentRequestParams,
	gatewayPaymentMethodLabel,
	gatewayPaymentMethodTag,
} from "./lib/hitpayBilling";
import {
	billingCredentials,
	createPaymentRequest,
	deletePaymentRequest,
	lookupPaymentRequest,
} from "./lib/hitpayBillingClient";
import { hasPermission } from "./lib/permissions";
import {
	type CreditPurchaseReceiptData,
	creditPurchaseToReceiptData,
} from "./lib/pdf/document";
import { buildCreditPurchaseReceiptPdf } from "./lib/pdf/render";
import {
	type BillingCurrency,
	CREDIT_PACKS,
	type CreditPackId,
	creditPackById,
	foundingPriceEligible,
	PLAN_CREDIT_GRANT,
	renewalCurrency,
} from "./lib/plans";
import { rateLimiter } from "./lib/rateLimiter";

type AnyCtx = QueryCtx | MutationCtx;
type Purchase = Doc<"creditPurchases">;

/** When HitPay couldn't be asked whether a stale checkout was paid, look
 * again this much later rather than expire money that may have landed. */
const EXPIRY_RETRY_DELAY_MS = 60 * 60 * 1000;
/** …up to this many looks in all; after that the purchase expires, and a
 * payment that still turns up is caught as a late payment. */
const EXPIRY_MAX_ATTEMPTS = 3;
/** Newest pending checkouts the return reconcile asks HitPay about. */
const VERIFY_MAX_REQUESTS = 3;
/** Bounds on the history reads. */
const HISTORY_LIMIT = 100;

const PAYMENT_PAGE_FAILED =
	"Couldn't open the payment page — nothing was charged. Try again in a moment.";

// ---------------------------------------------------------------------------
// Shared reads
// ---------------------------------------------------------------------------

async function loadSubscription(
	ctx: AnyCtx,
	retailerId: Id<"retailers">,
): Promise<Doc<"subscriptions"> | null> {
	return ctx.db
		.query("subscriptions")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
		.first();
}

/**
 * The currency a store is billed in — and so the ONLY currency its packs are
 * sold in: the newest PAID invoice's, else the country's (`renewalCurrency`,
 * the author renewals and plan changes already bill by). Never the visitor's
 * geo cookie: a seller travelling to Singapore still pays in ringgit.
 */
async function billingCurrencyFor(
	ctx: AnyCtx,
	retailer: Doc<"retailers">,
): Promise<BillingCurrency> {
	const lastPaid = await ctx.db
		.query("invoices")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
		.order("desc")
		.filter((q) => q.eq(q.field("status"), "paid"))
		.first();
	return renewalCurrency({
		lastPaidCurrency: lastPaid?.currency,
		country: retailer.country,
	});
}

/** The store's open invoice, for the past-due refusal's way out. */
async function pendingInvoiceFor(
	ctx: AnyCtx,
	retailerId: Id<"retailers">,
): Promise<Doc<"invoices"> | null> {
	return ctx.db
		.query("invoices")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
		.order("desc")
		.filter((q) => q.eq(q.field("status"), "pending"))
		.first();
}

/** Who the caller is to the purchase: the owner (and an admin on their own
 * store), or a teammate. Drives whose way out a refusal names. */
function audienceOf(access: RetailerAccess): "owner" | "member" {
	return access.role === "member" ? "member" : "owner";
}

/** Why this store can't buy right now, if it can't. */
async function refusalFor(
	ctx: AnyCtx,
	retailer: Doc<"retailers">,
): Promise<TopUpRefusal | null> {
	const sub = await loadSubscription(ctx, retailer._id);
	return topUpRefusal({
		status: sub?.status ?? null,
		comped: sub?.comped === true,
		ownerIsAdmin: storeOwnerIsAdmin(retailer),
	});
}

/** The teammate who bought, named for the owner — `undefined` when the owner
 * bought it themselves. A removed teammate is still named: the purchase
 * happened while they were on the team. */
async function buyerName(
	ctx: AnyCtx,
	retailer: Doc<"retailers">,
	createdBy: string,
): Promise<string | undefined> {
	if (createdBy === retailer.userId) return undefined;
	const rows = await ctx.db
		.query("retailerMembers")
		.withIndex("by_user", (q) => q.eq("userId", createdBy))
		.collect();
	const member = rows.find((m) => m.retailerId === retailer._id);
	return member ? (member.displayName ?? member.email) : undefined;
}

/** A purchase as the dashboard reads it. */
export type CreditPurchaseView = {
	_id: Id<"creditPurchases">;
	purchaseNumber: string;
	packId: string;
	credits: number;
	amountMinor: number;
	currency: BillingCurrency;
	status: Purchase["status"];
	createdAt: number;
	paidAt: number | null;
	/** A payment we deliberately didn't credit (see the schema). */
	issue: "amount_mismatch" | "late_payment" | null;
	/** "Card", "Touch 'n Go" — once paid. */
	paymentMethodLabel: string | null;
	/** The teammate who bought it, for the owner's history. */
	boughtBy: string | null;
};

function purchaseView(
	purchase: Purchase,
	boughtBy: string | undefined,
): CreditPurchaseView {
	return {
		_id: purchase._id,
		purchaseNumber: purchase.purchaseNumber,
		packId: purchase.packId,
		credits: purchase.credits,
		amountMinor: purchase.amountMinor,
		currency: purchase.currency,
		status: purchase.status,
		createdAt: purchase.createdAt,
		paidAt: purchase.paidAt ?? null,
		issue: purchase.gatewayIssue?.kind ?? null,
		paymentMethodLabel: purchase.paymentMethod
			? gatewayPaymentMethodLabel(purchase.paymentMethod)
			: null,
		boughtBy: boughtBy ?? null,
	};
}

/** The caller's access to a store's credits: `retailerId` is the admin
 * act-as path (mirrors `credits.getBalance`); omitted, the store the caller
 * operates. Null when signed out or without the grant — the surface then
 * renders locked. */
async function creditsReadAccess(
	ctx: AnyCtx,
	retailerId: Id<"retailers"> | undefined,
): Promise<RetailerAccess | null> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) return null;
	return retailerId
		? requireRetailerAccess(ctx, retailerId, { area: "credits", level: "read" })
		: resolveMyRetailerFor(ctx, { area: "credits", level: "read" });
}

// ---------------------------------------------------------------------------
// What the picker offers
// ---------------------------------------------------------------------------

export type TopUpOptions = {
	/** Kedaipal's HitPay billing credentials are configured. Off ⇒ every
	 * top-up surface hides and `createTopUp` refuses. */
	available: boolean;
	/** The store's billing currency — the only one its packs are sold in. */
	currency: BillingCurrency;
	packs: Array<{
		id: CreditPackId;
		credits: number;
		priceMinor: number;
		currency: BillingCurrency;
	}>;
	/** Why the store can't buy, with the copy for this reader. */
	refusal: TopUpRefusal | null;
	refusalMessage: string | null;
	/** Why THIS reader can't buy even when the store could. */
	viewOnly: "acting_as_admin" | "no_write" | null;
	/** Past due, read by the owner: the invoice that is the way out. */
	pendingInvoice: { invoiceNumber: string; payNowUrl: string | null } | null;
	/** An ordinary Starter store: the plan that includes more orders a month.
	 * Null where no upgrade is on offer (Pro/Scale, founding, custom grant). */
	upgradeHint: { planLabel: string; monthlyCredits: number } | null;
	/** A teammate is buying — they pay on HitPay's page themselves and the
	 * owner is emailed the receipt. */
	buyerIsMember: boolean;
};

/**
 * Everything the pack picker shows: the packs in the store's billing currency,
 * whether the store may buy, and whether this reader may. Gated on credits
 * READ (a view-only teammate sees the packs, disabled with the reason);
 * Billing's own `billingGatewayAvailable` can't carry it, because that one is
 * billing-read gated and a teammate with credits write needs this without it.
 */
export const topUpOptions = query({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (ctx, { retailerId }): Promise<TopUpOptions | null> => {
		const access = await creditsReadAccess(ctx, retailerId);
		if (!access) return null;
		const retailer = access.retailer;
		const sub = await loadSubscription(ctx, retailer._id);
		const currency = await billingCurrencyFor(ctx, retailer);
		const refusal = topUpRefusal({
			status: sub?.status ?? null,
			comped: sub?.comped === true,
			ownerIsAdmin: storeOwnerIsAdmin(retailer),
		});
		const isOwner = access.role === "owner";
		const pending =
			refusal === "past_due" && isOwner
				? await pendingInvoiceFor(ctx, retailer._id)
				: null;
		const canWrite =
			access.role !== "member" ||
			hasPermission(access.membership?.permissions ?? {}, "credits", "write");
		const account = await ctx.db
			.query("creditAccounts")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
			.first();
		const plainStarter =
			sub !== null &&
			sub.status === "active" &&
			sub.plan === "starter" &&
			sub.comped !== true &&
			account?.grantOverride === undefined &&
			!foundingPriceEligible({
				isFoundingMember: retailer.isFoundingMember === true,
				foundingIntent: sub.foundingIntent === true,
				paidThrough: sub.currentPeriodEnd,
				benefitsRevokedAt: retailer.foundingBenefitsRevokedAt,
				benefitsRestoredAt: retailer.foundingBenefitsRestoredAt,
				now: Date.now(),
			});
		return {
			available: billingCredentials() !== null,
			currency,
			packs: CREDIT_PACKS[currency].map((p) => ({
				id: p.id,
				credits: p.credits,
				priceMinor: p.priceMinor,
				currency: p.currency,
			})),
			refusal,
			refusalMessage: refusal
				? topUpRefusalMessage(refusal, {
						audience: audienceOf(access),
						invoiceNumber: pending?.invoiceNumber,
					})
				: null,
			viewOnly: access.actingAsAdmin
				? "acting_as_admin"
				: canWrite
					? null
					: "no_write",
			pendingInvoice: pending
				? {
						invoiceNumber: pending.invoiceNumber,
						payNowUrl: pending.gatewayPayment?.url ?? null,
					}
				: null,
			upgradeHint: plainStarter
				? { planLabel: "Pro", monthlyCredits: PLAN_CREDIT_GRANT.pro }
				: null,
			buyerIsMember: access.role === "member",
		};
	},
});

// ---------------------------------------------------------------------------
// Opening a checkout
// ---------------------------------------------------------------------------

/**
 * Validate a top-up and insert its pending purchase — every rule in ONE
 * transaction: credits WRITE (owner/admin always, a teammate needs the grant),
 * never under admin act-as, the rate limit, a pack that exists IN the store's
 * billing currency, and a store that may buy (`topUpRefusal`). Schedules the
 * purchase's own 24h expiry. Internal: `createTopUp` calls it, then mints.
 */
export const openPurchase = internalMutation({
	args: {
		packId: v.string(),
		retailerId: v.optional(v.id("retailers")),
	},
	handler: async (
		ctx,
		{ packId, retailerId },
	): Promise<{
		purchaseId: Id<"creditPurchases">;
		purchaseNumber: string;
		credits: number;
		amountMinor: number;
		currency: BillingCurrency;
		storeName: string;
		customerEmail: string | undefined;
	}> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new ConvexError("Not authenticated");
		let storeId = retailerId;
		if (storeId === undefined) {
			const mine = await resolveMyRetailer(ctx);
			if (!mine) throw new ConvexError("No store found for your account");
			storeId = mine.retailer._id;
		}
		const access = await requireRetailerAccess(ctx, storeId, {
			area: "credits",
			level: "write",
		});
		// Billing is view-only under act-as (Zaki, 17 Sep 2026) — the
		// `setSeasonalHold` posture. An admin adds credits with an audited
		// adjustment (`credits.adminAdjust`), never by spending on the seller's
		// behalf. An admin on their OWN store resolves as the owner.
		if (access.actingAsAdmin) throw new ConvexError(TOP_UP_VIEW_ONLY_MESSAGE);
		const retailer = access.retailer;
		// Money-adjacent self-serve: each accepted call is one HitPay request
		// on Kedaipal's account. Shared bucket with subscribeSelf, keyed by store.
		await rateLimiter.limit(ctx, "billingSelfServe", {
			key: retailer._id,
			throws: true,
		});
		const pack = creditPackById(packId);
		if (!pack)
			throw new ConvexError(
				"That credit pack isn't on sale — reload the page to see the current packs.",
			);
		const currency = await billingCurrencyFor(ctx, retailer);
		if (pack.currency !== currency)
			throw new ConvexError(
				"That pack is priced in a different currency from your billing — reload the page to see your packs.",
			);
		const refusal = await refusalFor(ctx, retailer);
		if (refusal) {
			const pending =
				refusal === "past_due" && access.role === "owner"
					? await pendingInvoiceFor(ctx, retailer._id)
					: null;
			throw new ConvexError(
				topUpRefusalMessage(refusal, {
					audience: audienceOf(access),
					invoiceNumber: pending?.invoiceNumber,
				}),
			);
		}
		const now = Date.now();
		const purchaseNumber = generatePurchaseNumber(now);
		const purchaseId = await ctx.db.insert("creditPurchases", {
			retailerId: retailer._id,
			packId: pack.id,
			credits: pack.credits,
			amountMinor: pack.priceMinor,
			currency: pack.currency,
			status: "pending",
			source: "manual",
			createdBy: access.userId,
			purchaseNumber,
			createdAt: now,
		});
		// A per-purchase timer, not a daily sweep: "expired" means exactly 24h.
		await ctx.scheduler.runAfter(
			CREDIT_PURCHASE_TTL_MS,
			internal.creditPurchases.expirePurchase,
			{ purchaseId, attempt: 1 },
		);
		// The BUYER's email on HitPay's record: a teammate pays with their own
		// card or wallet, so theirs; the owner, the store's billing email.
		const identityEmail =
			typeof identity.email === "string" ? identity.email : undefined;
		const customerEmail =
			access.role === "member"
				? (access.membership?.email ?? identityEmail)
				: (retailer.notifyEmail ?? identityEmail);
		return {
			purchaseId,
			purchaseNumber,
			credits: pack.credits,
			amountMinor: pack.priceMinor,
			currency: pack.currency,
			storeName: retailer.storeName,
			customerEmail,
		};
	},
});

export const recordPurchaseRequest = internalMutation({
	args: {
		purchaseId: v.id("creditPurchases"),
		requestId: v.string(),
		url: v.string(),
	},
	handler: async (
		ctx,
		{ purchaseId, requestId, url },
	): Promise<{ ok: boolean }> => {
		const purchase = await ctx.db.get(purchaseId);
		// Expired under us (a 24h-slow mint is not a thing, but a guard is
		// free), or a request already stored — the caller kills this one.
		if (!purchase || purchase.status !== "pending" || purchase.gatewayRequestId)
			return { ok: false };
		await ctx.db.patch(purchaseId, {
			gatewayRequestId: requestId,
			gatewayPayment: { url },
		});
		return { ok: true };
	},
});

/** The checkout could never be created — the purchase is closed as `failed`
 * rather than left pending for a day with nothing to pay. */
export const markMintFailed = internalMutation({
	args: { purchaseId: v.id("creditPurchases") },
	handler: async (ctx, { purchaseId }): Promise<void> => {
		const purchase = await ctx.db.get(purchaseId);
		if (!purchase || purchase.status !== "pending") return;
		await ctx.db.patch(purchaseId, { status: "failed" });
	},
});

/**
 * Buy a pack: open the purchase, mint its HitPay checkout on Kedaipal's own
 * account, and return the URL for the client to redirect to. A teammate pays
 * there with their OWN card or wallet — no saved card is ever charged for a
 * manual top-up. `retailerId` is the act-as path, and act-as is refused
 * (billing is view-only there).
 */
export const createTopUp = action({
	args: {
		packId: v.string(),
		retailerId: v.optional(v.id("retailers")),
	},
	handler: async (
		ctx,
		{ packId, retailerId },
	): Promise<{ url: string; purchaseId: Id<"creditPurchases"> }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new ConvexError("Not authenticated");
		const credentials = billingCredentials();
		if (!credentials) throw new ConvexError(TOP_UP_UNAVAILABLE_MESSAGE);
		const opened = await ctx.runMutation(
			internal.creditPurchases.openPurchase,
			{ packId, retailerId },
		);
		const siteUrl = process.env.CONVEX_SITE_URL;
		if (!siteUrl) {
			console.error(
				"[credits] CONVEX_SITE_URL unset — top-up minted without a webhook; relying on the return and expiry reconciles",
				{ purchaseNumber: opened.purchaseNumber },
			);
		}
		const params = buildCreditPackPaymentRequestParams({
			purchaseNumber: opened.purchaseNumber,
			packLabel: creditPackLabel(opened.credits),
			storeName: opened.storeName,
			amountSen: opened.amountMinor,
			currency: opened.currency,
			redirectUrl: billingPageUrl("topup=return"),
			webhookUrl: siteUrl ? `${siteUrl}/webhook/hitpay` : "",
			customerEmail: opened.customerEmail,
		});
		const request = await createPaymentRequest(credentials, params, {
			kind: "credit_purchase",
			purchaseNumber: opened.purchaseNumber,
			currency: opened.currency,
		});
		if (request.kind !== "ok") {
			await ctx.runMutation(internal.creditPurchases.markMintFailed, {
				purchaseId: opened.purchaseId,
			});
			throw new ConvexError(PAYMENT_PAGE_FAILED);
		}
		const stored: { ok: boolean } = await ctx.runMutation(
			internal.creditPurchases.recordPurchaseRequest,
			{ purchaseId: opened.purchaseId, requestId: request.id, url: request.url },
		);
		if (!stored.ok) {
			// A request nobody stored is one no later cleanup can reach.
			await deletePaymentRequest(credentials, request.id);
			throw new ConvexError(PAYMENT_PAGE_FAILED);
		}
		return { url: request.url, purchaseId: opened.purchaseId };
	},
});

// ---------------------------------------------------------------------------
// Settling — exactly once
// ---------------------------------------------------------------------------

/** Stamp an authentic payment we won't credit — once; a repeat delivery
 * never overwrites the first record. */
async function stampIssue(
	ctx: MutationCtx,
	purchase: Purchase,
	issue: NonNullable<Purchase["gatewayIssue"]>,
): Promise<void> {
	console.error("[credits] top-up payment not credited", {
		purchaseNumber: purchase.purchaseNumber,
		status: purchase.status,
		...issue,
	});
	if (purchase.gatewayIssue !== undefined) return;
	await ctx.db.patch(purchase._id, { gatewayIssue: issue });
}

/**
 * THE settle for a top-up — the webhook, the return reconcile and the expiry's
 * last look all land here, so the credits can only ever be added once:
 *  - pending + amount AND currency match → paid, credits land as a lot;
 *  - already paid by THIS payment id → a repeat delivery, a plain no-op;
 *  - expired / failed / paid by another payment → `late_payment`, no credit;
 *  - amount or currency differ from the purchase → `amount_mismatch`, no
 *    credit (a checkout must never land a different pack than it sold).
 * An admin reconciles every uncredited payment by hand (an adjustment, or a
 * refund) — `internalListIssues` finds them.
 */
export const settlePurchase = internalMutation({
	args: {
		purchaseId: v.id("creditPurchases"),
		paymentId: v.string(),
		amountSen: v.number(),
		currency: v.string(),
		// HitPay's `payment_type` when the caller knows it (the status API
		// does; the v1 webhook doesn't — the finalize step asks).
		methodCode: v.optional(v.string()),
	},
	handler: async (
		ctx,
		{ purchaseId, paymentId, amountSen, currency, methodCode },
	): Promise<{
		applied: boolean;
		reason?: "duplicate" | "late_payment" | "amount_mismatch" | "gone";
	}> => {
		const purchase = await ctx.db.get(purchaseId);
		if (!purchase) return { applied: false, reason: "gone" };
		const now = Date.now();
		if (purchase.status !== "pending") {
			if (
				purchase.status === "paid" &&
				purchase.gatewayPayment?.paymentId === paymentId
			)
				return { applied: false, reason: "duplicate" };
			await stampIssue(ctx, purchase, {
				kind: "late_payment",
				paymentId,
				amountSen,
				at: now,
			});
			return { applied: false, reason: "late_payment" };
		}
		if (
			amountSen !== purchase.amountMinor ||
			currency.toUpperCase() !== purchase.currency
		) {
			await stampIssue(ctx, purchase, {
				kind: "amount_mismatch",
				paymentId,
				amountSen,
				at: now,
			});
			return { applied: false, reason: "amount_mismatch" };
		}
		const landed = await addPurchasedCredits(ctx, {
			retailerId: purchase.retailerId,
			credits: purchase.credits,
			source: "purchase",
			type: "purchase",
			reason: "purchase",
			refId: purchase._id,
			refLabel: creditPackLabel(purchase.credits),
			createdBy: purchase.createdBy,
			now,
		});
		if (!landed) {
			// The store is gone (deleted while the checkout was open — the
			// deletion cascade expires pending top-ups, so this is the race):
			// money for a store that no longer exists is a refund, never credits.
			await stampIssue(ctx, purchase, {
				kind: "late_payment",
				paymentId,
				amountSen,
				at: now,
			});
			return { applied: false, reason: "gone" };
		}
		await ctx.db.patch(purchase._id, {
			status: "paid",
			paidAt: now,
			paymentMethod: gatewayPaymentMethodTag(methodCode),
			// The url is always present on a settle path (the request id and the
			// url are stored together); the fallback only satisfies the type.
			gatewayPayment: { url: purchase.gatewayPayment?.url ?? "", paymentId },
			lotId: landed.lotId,
		});
		// Referral T2 hooks in here: the referrer's reward for the referee's
		// FIRST paid pack (not built — see docs/credits.md).
		await ctx.scheduler.runAfter(
			0,
			internal.creditPurchases.finalizePaidPurchase,
			{ purchaseId },
		);
		// Server-side GA4 key event (the `subscribe_paid` pattern): revenue that
		// lands while the seller's tab may already be closed. Fire-and-forget.
		const retailer = await ctx.db.get(purchase.retailerId);
		await ctx.scheduler.runAfter(0, internal.ga4Events.sendKeyEvent, {
			event: "credits_topup_paid",
			retailerId: purchase.retailerId,
			...(retailer?.gaClientId !== undefined
				? { gaClientId: retailer.gaClientId }
				: {}),
			...(retailer?.signupSource !== undefined
				? { src: retailer.signupSource }
				: {}),
			params: {
				// Minor units on the row; GA4 `value` is major.
				value: purchase.amountMinor / 100,
				currency: purchase.currency,
				pack_id: purchase.packId,
				source: purchase.source,
			},
		});
		return { applied: true };
	},
});

/** Everything the gateway-side actions need about one purchase. */
export const purchaseForGateway = internalQuery({
	args: { purchaseId: v.id("creditPurchases") },
	handler: async (
		ctx,
		{ purchaseId },
	): Promise<{
		status: Purchase["status"];
		gatewayRequestId: string | undefined;
		paymentId: string | undefined;
		paymentMethod: string | undefined;
	} | null> => {
		const purchase = await ctx.db.get(purchaseId);
		if (!purchase) return null;
		return {
			status: purchase.status,
			gatewayRequestId: purchase.gatewayRequestId,
			paymentId: purchase.gatewayPayment?.paymentId,
			paymentMethod: purchase.paymentMethod,
		};
	},
});

/** The rail, learned after the webhook settled without one. Only ever
 * refines the bare `hitpay` tag. */
export const recordPaymentMethod = internalMutation({
	args: { purchaseId: v.id("creditPurchases"), methodCode: v.string() },
	handler: async (ctx, { purchaseId, methodCode }): Promise<void> => {
		const purchase = await ctx.db.get(purchaseId);
		if (!purchase || purchase.status !== "paid") return;
		if (purchase.paymentMethod !== "hitpay") return;
		await ctx.db.patch(purchaseId, {
			paymentMethod: gatewayPaymentMethodTag(methodCode),
		});
	},
});

/**
 * After a top-up lands: name the rail it was paid on (the v1 webhook doesn't
 * say — the status API does), freeze the receipt PDF, then send the receipt
 * email — in that order, so both say how the seller paid. Each step is
 * best-effort: the credits already landed, and nothing here can undo that.
 */
export const finalizePaidPurchase = internalAction({
	args: { purchaseId: v.id("creditPurchases") },
	handler: async (ctx, { purchaseId }): Promise<void> => {
		const purchase = await ctx.runQuery(
			internal.creditPurchases.purchaseForGateway,
			{ purchaseId },
		);
		if (!purchase || purchase.status !== "paid") return;
		const credentials = billingCredentials();
		if (
			credentials &&
			purchase.paymentMethod === "hitpay" &&
			purchase.gatewayRequestId
		) {
			const found = await lookupPaymentRequest(
				credentials,
				purchase.gatewayRequestId,
			);
			if (found.kind === "paid" && found.methodCode) {
				await ctx.runMutation(internal.creditPurchases.recordPaymentMethod, {
					purchaseId,
					methodCode: found.methodCode,
				});
			}
		}
		try {
			await renderReceipt(ctx, purchaseId);
		} catch (err) {
			// The download renders on demand, so a failed render here is a
			// log line, never a missing receipt.
			console.error("[credits] receipt render failed", {
				purchaseId,
				err: err instanceof Error ? err.message : String(err),
			});
		}
		await ctx.scheduler.runAfter(
			0,
			internal.billingEmail.notifyCreditPurchaseReceipt,
			{ purchaseId },
		);
	},
});

// ---------------------------------------------------------------------------
// Expiry — 24h after the checkout opened
// ---------------------------------------------------------------------------

export const markExpired = internalMutation({
	args: { purchaseId: v.id("creditPurchases") },
	handler: async (
		ctx,
		{ purchaseId },
	): Promise<{ requestId: string | null }> => {
		const purchase = await ctx.db.get(purchaseId);
		if (!purchase || purchase.status !== "pending") return { requestId: null };
		await ctx.db.patch(purchaseId, {
			status: "expired",
			expiredAt: Date.now(),
		});
		return { requestId: purchase.gatewayRequestId ?? null };
	},
});

/**
 * Scheduled at creation, 24h out: a purchase still pending is closed as
 * `expired` and its HitPay request deleted (it expires at HitPay on the same
 * clock; the DELETE makes it certain). Never expires money that landed: it
 * asks HitPay once more first, and settles a payment whose webhook was lost.
 * If HitPay can't be asked, it looks again an hour later (up to 3 looks) —
 * "couldn't check" is not "didn't pay". A payment that still turns up after
 * the purchase expired is stamped `late_payment` and never credited.
 */
export const expirePurchase = internalAction({
	args: { purchaseId: v.id("creditPurchases"), attempt: v.number() },
	handler: async (ctx, { purchaseId, attempt }): Promise<void> => {
		const purchase = await ctx.runQuery(
			internal.creditPurchases.purchaseForGateway,
			{ purchaseId },
		);
		if (!purchase || purchase.status !== "pending") return;
		const credentials = billingCredentials();
		if (credentials && purchase.gatewayRequestId) {
			const found = await lookupPaymentRequest(
				credentials,
				purchase.gatewayRequestId,
			);
			if (found.kind === "paid") {
				const result: { applied: boolean; reason?: string } =
					await ctx.runMutation(internal.creditPurchases.settlePurchase, {
						purchaseId,
						paymentId: found.paymentId,
						amountSen: found.amountSen,
						currency: found.currency,
						methodCode: found.methodCode,
					});
				if (result.applied || result.reason === "duplicate") return;
				// Refused (amount mismatch — stamped for the admin): nothing to
				// credit, so it closes like any unpaid checkout.
			} else if (found.kind === "unknown" && attempt < EXPIRY_MAX_ATTEMPTS) {
				await ctx.scheduler.runAfter(
					EXPIRY_RETRY_DELAY_MS,
					internal.creditPurchases.expirePurchase,
					{ purchaseId, attempt: attempt + 1 },
				);
				return;
			}
		}
		const { requestId } = await ctx.runMutation(
			internal.creditPurchases.markExpired,
			{ purchaseId },
		);
		if (requestId && credentials) await deletePaymentRequest(credentials, requestId);
	},
});

/** DELETE a top-up's HitPay request — scheduled by the account-deletion
 * cascade, which (as a mutation) can't fetch. */
export const deletePurchaseRequest = internalAction({
	args: { requestId: v.string() },
	handler: async (_ctx, { requestId }): Promise<void> => {
		const credentials = billingCredentials();
		if (!credentials) return;
		await deletePaymentRequest(credentials, requestId);
	},
});

// ---------------------------------------------------------------------------
// Coming back from HitPay
// ---------------------------------------------------------------------------

/** The caller's own pending checkouts with a live request, newest first — the
 * return reconcile's read (the redirect lands in the buyer's own browser). */
export const myPendingGatewayPurchases = internalQuery({
	args: {},
	handler: async (
		ctx,
	): Promise<
		Array<{ purchaseId: Id<"creditPurchases">; requestId: string }>
	> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];
		const mine = await resolveMyRetailer(ctx);
		if (!mine) return [];
		const rows = await ctx.db
			.query("creditPurchases")
			.withIndex("by_retailer_status_created", (q) =>
				q.eq("retailerId", mine.retailer._id).eq("status", "pending"),
			)
			.order("desc")
			.take(10);
		const out: Array<{ purchaseId: Id<"creditPurchases">; requestId: string }> =
			[];
		for (const row of rows) {
			if (row.createdBy !== identity.subject || !row.gatewayRequestId) continue;
			out.push({ purchaseId: row._id, requestId: row.gatewayRequestId });
			if (out.length >= VERIFY_MAX_REQUESTS) break;
		}
		return out;
	},
});

/**
 * Back on the billing tab from HitPay's checkout (`topup=return`): ask HitPay
 * whether the caller's open checkouts were paid instead of trusting the trip —
 * the lost-webhook safety net, `verifyInvoicePayment`'s twin. Settles through
 * the same idempotent `settlePurchase`, so racing the webhook is a harmless
 * duplicate. The page itself watches the purchase reactively; this only makes
 * sure it has something to see.
 */
export const verifyCreditPurchase = action({
	args: {},
	handler: async (ctx): Promise<{ settled: boolean }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new ConvexError("Not authenticated");
		await rateLimiter.limit(ctx, "billingSelfServe", {
			key: identity.subject,
			throws: true,
		});
		const credentials = billingCredentials();
		if (!credentials) return { settled: false };
		const pending = await ctx.runQuery(
			internal.creditPurchases.myPendingGatewayPurchases,
			{},
		);
		let settled = false;
		for (const { purchaseId, requestId } of pending) {
			const found = await lookupPaymentRequest(credentials, requestId);
			if (found.kind !== "paid") continue;
			const result: { applied: boolean; reason?: string } =
				await ctx.runMutation(internal.creditPurchases.settlePurchase, {
					purchaseId,
					paymentId: found.paymentId,
					amountSen: found.amountSen,
					currency: found.currency,
					methodCode: found.methodCode,
				});
			if (result.applied || result.reason === "duplicate") settled = true;
		}
		return { settled };
	},
});

/**
 * The caller's newest top-up from the last two days — what the return view
 * watches: pending while HitPay confirms, then paid, expired, or flagged. The
 * window keeps a days-old bookmark of the return URL from replaying an old
 * purchase as if it just happened.
 */
export const latestPurchase = query({
	args: {},
	handler: async (
		ctx,
	): Promise<(CreditPurchaseView & { expiresAt: number | null }) | null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const access = await resolveMyRetailerFor(ctx, {
			area: "credits",
			level: "read",
		});
		if (!access) return null;
		const since = Date.now() - 2 * CREDIT_PURCHASE_TTL_MS;
		const rows = await ctx.db
			.query("creditPurchases")
			.withIndex("by_retailer_created", (q) =>
				q.eq("retailerId", access.retailer._id).gte("createdAt", since),
			)
			.order("desc")
			.take(20);
		const mine = rows.find((r) => r.createdBy === identity.subject);
		if (!mine) return null;
		// When the credits stop working — the lot's own date, never recomputed.
		const lot = mine.lotId ? await ctx.db.get(mine.lotId) : null;
		return { ...purchaseView(mine, undefined), expiresAt: lot?.expiresAt ?? null };
	},
});

// ---------------------------------------------------------------------------
// Billing history + receipts
// ---------------------------------------------------------------------------

/** The store's PAID top-ups, newest first — merged into the billing tab's
 * history beside the invoices. Credits READ (the same act-as posture as
 * `invoices.myInvoices`); a teammate's purchase names them. */
export const myPurchases = query({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (ctx, { retailerId }): Promise<CreditPurchaseView[]> => {
		const access = await creditsReadAccess(ctx, retailerId);
		if (!access) return [];
		const retailer = access.retailer;
		const rows = await ctx.db
			.query("creditPurchases")
			.withIndex("by_retailer_status_created", (q) =>
				q.eq("retailerId", retailer._id).eq("status", "paid"),
			)
			.order("desc")
			.take(HISTORY_LIMIT);
		const names = new Map<string, string | undefined>();
		const out: CreditPurchaseView[] = [];
		for (const row of rows) {
			if (!names.has(row.createdBy))
				names.set(row.createdBy, await buyerName(ctx, retailer, row.createdBy));
			out.push(purchaseView(row, names.get(row.createdBy)));
		}
		return out;
	},
});

/** Read-only inputs for the receipt render; `eligible` only once paid. */
export const receiptPdfInputs = internalQuery({
	args: { purchaseId: v.id("creditPurchases") },
	handler: async (
		ctx,
		{ purchaseId },
	): Promise<{
		alreadyRendered: boolean;
		eligible: boolean;
		data: CreditPurchaseReceiptData;
	} | null> => {
		const purchase = await ctx.db.get(purchaseId);
		if (!purchase) return null;
		const retailer = await ctx.db.get(purchase.retailerId);
		if (!retailer) return null;
		const lot = purchase.lotId ? await ctx.db.get(purchase.lotId) : null;
		const paidAt = purchase.paidAt ?? purchase.createdAt;
		return {
			alreadyRendered: purchase.receiptPdfStorageId !== undefined,
			eligible: purchase.status === "paid" && purchase.paidAt !== undefined,
			data: creditPurchaseToReceiptData({
				purchase: { ...purchase, paidAt },
				retailer: {
					storeName: retailer.storeName,
					waPhone: retailer.waPhone,
					slug: retailer.slug,
				},
				expiresAt: lot?.expiresAt,
				boughtBy: await buyerName(ctx, retailer, purchase.createdBy),
			}),
		};
	},
});

export const attachReceiptPdf = internalMutation({
	args: {
		purchaseId: v.id("creditPurchases"),
		storageId: v.id("_storage"),
	},
	handler: async (ctx, { purchaseId, storageId }): Promise<void> => {
		const purchase = await ctx.db.get(purchaseId);
		if (!purchase) return;
		// Two renders raced: keep the first, drop the orphan blob.
		if (purchase.receiptPdfStorageId !== undefined) {
			await ctx.storage.delete(storageId);
			return;
		}
		await ctx.db.patch(purchaseId, { receiptPdfStorageId: storageId });
	},
});

/** Render + store a paid purchase's receipt, once. A no-op for anything not
 * paid, so a stray call can never mint a receipt for money that didn't land. */
async function renderReceipt(
	ctx: ActionCtx,
	purchaseId: Id<"creditPurchases">,
): Promise<void> {
	const inputs = await ctx.runQuery(internal.creditPurchases.receiptPdfInputs, {
		purchaseId,
	});
	if (!inputs || inputs.alreadyRendered || !inputs.eligible) return;
	const bytes = await buildCreditPurchaseReceiptPdf(inputs.data);
	// Copy into a standalone ArrayBuffer so the Blob types line up across runtimes.
	const buffer = bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;
	const storageId = await ctx.storage.store(
		new Blob([buffer], { type: "application/pdf" }),
	);
	await ctx.runMutation(internal.creditPurchases.attachReceiptPdf, {
		purchaseId,
		storageId,
	});
}

/** Signed URL for a paid purchase's receipt. Credits READ on the purchase's
 * store (owner, admin, or a teammate with the grant). Null while unrendered. */
export const getReceiptPdfUrl = query({
	args: { purchaseId: v.id("creditPurchases") },
	handler: async (ctx, { purchaseId }): Promise<string | null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new ConvexError("Not authenticated");
		const purchase = await ctx.db.get(purchaseId);
		if (!purchase) return null;
		await requireRetailerAccess(ctx, purchase.retailerId, {
			area: "credits",
			level: "read",
		});
		if (!purchase.receiptPdfStorageId) return null;
		return ctx.storage.getUrl(purchase.receiptPdfStorageId);
	},
});

/** The download button's entry point: the signed URL, rendering the receipt
 * first if it isn't there yet. Access is checked by the URL query BEFORE any
 * render, and the render refuses anything unpaid. */
export const getOrCreateReceiptPdfUrl = action({
	args: { purchaseId: v.id("creditPurchases") },
	handler: async (ctx, { purchaseId }): Promise<string | null> => {
		const existing: string | null = await ctx.runQuery(
			api.creditPurchases.getReceiptPdfUrl,
			{ purchaseId },
		);
		if (existing) return existing;
		await renderReceipt(ctx, purchaseId);
		return ctx.runQuery(api.creditPurchases.getReceiptPdfUrl, { purchaseId });
	},
});

/**
 * Ops: recent top-up payments that were NOT credited (late payment, amount
 * mismatch), newest first — each needs a person: an adjustment
 * (`credits:adminAdjust`, purchased bucket) or a refund in HitPay.
 * `npx convex run creditPurchases:internalListIssues`. Scans the newest 500
 * purchases — a manual runbook read, not a hot path.
 */
export const internalListIssues = internalQuery({
	args: {},
	handler: async (
		ctx,
	): Promise<
		Array<{
			purchaseId: Id<"creditPurchases">;
			purchaseNumber: string;
			retailerId: Id<"retailers">;
			status: Purchase["status"];
			amountMinor: number;
			currency: BillingCurrency;
			issue: NonNullable<Purchase["gatewayIssue"]>;
		}>
	> => {
		const rows = await ctx.db.query("creditPurchases").order("desc").take(500);
		return rows.flatMap((row) =>
			row.gatewayIssue
				? [
						{
							purchaseId: row._id,
							purchaseNumber: row.purchaseNumber,
							retailerId: row.retailerId,
							status: row.status,
							amountMinor: row.amountMinor,
							currency: row.currency,
							issue: row.gatewayIssue,
						},
					]
				: [],
		);
	},
});
