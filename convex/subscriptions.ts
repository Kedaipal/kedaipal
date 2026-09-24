// Subscription reads + the soft-lock access guard. The whole manual-billing model
// rests on `resolveAccess`: it turns a retailer's subscription into an access
// descriptor that the seller-side dashboard reads (nav pill, disabled-with-reason
// UI) and that `assertSubscriptionActive` enforces on EVERY seller write.
//
// Two invariants the rest of the system depends on:
//  1. FAIL SAFE — a missing subscription row resolves to FULL access (comped),
//     logged, never locked. So a backfill miss degrades to "works", not "locked
//     out" (ticket launch-blocker EC).
//  2. The storefront + order pipeline NEVER call this — they're public and stay
//     live regardless of subscription status. The soft lock freezes the SELLER's
//     dashboard and nothing else: a lapsed store is view-only, while its buyers
//     browse, order, pay, track and edit their own orders exactly as before.
//
// See docs/manual-subscription.md.

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalMutation,
	internalQuery,
	mutation,
	type MutationCtx,
	query,
	type QueryCtx,
} from "./_generated/server";
import {
	adminUserIds,
	isAdmin,
	logAdminAction,
	requireAdmin,
	requireRetailerAccess,
	storeOwnerIsAdmin,
} from "./lib/auth";
import { COMP_LABEL_MAX, COMP_NOTE_MAX, type CompKind } from "./lib/comp";
import { rateLimiter } from "./lib/rateLimiter";
import { autoRenewMethodLabel } from "./lib/hitpayBilling";
import {
	type BillingCycle,
	capsForPlan,
	FULL_ACCESS_PLAN,
	featuresForPlan,
	fullAccessCaps,
	type Plan,
	PLAN_CAPS,
	type PlanFeature,
	type PlanFeatures,
	TRIAL_DAYS,
} from "./lib/plans";
import {
	canEnterHold,
	canResumeHold,
	holdBillsNow,
	resumeBillsNow,
} from "./lib/seasonalHold";

const DAY_MS = 24 * 60 * 60 * 1000;

type AnyCtx = QueryCtx | MutationCtx;

export type SubscriptionStatus =
	| "trialing"
	| "active"
	| "past_due"
	| "cancelled"
	| "on_hold";

export type AccessState = {
	plan: Plan;
	status: SubscriptionStatus;
	/** Monthly or annual. Carried so the seller's Settings → Billing tab can tell
	 * an annual subscriber apart from a monthly one — without it the annual offer
	 * would keep pitching a switch to someone who already switched. Owner-only,
	 * like the rest of this descriptor: it is never on the public storefront
	 * payload. */
	billingCycle: BillingCycle;
	comped: boolean;
	/** Admin-granted comp metadata (z8r3fdeub2) — the SELLER-FACING slice only
	 * (kind, sponsor label) so the billing tab can say "Sponsored by X".
	 * `note`/`grantedBy` are admin-internal and never ride a seller payload.
	 * Absent on fail-open comped rows (missing row / legacy backfill) — those
	 * render the generic sponsored card. */
	comp?: { kind: CompKind; label?: string };
	/** Set while an EXPIRED seller's lock came from an admin turning their comp
	 * upgrade off (z8r3fdeub2) rather than an unpaid bill. Only meaningful with
	 * `status: "past_due"`: it swaps "your subscription is past due" for "your
	 * sponsored access ended" (they never had a subscription) and points them
	 * at choosing a plan. Owner-only. */
	compEnded?: { at: number };
	/** The free period's BACKSTOP deadline (signup + TRIAL_DAYS). */
	trialEndsAt?: number;
	/** Start-when-you-sell (z8r3fday24): set once the free period ENDED — at
	 * the first live order or the backstop — and the first invoice was issued.
	 * While unset on a `trialing` row the store is still free. Drives the
	 * pill/banner/billing-tab wording ("Free · until your first order" vs
	 * "first invoice due"). Owner-only like the rest of this descriptor. */
	freePeriodEndedAt?: number;
	freePeriodEndReason?: "first_order" | "backstop";
	currentPeriodEnd?: number;
	caps: { orderCap: number; userCap: number; broadcastQuota: number };
	/** Boolean feature entitlements (CRM, Order Inbox, …) resolved from the plan
	 * — the only place `plan` is read for gating. See lib/plans.ts. */
	features: PlanFeatures;
	/** True when the seller has full dashboard access (not soft-locked). */
	active: boolean;
	/** Soft-lock engaged — dashboard growth-writes must be blocked. */
	frozen: boolean;
	/** Off-Season Hold (z8r3fday24): the subscription is paused — ordering is
	 * off (`caps.orderCap` reads 0 here), everything else stays live, and
	 * `plan` is the tier the seller resumes to. Never frozen by itself; an
	 * unpaid hold invoice going overdue locks like any other. */
	held: boolean;
	heldAt?: number;
	/** What bought the current paid period — lets the hold card say whether a
	 * resume bills the tier at once (hold-bought) or nothing (plan-bought). */
	periodPaidBy?: "plan" | "hold";
	/** Saved-method auto-renewal summary (86eyb6z4r) — OWNER-only surface (this
	 * state rides getMyRetailer, which shoppers never see). `failing` means the
	 * last charge attempt was declined and dunning is running; `setupPending`
	 * means the seller started authorisation but no method attached yet. */
	autoRenew?: {
		method: string;
		methodLabel: string;
		failedAttempts: number;
		failing: boolean;
		nextChargeAt?: number;
	};
	autoRenewSetupPending?: boolean;
	/** Founding onboard promise (86eyb6z4r). A fact about the store, never a
	 * price input: it misses every member an admin marked founding and never
	 * clears after a lapse, so every price reads the server-resolved
	 * `billingGatewayAvailable.foundingPricing` instead (z8r3fdfty4).
	 * Owner-only. */
	foundingIntent?: boolean;
	/** A downgrade scheduled for the end of the paid period (86eyb6z4r). The
	 * seller keeps everything they bought until `effectiveAt`; the renewal
	 * invoice then bills `plan`. Owner-only, and cancellable. */
	pendingPlanChange?: { plan: Plan; effectiveAt: number };
};

/** Pure access resolution from a subscription doc (or null). Exported for tests
 * + the getMyRetailer embed. A missing row → comped full access (fail safe).
 *
 * `opts.adminFullAccess` is set only on the OWNER read when the caller is a
 * Kedaipal admin operating their OWN store: they run the app for free with the
 * highest tier unlocked (never soft-locked, every Pro+ feature on), so we force
 * full `features` + no-limit caps + `active` while KEEPING the real
 * plan/status/trial so the billing page still tells the truth. Mirrors the server bypass in
 * `assertSubscriptionActive`/`assertPlanFeature`; the nav pill separately reads
 * "Admin" (client `adminOwnStore`). See docs/admin-console.md. */
export function resolveAccess(
	sub: Doc<"subscriptions"> | null,
	opts?: { adminFullAccess?: boolean },
): AccessState {
	const base = resolveAccessBase(sub);
	if (!opts?.adminFullAccess) return base;
	return {
		...base,
		// Full access — the highest tier's features and no limits. The SAME
		// entitlement a comped store resolves to below (z8r3fdeub2).
		caps: fullAccessCaps(),
		features: featuresForPlan(FULL_ACCESS_PLAN),
		active: true,
		frozen: false,
	};
}

function resolveAccessBase(sub: Doc<"subscriptions"> | null): AccessState {
	if (!sub) {
		// Fail safe: never lock out a retailer because their subscription row is
		// missing (pre-backfill, or a backfill miss). Treat as comped full access
		// — the same entitlements an admin-granted comp resolves to below.
		return {
			plan: "pro",
			status: "active",
			// A retailer with no subscription row is comped, so no cycle is really
			// being billed. "monthly" is the honest default: it is what every real
			// row starts as, and it keeps the annual offer from being shown to an
			// account that has no billing relationship at all.
			billingCycle: "monthly",
			comped: true,
			caps: fullAccessCaps(),
			features: featuresForPlan(FULL_ACCESS_PLAN),
			active: true,
			frozen: false,
			held: false,
		};
	}
	const comped = sub.comped === true;
	// Soft-lock only bites a real (non-comped) past_due subscription.
	const frozen = sub.status === "past_due" && !comped;
	// A held subscription keeps its tier's features and the dashboard, but its
	// EFFECTIVE order cap is 0 — resolved here, never stored, so a resume needs
	// no rewrite and the stored caps stay the tier's.
	const held = sub.status === "on_hold";
	return {
		plan: sub.plan,
		status: sub.status,
		billingCycle: sub.billingCycle,
		comped,
		comp: sub.comp
			? { kind: sub.comp.kind, label: sub.comp.label }
			: undefined,
		compEnded:
			sub.compEndedAt !== undefined ? { at: sub.compEndedAt } : undefined,
		trialEndsAt: sub.trialEndsAt,
		freePeriodEndedAt: sub.freePeriodEndedAt,
		freePeriodEndReason: sub.freePeriodEndReason,
		currentPeriodEnd: sub.currentPeriodEnd,
		// A comp resolves exactly like an admin's own store (z8r3fdeub2): no
		// limits + the highest tier's features, whatever `plan` the row keeps
		// for the day the comp is turned off. Resolved, never stored.
		caps: comped
			? fullAccessCaps()
			: {
					orderCap: held ? 0 : sub.orderCap,
					userCap: sub.userCap,
					broadcastQuota: sub.broadcastQuota,
				},
		features: featuresForPlan(comped ? FULL_ACCESS_PLAN : sub.plan),
		active: !frozen,
		frozen,
		held,
		heldAt: sub.heldAt,
		periodPaidBy: sub.periodPaidBy,
		autoRenew: sub.autoRenew
			? {
					method: sub.autoRenew.method,
					methodLabel:
						sub.autoRenew.methodLabel ??
						autoRenewMethodLabel(sub.autoRenew.method),
					failedAttempts: sub.autoRenew.failedAttempts ?? 0,
					failing: (sub.autoRenew.failedAttempts ?? 0) > 0,
					nextChargeAt: sub.currentPeriodEnd,
				}
			: undefined,
		autoRenewSetupPending:
			sub.autoRenew === undefined && sub.autoRenewSetup !== undefined
				? true
				: undefined,
		foundingIntent: sub.foundingIntent === true ? true : undefined,
		pendingPlanChange: sub.pendingPlanChange
			? {
					plan: sub.pendingPlanChange.plan,
					// The change lands with the renewal invoice the cron issues
					// once the paid period ends.
					effectiveAt: sub.currentPeriodEnd ?? sub.pendingPlanChange.requestedAt,
				}
			: undefined,
	};
}

/** Load a retailer's subscription (or null). Single-source so every reader uses
 * the same index. */
export async function loadSubscription(
	ctx: AnyCtx,
	retailerId: Id<"retailers">,
): Promise<Doc<"subscriptions"> | null> {
	return ctx.db
		.query("subscriptions")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
		.first();
}

/** Resolve a retailer's access in one call. */
export async function getAccess(
	ctx: AnyCtx,
	retailerId: Id<"retailers">,
): Promise<AccessState> {
	const sub = await loadSubscription(ctx, retailerId);
	if (!sub) {
		console.warn(
			`[subscriptions] no subscription row for retailer ${retailerId} — failing open (comped full access)`,
		);
	}
	return resolveAccess(sub);
}

/**
 * Minutes between the first order and its invoice — deliberately NOT 0.
 * Product: the seller's inbox beat belongs to the ORDER at that moment; the
 * "your first order is in — here's your first invoice" email landing a few
 * minutes later reads as a follow-up, not a toll booth, and the due date
 * (+14d) makes the offset irrelevant. Infrastructure: a zero-delay schedule
 * on the plain order-create path made every real-timer convex-test suite run
 * the billing chain CONCURRENTLY with test transactions — convex-test stages
 * writes on one per-instance stack, which is not concurrency-safe (the
 * intermittent mockup-blob CI failure) — and a scheduled mutation firing
 * after instance teardown crashes its scheduler outright. With a minutes
 * delay the chain is inert inside any test file's lifetime unless a suite
 * advances fake timers on purpose (the invoices.test.ts pattern). Do not
 * lower this below a couple of minutes without re-checking that class.
 */
const FIRST_INVOICE_DELAY_MS = 10 * 60 * 1000;

/**
 * Start-when-you-sell (z8r3fday24): a store's FIRST LIVE ORDER ends its free
 * period and fires the first invoice. Called from the one order-created seam
 * every channel funnels through (`subscriptionUsage.recordOrderCreated` —
 * storefront, counter, claim link, booking), so "first live order" means the
 * first order, full stop. Returns true when this call ended the free period.
 *
 * This reads the subscription row from inside the order pipeline — a
 * deliberate, narrow exception to "the pipeline never reads subscription
 * status": it is a one-time STAMP plus a scheduled job, never a gate. Nothing
 * here can refuse or fail the order: every early return is a silent no-op and
 * the issuance runs in its own scheduled mutation
 * (`invoices.internalIssueFirstInvoice`). `updatedAt` is left alone — it is
 * the status-flip moment, and the status does not change here.
 *
 * Skips: not trialing, comped, already ended, or a store owned by a Kedaipal
 * admin (dogfooding — an identity-blind check on the owner's user id against
 * the same allowlist `isAdmin` uses, so Zaki's own store never bills itself).
 */
export async function endFreePeriodOnFirstOrder(
	ctx: MutationCtx,
	retailerId: Id<"retailers">,
	now: number,
): Promise<boolean> {
	const sub = await loadSubscription(ctx, retailerId);
	if (
		!sub ||
		sub.status !== "trialing" ||
		sub.comped === true ||
		sub.freePeriodEndedAt !== undefined
	)
		return false;
	const retailer = await ctx.db.get(retailerId);
	if (!retailer || adminUserIds().includes(retailer.userId)) return false;
	await ctx.db.patch(sub._id, {
		freePeriodEndedAt: now,
		freePeriodEndReason: "first_order",
	});
	await ctx.scheduler.runAfter(
		FIRST_INVOICE_DELAY_MS,
		internal.invoices.internalIssueFirstInvoice,
		{ subscriptionId: sub._id },
	);
	return true;
}

/**
 * Soft-lock guard for EVERY seller dashboard write. A store whose subscription
 * has lapsed — an unpaid invoice, or an admin turning a comp upgrade off
 * (z8r3fdeub2) — goes VIEW-ONLY: it still reads everything it ever could, and
 * nothing it does changes a row. That deliberately includes moving an order's
 * status, packing, shipping and taking payment, which were allowed until 19 Sep
 * 2026 (owner decision: "same lock as it was for all expired vendors, all
 * actions locked, it's all view only"). Growth-writes were never the point —
 * the point is that an unpaid store cannot be RUN.
 *
 * Throws a `ConvexError` when the subscription is past_due (and not comped).
 * NEVER call from the storefront or the order pipeline — the BUYER's side stays
 * live: browsing, ordering, paying, tracking and editing their own order all
 * keep working, which is the whole reason the lock is soft. Paying Kedaipal
 * stays open too, or the seller could never unlock themselves.
 *
 * Every public seller mutation and action is either guarded here or listed,
 * with its reason, in `convex/sellerLockCoverage.test.ts` — which fails on any
 * new one that is neither.
 */
export async function assertSubscriptionActive(
	ctx: AnyCtx,
	retailerId: Id<"retailers">,
): Promise<void> {
	// Kedaipal admins are never soft-locked — they run the app for free, whether
	// on their own store (dogfooding, past the trial) or on a seller's store during
	// act-as white-glove. Identity-based (ADMIN_USER_IDS) so it self-heals from the
	// allowlist with no `comped` data to backfill or drift. See docs/admin-console.md.
	if (await isAdmin(ctx)) return;
	const access = await getAccess(ctx, retailerId);
	if (access.frozen) {
		throw new ConvexError(
			// A lock from a comp ending has no invoice behind it (z8r3fdeub2) —
			// "pay your invoice" would send the seller hunting for a bill.
			access.compEnded
				? "Your sponsored access has ended, so your store is view-only. Choose a plan in Settings → Billing to start working again — your storefront stays live and buyers can still order in the meantime."
				: "Your subscription is past due, so your store is view-only. Pay your invoice to start working again — your storefront stays live and buyers can still order in the meantime.",
		);
	}
}

/**
 * Same lock, for a seller write whose args carry NO store — the upload-URL
 * minters (`products.generateUploadUrl`, the three on `retailers`), where the
 * store is implied by the caller. Resolves the caller's OWN store and locks on
 * that. A storeless caller passes (there is nothing to lock) and so does an
 * admin, exactly as in `assertSubscriptionActive`; an admin acting-as is
 * bypassed there too, so resolving their own store here is never wrong.
 *
 * The blob these mint can only ever be attached by a guarded mutation, so this
 * is belt-and-braces — but a lapsed store shouldn't be able to write into our
 * storage at all, and a reviewer shouldn't have to reason about it.
 */
export async function assertOwnStoreActive(ctx: AnyCtx): Promise<void> {
	if (await isAdmin(ctx)) return;
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) return; // the caller's own auth check already refused
	const retailer = await ctx.db
		.query("retailers")
		.withIndex("by_user", (q) => q.eq("userId", identity.subject))
		.first();
	if (retailer) await assertSubscriptionActive(ctx, retailer._id);
}

/**
 * The same lock for seller ACTIONS, which have no `ctx.db` and so cannot call
 * the guard directly (Lalamove/Delyva booking, despatch labels, the payment
 * reminder). Internal — an action runs it with `ctx.runQuery` before doing
 * anything the seller would have to undo. A query that throws is the right
 * shape here: it refuses before the action spends a third-party call or an
 * outbound message.
 *
 * **OWNER-GATED** (PR #279 review). These run FIRST in public actions — before
 * the action's own auth — and a public action is callable by anyone holding
 * the deployment URL (it ships in the client bundle). If the lock threw for
 * every caller, "sponsored access has ended" vs the action's ordinary
 * not-found/auth answer would be an unauthenticated oracle for order
 * existence and a store's billing state over the enumerable `shortId` space —
 * the exact channel the trackingToken rule exists to close. So only the
 * store's OWNER can trip the lock; anonymous, foreign and admin callers all
 * pass through to the action's own auth, byte-identical to an unlocked store.
 * (Admins bypass the lock inside `assertSubscriptionActive` anyway, and the
 * action's own access check still refuses outsiders — this guard only ever
 * ADDS the lock refusal, never grants access.)
 */
export const assertWritable = internalQuery({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const retailer = await ctx.db.get(retailerId);
		if (!retailer || retailer.userId !== identity.subject) return null;
		await assertSubscriptionActive(ctx, retailerId);
		return null;
	},
});

/** `assertWritable` for the order actions, which know a `shortId` and nothing
 * else (rider/courier booking, the manual payment reminder). A shortId that
 * resolves to nothing passes — the action's own "not found" answer is the
 * clearer one, and there is no store to lock. Same owner gate as above, for
 * the same oracle reason. */
export const assertWritableForOrder = internalQuery({
	args: { shortId: v.string() },
	handler: async (ctx, { shortId }): Promise<null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const order = await ctx.db
			.query("orders")
			.withIndex("by_shortId", (q) => q.eq("shortId", shortId))
			.unique();
		if (!order) return null;
		const retailer = await ctx.db.get(order.retailerId);
		if (!retailer || retailer.userId !== identity.subject) return null;
		await assertSubscriptionActive(ctx, order.retailerId);
		return null;
	},
});

/** Human label for the gate error — kept here (not in the pure module) since
 * it's copy, not catalog. */
const FEATURE_LABEL: Record<PlanFeature, string> = {
	crm: "The customer database",
	orderInbox: "Order Inbox search, filters and bulk actions",
	chargeablePickup: "Charging a fee on a pickup location",
	categories: "Organizing products into categories",
	insights: "Seller Insights",
	radiusDelivery: "Distance-based delivery pricing",
	delivery: "Lalamove delivery booking",
	onlinePayments: "Online payments (HitPay)",
	events: "Event RSVPs",
	waOrderAlerts: "WhatsApp order alerts",
};

/**
 * Plan-feature gate for Pro-and-above surfaces (CRM, Order Inbox). Throws a
 * `ConvexError` when the retailer's plan doesn't include the feature. Callers
 * that support admin act-as must skip this for `actingAsAdmin` (white-glove
 * support work on a Starter store), mirroring `assertSubscriptionActive`.
 * Fail-safe: a missing subscription row resolves to Pro features (see
 * `resolveAccess`), so a backfill miss can never lock a paying seller out.
 */
export async function assertPlanFeature(
	ctx: AnyCtx,
	retailerId: Id<"retailers">,
	feature: PlanFeature,
): Promise<void> {
	// Kedaipal admins always have the highest tier unlocked — on their OWN store
	// (dogfooding, even past a lapsed trial) or acting-as a seller during
	// white-glove. Mirrors `assertSubscriptionActive`'s bypass. (Act-as callers
	// already skip this via `actingAsAdmin`; this also covers admin-on-own-store,
	// where `actingAsAdmin` is false.) See docs/admin-console.md.
	if (await isAdmin(ctx)) return;
	const access = await getAccess(ctx, retailerId);
	if (!access.features[feature]) {
		throw new ConvexError(
			`${FEATURE_LABEL[feature]} is available on the Pro plan. Upgrade in Settings → Billing to unlock it.`,
		);
	}
}

/** Default entitlement caps to denormalize for a plan (used at signup + on
 * mark-paid reconcile). */
export function defaultCapsForPlan(plan: Plan): {
	orderCap: number;
	userCap: number;
	broadcastQuota: number;
} {
	return capsForPlan(plan);
}

// ---------------------------------------------------------------------------
// Off-Season Hold (z8r3fday24)
// ---------------------------------------------------------------------------

/** The store's single pending invoice, if any. */
async function pendingInvoiceFor(
	ctx: MutationCtx,
	retailerId: Id<"retailers">,
): Promise<Doc<"invoices"> | null> {
	return ctx.db
		.query("invoices")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
		.filter((q) => q.eq(q.field("status"), "pending"))
		.first();
}

/** Void a pending invoice a lifecycle flow is replacing (a plan bill on pause,
 * a hold bill on resume, any bill on an admin comp) and kill its Pay-now link.
 * Nothing has been collected — a pending invoice is a request, not money. */
async function voidPendingInvoice(
	ctx: MutationCtx,
	invoice: Doc<"invoices">,
	by: string,
	reason: string,
	now: number,
): Promise<void> {
	await ctx.db.patch(invoice._id, {
		status: "void",
		voidedAt: now,
		voidedBy: by,
		voidReason: reason,
	});
	if (invoice.gatewayRequestId) {
		await ctx.scheduler.runAfter(
			0,
			internal.subscriptionPayments.expireInvoiceRequest,
			{ requestId: invoice.gatewayRequestId },
		);
	}
}

/**
 * Seller (or admin acting-as): pause the subscription for the season, or
 * resume it. One switch, two directions, both honest about money:
 *
 * PAUSE (`hold: true`) — from `active` or `past_due`, never a trial or a comped
 * row. Status → `on_hold`, `retailers.orderingPausedAt` set (the storefront
 * closes ordering; every order-create path refuses). A pending PLAN invoice is
 * voided — the seller is saying "I'd rather pause than pay the tier". The hold
 * invoice (HOLD_MONTHLY_PRICES) is issued NOW when the paid period is over or
 * a bill was just voided; a seller paid through a future date owes nothing
 * until then and the daily cron bills the hold at `currentPeriodEnd`.
 *
 * RESUME (`hold: false`) — from `on_hold`, or from a lock over an unpaid HOLD
 * invoice. Status → `active` on the tier the row kept, ordering reopens, a
 * pending hold invoice is voided. The tier invoice is issued NOW unless the
 * running period was bought by the plan (they already paid for the month);
 * unused hold days are forfeited — the UI says so before the tap. Either way
 * the seller keeps full access through the invoice's 14-day grace, and only
 * that invoice going overdue locks, exactly like a renewal.
 */
export const setSeasonalHold = mutation({
	args: { retailerId: v.id("retailers"), hold: v.boolean() },
	handler: async (
		ctx,
		{ retailerId, hold },
	): Promise<{ status: SubscriptionStatus; invoiceIssued: boolean }> => {
		const access = await requireRetailerAccess(ctx, retailerId);
		// Billing is view-only under admin act-as (Zaki, 17 Sep 2026): pausing
		// voids and issues invoices on the SELLER's money, and every legitimate
		// admin billing action already lives in Admin → Billing, audited. The
		// owner — including an admin on their own store — is unaffected.
		if (access.actingAsAdmin)
			throw new ConvexError(
				"Billing is view-only while you're acting as a store — the owner pauses or resumes their own plan.",
			);
		// Money-adjacent self-serve toggle: each flip can void an invoice, issue
		// another (which mints a HitPay payment request) and send an email, so it
		// takes the same limiter as `invoices.switchPendingPlan` — a held button
		// must not burn the gateway account, the mail sender, or Arif's invoice
		// list. Keyed by store.
		await rateLimiter.limit(ctx, "billingSelfServe", {
			key: retailerId,
			throws: true,
		});
		const sub = await loadSubscription(ctx, retailerId);
		if (!sub) throw new ConvexError("No subscription found for this store");
		const now = Date.now();
		const pending = await pendingInvoiceFor(ctx, retailerId);

		if (hold) {
			if (sub.status === "on_hold")
				throw new ConvexError("Your subscription is already on hold.");
			if (
				!canEnterHold(
					sub.status,
					sub.comped === true,
					sub.compEndedAt !== undefined,
				)
			)
				throw new ConvexError(
					sub.comped === true
						? "Your account is on the house — there's nothing to pause."
						: sub.compEndedAt !== undefined
							? "Your sponsored access has ended, so there's no plan to pause yet — choose a plan to get editing again."
							: "Off-Season Hold is for paid plans. Finish your free period first — a store that isn't selling yet simply doesn't convert.",
				);
			if (pending) {
				await voidPendingInvoice(
					ctx,
					pending,
					access.userId,
					"Paused for the season — replaced by the hold invoice",
					now,
				);
			}
			await ctx.db.patch(sub._id, {
				status: "on_hold",
				heldAt: now,
				updatedAt: now,
			});
			await ctx.db.patch(retailerId, { orderingPausedAt: now, updatedAt: now });
			const billNow = holdBillsNow({
				currentPeriodEnd: sub.currentPeriodEnd,
				periodPaidBy: sub.periodPaidBy,
				hadPendingInvoice: pending !== null,
				now,
			});
			if (billNow) {
				await ctx.scheduler.runAfter(
					0,
					internal.invoices.internalIssueRenewalInvoice,
					{ subscriptionId: sub._id, force: true },
				);
			}
			await ctx.scheduler.runAfter(0, internal.billingEmail.notifyHoldEmail, {
				retailerId,
				key: "holdStarted",
				billsNow: billNow,
				billsFromAt: billNow ? undefined : sub.currentPeriodEnd,
			});
			await logAdminAction(ctx, access, "subscriptions.setSeasonalHold", sub._id);
			return { status: "on_hold", invoiceIssued: billNow };
		}

		const pendingIsHold = pending?.kind === "hold";
		if (!canResumeHold(sub.status, pendingIsHold))
			throw new ConvexError(
				sub.status === "on_hold" || sub.status === "past_due"
					? "There's an unpaid plan invoice on this store — settle it to get back to your plan."
					: "Your subscription isn't on hold.",
			);
		if (pending && pendingIsHold) {
			await voidPendingInvoice(
				ctx,
				pending,
				access.userId,
				"Resumed the plan — replaced by the plan invoice",
				now,
			);
		}
		await ctx.db.patch(sub._id, {
			status: "active",
			heldAt: undefined,
			updatedAt: now,
		});
		await ctx.db.patch(retailerId, {
			orderingPausedAt: undefined,
			updatedAt: now,
		});
		const billNow = resumeBillsNow({
			currentPeriodEnd: sub.currentPeriodEnd,
			periodPaidBy: sub.periodPaidBy,
			now,
		});
		if (billNow) {
			await ctx.scheduler.runAfter(
				0,
				internal.invoices.internalIssueRenewalInvoice,
				{ subscriptionId: sub._id, force: true },
			);
		}
		await ctx.scheduler.runAfter(0, internal.billingEmail.notifyHoldEmail, {
			retailerId,
			key: "holdResumed",
			billsNow: billNow,
			billsFromAt: billNow ? undefined : sub.currentPeriodEnd,
		});
		await logAdminAction(ctx, access, "subscriptions.setSeasonalHold", sub._id);
		return { status: "active", invoiceIssued: billNow };
	},
});

// ---------------------------------------------------------------------------
// Comp accounts (z8r3fdeub2) — admin-granted free access for partners/sponsors
// ---------------------------------------------------------------------------

/**
 * The ONE comp-ending path (z8r3fdeub2): an admin turned the comp upgrade off,
 * and the store becomes an EXPIRED seller — `past_due` with no invoice, the
 * same lock a lapsed subscription is in. The storefront stays live and buyers
 * keep ordering (the order pipeline never reads subscription status);
 * dashboard growth-writes are refused by `assertSubscriptionActive` until the
 * seller picks a plan and pays, which settles the row to `active` like any
 * renewal. No free period: a comped store already had its runway, and a trial
 * would turn "off" into two more free weeks.
 *
 * `compEndedAt` lets the dashboard say "your sponsored access ended" rather
 * than "your subscription is past due", and the seller is emailed. The stored
 * plan + caps stay (the plan picker's default), and a saved auto-renew method
 * is deliberately KEPT: with no invoice there is nothing to charge, and a plan
 * the seller picks charges it through the normal subscribe flow (whose copy
 * names the saved method before the tap). `updatedAt` moves — this IS the
 * lock-flip moment the founder report reads.
 */
async function endComp(
	ctx: MutationCtx,
	sub: Doc<"subscriptions">,
	now: number,
): Promise<void> {
	// Defensive: a comped row can't be `on_hold` today (`setComp` releases the
	// hold, `canEnterHold` refuses comped rows) — but if a fifth producer of
	// `comped` ever appears, leaving `orderingPausedAt` set under `past_due`
	// would pause the storefront with no path that ever resumes it (neither
	// hold flow accepts a past_due row). Cheap to make impossible.
	if (sub.status === "on_hold") {
		await ctx.db.patch(sub.retailerId, {
			orderingPausedAt: undefined,
			updatedAt: now,
		});
	}
	await ctx.db.patch(sub._id, {
		comped: false,
		comp: undefined,
		compEndedAt: now,
		status: "past_due",
		trialEndsAt: undefined,
		trialReminderSentAt: undefined,
		freePeriodEndedAt: undefined,
		freePeriodEndReason: undefined,
		currentPeriodStart: undefined,
		currentPeriodEnd: undefined,
		periodPaidBy: undefined,
		heldAt: undefined,
		pendingPlanChange: undefined,
		updatedAt: now,
	});
	await ctx.scheduler.runAfter(0, internal.billingEmail.notifyTrialEmail, {
		retailerId: sub.retailerId,
		key: "compEnded",
		sponsorLabel: sub.comp?.label,
	});
}

/**
 * Admin: turn a store's comp upgrade ON (partner / sponsor / pilot /
 * internal). A comp is a toggle with no end date — it stays on until an admin
 * turns it off (`revokeComp`). While on, the store resolves exactly like a
 * Kedaipal admin's own store — the highest tier's features and no limits
 * (`fullAccessCaps`), never billed, never soft-locked — minus admin access;
 * and there is nothing for the seller to subscribe to, change or pause (every
 * self-serve billing mutation refuses a comped row). Also the EDIT path:
 * calling it on a comped store rewrites kind/label/note with no gap in access,
 * keeping who first turned it on and when.
 *
 * What turning it on does, atomically:
 *  - `comped: true` + the `comp` stamp (who/why) — the stamp is what keeps the
 *    backfill from healing this row into a trial;
 *  - status → `active`; every trial / free-period / paid-period stamp and a
 *    pending plan change cleared (a comp has no billing clock — a leftover
 *    paid-through date would read "expires {date}" under a sponsor line);
 *    the stored plan + caps are left alone, since a comp's entitlements are
 *    resolved at read time (`resolveAccess`);
 *  - any pending invoice VOIDED (its Pay-now link killed) — comping a
 *    `past_due` store lifts the lock in the same beat;
 *  - an `on_hold` store released (ordering reopens — a comped store should be
 *    selling, and comped rows can never re-enter hold);
 *  - a previous comp's off-marker cleared — re-comping an expired store;
 *  - an `adminAuditLog` row, always (targetId = the retailer).
 *
 * A store with NO subscription row (pre-backfill fail-open) gets a real row
 * minted so the comp has somewhere to live. Admin-owned stores are refused —
 * they already run free via ADMIN_USER_IDS, and a comp would just shadow it.
 * `updatedAt` moves: this IS a status flip (→ active), the same moment every
 * settle stamps.
 */
export const setComp = mutation({
	args: {
		retailerId: v.id("retailers"),
		kind: v.union(
			v.literal("partner"),
			v.literal("sponsor"),
			v.literal("pilot"),
			v.literal("internal"),
		),
		label: v.optional(v.string()),
		note: v.optional(v.string()),
	},
	handler: async (
		ctx,
		{ retailerId, kind, label, note },
	): Promise<{ ok: true }> => {
		const adminSubject = await requireAdmin(ctx);
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) throw new ConvexError("Store not found");
		if (adminUserIds().includes(retailer.userId))
			throw new ConvexError(
				"This is an admin store — it already runs free, nothing to comp.",
			);
		const trimmedLabel = label?.trim() || undefined;
		const trimmedNote = note?.trim() || undefined;
		if (trimmedLabel !== undefined && trimmedLabel.length > COMP_LABEL_MAX)
			throw new ConvexError(
				`Keep the label under ${COMP_LABEL_MAX} characters — it renders as one line on the seller's billing tab.`,
			);
		if (trimmedNote !== undefined && trimmedNote.length > COMP_NOTE_MAX)
			throw new ConvexError(
				`Keep the note under ${COMP_NOTE_MAX} characters.`,
			);
		const now = Date.now();

		const sub = await loadSubscription(ctx, retailerId);
		// An edit keeps who first turned the comp on, and when; the audit log
		// records the edit itself.
		const alreadyOn = sub?.comped === true && sub.comp !== undefined;
		const comp = {
			kind,
			label: trimmedLabel,
			note: trimmedNote,
			grantedBy: alreadyOn && sub?.comp ? sub.comp.grantedBy : adminSubject,
			grantedAt: alreadyOn && sub?.comp ? sub.comp.grantedAt : now,
		};
		if (!sub) {
			// Pre-backfill store, fail-open today — mint the row the comp lives on.
			const caps = capsForPlan("pro");
			await ctx.db.insert("subscriptions", {
				retailerId,
				plan: "pro",
				billingCycle: "monthly",
				status: "active",
				comped: true,
				comp,
				orderCap: caps.orderCap,
				userCap: caps.userCap,
				broadcastQuota: caps.broadcastQuota,
				createdAt: now,
				updatedAt: now,
			});
		} else {
			const pending = await pendingInvoiceFor(ctx, retailerId);
			if (pending) {
				await voidPendingInvoice(
					ctx,
					pending,
					adminSubject,
					"Comped — this store is on the house",
					now,
				);
			}
			if (sub.status === "on_hold") {
				// Release the hold's storefront pause — a comped store should be
				// selling, and `canEnterHold` refuses comped rows from here on.
				await ctx.db.patch(retailerId, {
					orderingPausedAt: undefined,
					updatedAt: now,
				});
			}
			await ctx.db.patch(sub._id, {
				comped: true,
				comp,
				compEndedAt: undefined,
				status: "active",
				trialEndsAt: undefined,
				trialReminderSentAt: undefined,
				freePeriodEndedAt: undefined,
				freePeriodEndReason: undefined,
				currentPeriodStart: undefined,
				currentPeriodEnd: undefined,
				periodPaidBy: undefined,
				heldAt: undefined,
				pendingPlanChange: undefined,
				// An edit is not a status flip — only turning it on moves the clock.
				updatedAt: alreadyOn ? sub.updatedAt : now,
			});
		}
		// Always recorded: an admin store can't be comped (refused above), so this
		// is by construction an admin acting on someone else's store.
		await logAdminAction(
			ctx,
			{ retailer, actingAsAdmin: true, userId: adminSubject },
			"subscriptions.setComp",
			retailerId,
		);
		return { ok: true };
	},
});

/**
 * Admin: turn a store's comp upgrade OFF. The store becomes an expired seller
 * straight away (`endComp`): storefront live, buyers still ordering, editing
 * locked until the seller picks a plan and pays — and they're emailed saying
 * so. Works on legacy fail-safe comped rows too (no `comp` stamp). Turning it
 * back on is always one dialog away.
 */
export const revokeComp = mutation({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }): Promise<{ ok: true }> => {
		const adminSubject = await requireAdmin(ctx);
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) throw new ConvexError("Store not found");
		const sub = await loadSubscription(ctx, retailerId);
		if (!sub || sub.comped !== true)
			throw new ConvexError("This store isn't comped.");
		await endComp(ctx, sub, Date.now());
		await logAdminAction(
			ctx,
			{ retailer, actingAsAdmin: true, userId: adminSubject },
			"subscriptions.revokeComp",
			retailerId,
		);
		return { ok: true };
	},
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** The caller's subscription summary — drives the billing page + nav pill.
 * Returns null when unauthenticated or no retailer/subscription yet. */
export const current = query({
	args: {},
	handler: async (
		ctx,
	): Promise<(AccessState & { createdAt?: number }) | null> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const retailer = await ctx.db
			.query("retailers")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.first();
		if (!retailer) return null;
		const sub = await loadSubscription(ctx, retailer._id);
		// Admin on their own store → highest tier unlocked, matching the
		// getMyRetailer embed (caller === owner here). See docs/admin-console.md.
		const adminFullAccess = await isAdmin(ctx);
		// `billingCycle` used to be spread on here by hand. It now rides on
		// AccessState itself — and re-adding it would be a regression, not a
		// duplicate: `sub?.billingCycle` is `undefined` for a missing row, which
		// would overwrite resolveAccess's "monthly" default with nothing.
		return {
			...resolveAccess(sub, { adminFullAccess }),
			createdAt: sub?.createdAt,
		};
	},
});

// Re-export so callers can map a plan → its canonical caps without importing the
// pure module separately.
export { PLAN_CAPS };

// ---------------------------------------------------------------------------
// Internal mutations (backfill + cron). Not callable from the client.
// ---------------------------------------------------------------------------

/**
 * ONE-TIME backfill: every retailer that predates billing is dropped into the
 * normal lifecycle on a fresh **14-day Pro trial** (`trialing`, non-comped, Pro
 * caps). They're NOT free forever — the trial countdown banner shows, and the
 * daily cron soft-locks them to `past_due` when it lapses, exactly like a new
 * signup. Grandfathered shops therefore get a fair 14-day runway from the moment
 * billing goes live, then must convert.
 *
 * Convergent + idempotent:
 *  - no subscription → create a trialing one (`created`).
 *  - a leftover `comped` row from an earlier backfill run → convert it to the
 *    same 14-day trial (`converted`). Only STAMPLESS rows (`comp` undefined)
 *    qualify — an admin-granted comp (z8r3fdeub2) carries a `comp` stamp and
 *    survives a re-run untouched.
 *  - any other (real) subscription → leave untouched (`skipped`).
 *
 * Run once between the schema deploy and gating enable (see
 * docs/manual-subscription.md rollout sequence). Returns counts.
 */
export const internalBackfillSubscriptions = internalMutation({
	args: {},
	handler: async (
		ctx,
	): Promise<{ created: number; converted: number; skipped: number }> => {
		const retailers = await ctx.db.query("retailers").collect();
		const caps = capsForPlan("pro");
		const now = Date.now();
		const trialEndsAt = now + TRIAL_DAYS * DAY_MS;
		let created = 0;
		let converted = 0;
		let skipped = 0;
		for (const r of retailers) {
			const existing = await loadSubscription(ctx, r._id);
			if (existing) {
				// Heal a stale comped row from a previous backfill into the trial —
				// but ONLY the stampless legacy fail-safe rows. An admin-granted
				// comp carries a `comp` stamp (z8r3fdeub2) and survives a re-run.
				if (existing.comped === true && existing.comp === undefined) {
					await ctx.db.patch(existing._id, {
						plan: "pro",
						status: "trialing",
						trialEndsAt,
						comped: false,
						orderCap: caps.orderCap,
						userCap: caps.userCap,
						broadcastQuota: caps.broadcastQuota,
						updatedAt: now,
					});
					converted++;
					continue;
				}
				skipped++;
				continue;
			}
			await ctx.db.insert("subscriptions", {
				retailerId: r._id,
				plan: "pro",
				billingCycle: "monthly",
				status: "trialing",
				trialEndsAt,
				orderCap: caps.orderCap,
				userCap: caps.userCap,
				broadcastQuota: caps.broadcastQuota,
				createdAt: now,
				updatedAt: now,
			});
			created++;
		}
		return { created, converted, skipped };
	},
});

/**
 * Daily status cron. Flips:
 *  - `trialing → past_due` when the FIRST INVOICE is overdue (z8r3fday24 —
 *    "trial lapsed → locked" is gone: the free period ending, by first order
 *    or by the `trialEndsAt` backstop, ISSUES the first invoice and that
 *    invoice's dueDate is the only lock, exactly like a renewal).
 *  - `active → past_due` when the retailer has a still-pending invoice past its
 *    `dueDate` (founding ghost / unpaid renewal). Comped subs are never flipped.
 * Since 86eyb6z4r it also RUNS the renewal machine:
 *  - a lapsed period with no pending invoice auto-issues the renewal invoice
 *    (invoices.internalIssueRenewalInvoice — the bill Arif used to type), and
 *    schedules the tokenised auto-charge when a saved method is attached;
 *  - failed auto-charges are retried on the Kedaipal-owned schedule
 *    (`autoRenew.nextRetryAt`, lib/hitpayBilling.ts);
 *  - auto-renew sellers get a one-per-cycle "renewing soon" notice ahead of
 *    the charge (the no-surprise-MIT rule).
 * Plus the one-time pre-due-date reminder for pending invoices, and — once an
 * invoice is PAST due and its subscription actually locked — the post-lock
 * recovery ladder at +3d / +7d (z8r3fdg3mh), which before now was silence.
 * Runs once daily — a retailer keeps access up to ~24h past any boundary (acceptable
 * grace). See docs/manual-subscription.md + docs/hitpay-recurring.md.
 */
const REMINDER_DAYS_BEFORE = 3;
/** Post-lock recovery chain (z8r3fdg3mh): days PAST the due date at which each
 * nudge fires. The lock itself (and `invoiceOverdue`) lands on day 0. */
const RECOVERY_NUDGE_DAYS = 3;
const RECOVERY_FINAL_DAYS = 7;

export const internalDailyBillingStatus = internalMutation({
	args: {},
	handler: async (
		ctx,
	): Promise<{
		/** Trials locked over an OVERDUE first invoice. */
		trialExpired: number;
		/** Free periods the backstop ended → first invoices scheduled. */
		firstInvoicesIssued: number;
		overdue: number;
		renewalsIssued: number;
		autoChargeRetries: number;
		renewalNotices: number;
		renewalsDue: number;
		remindersSent: number;
		/** Post-lock recovery nudges scheduled this run (z8r3fdg3mh). */
		recoveryNudges: number;
		trialReminders: number;
	}> => {
		const now = Date.now();
		let trialExpired = 0;
		let firstInvoicesIssued = 0;
		let overdue = 0;
		let renewalsIssued = 0;
		let autoChargeRetries = 0;
		let renewalNotices = 0;
		let renewalsDue = 0;
		let remindersSent = 0;
		let recoveryNudges = 0;
		// Invoices whose subscription LOCKED during this very run. The lock
		// transition owns day 0 — it sends `invoiceOverdue` and the WhatsApp — so
		// the recovery ladder below must not also chase them on the same pass.
		// Normally moot (a daily cron catches an invoice <1 day overdue, which is
		// under every threshold), but after a missed run the ladder would see a
		// freshly-locked invoice already 5 days past due and fire a second,
		// near-identical email the same minute. That is exactly the dunning spam
		// this chain exists to avoid.
		const lockedThisRun = new Set<string>();
		let trialReminders = 0;

		// Trials — start-when-you-sell (z8r3fday24). The free period ends at the
		// store's first live order (stamped by endFreePeriodOnFirstOrder from the
		// order pipeline's usage seam) or at the `trialEndsAt` backstop here,
		// whichever comes first. Either way the machine writes the first invoice
		// (invoices.internalIssueFirstInvoice) and the seller keeps full access
		// through its 14-day grace — that invoice's dueDate is the ONLY lock.
		const trialing = await ctx.db
			.query("subscriptions")
			.withIndex("by_status", (q) => q.eq("status", "trialing"))
			.collect();
		for (const sub of trialing) {
			// A comped row is never billed and never flipped. The legacy
			// comped→past_due "keep the status honest" flip is retired
			// (z8r3fdeub2): stamped comps are always `active`, and a leftover
			// backfill row just waits for internalBackfillSubscriptions to heal
			// it into a real trial.
			if (sub.comped === true) continue;
			if (sub.freePeriodEndedAt === undefined) {
				if (sub.trialEndsAt === undefined) continue;
				if (sub.trialEndsAt < now) {
					// Backstop: end the free period + issue the first invoice. No lock,
					// no status change — `updatedAt` stays the flip moment it was.
					await ctx.db.patch(sub._id, {
						freePeriodEndedAt: now,
						freePeriodEndReason: "backstop",
					});
					await ctx.scheduler.runAfter(
						0,
						internal.invoices.internalIssueFirstInvoice,
						{ subscriptionId: sub._id },
					);
					firstInvoicesIssued++;
					continue;
				}
				// "Free period ends in 3 days" (once, deduped by trialReminderSentAt).
				const daysLeft = Math.ceil((sub.trialEndsAt - now) / DAY_MS);
				if (daysLeft <= 3 && sub.trialReminderSentAt === undefined) {
					await ctx.db.patch(sub._id, { trialReminderSentAt: now });
					await ctx.scheduler.runAfter(
						0,
						internal.billingEmail.notifyTrialEmail,
						{ retailerId: sub.retailerId, key: "trialEndingSoon", daysLeft },
					);
					trialReminders++;
				}
				continue;
			}
			// Free period over → the first invoice is the clock.
			const invoices = await ctx.db
				.query("invoices")
				.withIndex("by_retailer", (q) => q.eq("retailerId", sub.retailerId))
				.collect();
			const pending = invoices.find((inv) => inv.status === "pending");
			if (pending) {
				if (pending.dueDate < now) {
					await ctx.db.patch(sub._id, { status: "past_due", updatedAt: now });
					trialExpired++;
					// "Now locked — pay to resume" (once, on the transition).
					await ctx.scheduler.runAfter(
						0,
						internal.billingEmail.notifyInvoiceOverdue,
						{ invoiceId: pending._id },
					);
					// …and the one WhatsApp of the whole billing chain (z8r3fdg3mh).
					// Email is the channel that always works; this is the louder
					// second tap for a cohort that lives in WhatsApp, not inboxes.
					await ctx.scheduler.runAfter(
						0,
						internal.whatsapp.notifyBillingPastDue,
						{ invoiceId: pending._id },
					);
					lockedThisRun.add(pending._id);
				}
				continue;
			}
			// A settle moves the row to `active`, so a paid invoice here is a
			// mid-transaction glimpse at most — never re-bill over it.
			if (invoices.some((inv) => inv.status === "paid")) continue;
			// The free period ended but no bill exists (the issuance failed, or it
			// was voided without a replacement): write it again rather than lock.
			// The bill IS the lock's clock — with none there is nothing to be
			// overdue on. (To give a store free service, comp it — don't void.)
			await ctx.scheduler.runAfter(
				0,
				internal.invoices.internalIssueFirstInvoice,
				{ subscriptionId: sub._id },
			);
			firstInvoicesIssued++;
		}

		// Active + held subs: overdue lock, auto-charge retries, renewal issuance
		// (the tier invoice for active, the hold invoice for on_hold — one loop,
		// internalIssueRenewalInvoice picks the kind), and the pre-renewal window.
		const RENEWAL_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days out
		const active = [
			...(await ctx.db
				.query("subscriptions")
				.withIndex("by_status", (q) => q.eq("status", "active"))
				.collect()),
			...(await ctx.db
				.query("subscriptions")
				.withIndex("by_status", (q) => q.eq("status", "on_hold"))
				.collect()),
		];
		for (const sub of active) {
			// A comped row has no billing clock at all (z8r3fdeub2) — it never ends
			// on a date, so nothing below (overdue lock, dunning, renewal issuance)
			// may touch it. Only an admin turning the comp off changes it.
			if (sub.comped === true) continue;
			const invoices = await ctx.db
				.query("invoices")
				.withIndex("by_retailer", (q) => q.eq("retailerId", sub.retailerId))
				.collect();
			const overduePending = invoices.find(
				(inv) => inv.status === "pending" && inv.dueDate < now,
			);
			if (overduePending) {
				await ctx.db.patch(sub._id, { status: "past_due", updatedAt: now });
				overdue++;
				// "Now locked — pay to resume" email (once, on the transition).
				await ctx.scheduler.runAfter(
					0,
					internal.billingEmail.notifyInvoiceOverdue,
					{ invoiceId: overduePending._id },
				);
				// …and the one WhatsApp of the whole billing chain (z8r3fdg3mh).
				await ctx.scheduler.runAfter(
					0,
					internal.whatsapp.notifyBillingPastDue,
					{ invoiceId: overduePending._id },
				);
				lockedThisRun.add(overduePending._id);
				continue;
			}
			const pendingInvoice = invoices.find((inv) => inv.status === "pending");
			// Dunning retry: a declined auto-charge whose retry window arrived.
			// The charge action re-guards everything (still pending, still
			// attached, outcome-unknown reconcile), so scheduling is safe.
			if (
				pendingInvoice &&
				sub.autoRenew?.nextRetryAt !== undefined &&
				sub.autoRenew.nextRetryAt <= now
			) {
				await ctx.scheduler.runAfter(
					0,
					internal.subscriptionPayments.chargeDueRenewal,
					{ invoiceId: pendingInvoice._id },
				);
				autoChargeRetries++;
			}
			// Period lapsed with no pending invoice → ISSUE THE RENEWAL (86eyb6z4r).
			// This was the lock-them-out branch when renewals were Arif-typed; the
			// machine now writes the bill instead, and the seller keeps access
			// through the invoice's grace window exactly like every other pending
			// invoice. The overdue branch above is still the lock.
			if (
				!pendingInvoice &&
				sub.currentPeriodEnd !== undefined &&
				sub.currentPeriodEnd < now
			) {
				await ctx.scheduler.runAfter(
					0,
					internal.invoices.internalIssueRenewalInvoice,
					{ subscriptionId: sub._id },
				);
				renewalsIssued++;
				continue;
			}
			if (
				sub.currentPeriodEnd !== undefined &&
				sub.currentPeriodEnd - now <= RENEWAL_WINDOW_MS &&
				sub.currentPeriodEnd > now
			) {
				renewalsDue++;
				console.info(
					`[billing] renewal due soon for retailer ${sub.retailerId} (periodEnd ${new Date(sub.currentPeriodEnd).toISOString()})`,
				);
				// Auto-renew sellers get a one-per-cycle heads-up BEFORE the charge
				// (no surprise merchant-initiated debits). Stamp deliberately skips
				// `updatedAt` — for past_due rows that field is the lock-flip moment
				// the founder report reads (docs/shipped-log.md).
				if (
					sub.autoRenew !== undefined &&
					sub.renewalNoticeSentForPeriodEnd !== sub.currentPeriodEnd
				) {
					await ctx.db.patch(sub._id, {
						renewalNoticeSentForPeriodEnd: sub.currentPeriodEnd,
					});
					await ctx.scheduler.runAfter(
						0,
						internal.billingEmail.notifyAutoRenewEmail,
						{
							retailerId: sub.retailerId,
							key: "autoRenewUpcoming",
							chargeAt: sub.currentPeriodEnd,
							methodLabel:
								sub.autoRenew.methodLabel ??
								autoRenewMethodLabel(sub.autoRenew.method),
						},
					);
					renewalNotices++;
				}
			}
		}

		// Founding-benefit lifecycle (z8r3fdfyw5) — T-14 warning, then revocation
		// past the window. Its own pass over the `foundingMembers` ledger rather
		// than a branch in the loops above, because a lapsed member is `past_due`
		// and NONE of those loops walk `past_due` — see the comment on
		// internalRevokeLapsedBenefits. Scheduled, not inlined, so a failure there
		// can't roll back the billing writes this pass has already made.
		await ctx.scheduler.runAfter(
			0,
			internal.foundingMembers.internalRevokeLapsedBenefits,
			{},
		);

		// Pre-due-date reminder email — once per pending invoice, in the window
		// [due − 3 days, due). Stamping `reminderSentAt` keeps it idempotent across
		// daily runs. Overdue invoices are handled by the soft-lock + banner above,
		// not another email.
		const reminderFrom = now;
		const reminderTo = now + REMINDER_DAYS_BEFORE * DAY_MS;
		const pending = await ctx.db
			.query("invoices")
			.withIndex("by_status", (q) => q.eq("status", "pending"))
			.collect();
		for (const inv of pending) {
			// Post-lock recovery chain (z8r3fdg3mh): an invoice already PAST its
			// due date is out of reminder territory — the seller is locked, and
			// the ladder below is what chases them. Before this existed the
			// `invoiceOverdue` mail on the flip was the last contact they ever got.
			if (inv.dueDate < now) {
				// Locked moments ago by the loops above — that notice is enough
				// for today; the ladder picks up from the next daily run.
				if (lockedThisRun.has(inv._id)) continue;
				// The chain speaks in the first person about a LOCKED dashboard, so
				// it must only run where a lock actually happened. An overdue
				// pending invoice is not sufficient on its own: the loops above
				// skip comped subscriptions entirely, so a store comped after its
				// invoice was issued sits overdue forever with full access — and
				// telling them they're locked would be flatly untrue. `past_due` +
				// not-comped IS the soft-lock predicate (see accessFor).
				const lockSub = await ctx.db.get(inv.subscriptionId);
				if (
					!lockSub ||
					lockSub.status !== "past_due" ||
					lockSub.comped === true
				)
					continue;
				// …and the OTHER way `frozen` is false at `past_due`: the store is
				// an admin's own. They are never soft-locked and the billing tab
				// tells them admins have no invoices to settle, so chasing them
				// would contradict the product to its own operators.
				const lockRetailer = await ctx.db.get(inv.retailerId);
				if (!lockRetailer || storeOwnerIsAdmin(lockRetailer)) continue;
				const daysPastDue = Math.floor((now - inv.dueDate) / DAY_MS);
				// Send only the HIGHEST stage that's due and stamp it, skipping any
				// it passed. A cron outage that leaves an invoice at day 9 with no
				// stage must produce one final notice, not a +3d today and a +7d
				// tomorrow — the seller would read that as a system flailing.
				const stage =
					daysPastDue >= RECOVERY_FINAL_DAYS
						? 2
						: daysPastDue >= RECOVERY_NUDGE_DAYS
							? 1
							: 0;
				if (stage > (inv.recoveryStage ?? 0)) {
					await ctx.db.patch(inv._id, { recoveryStage: stage });
					await ctx.scheduler.runAfter(
						0,
						internal.billingEmail.notifyInvoiceRecovery,
						{ invoiceId: inv._id, stage: stage as 1 | 2, daysPastDue },
					);
					recoveryNudges++;
				}
				continue;
			}
			if (inv.reminderSentAt !== undefined) continue;
			if (inv.dueDate <= reminderFrom || inv.dueDate > reminderTo) continue;
			await ctx.db.patch(inv._id, { reminderSentAt: now });
			await ctx.scheduler.runAfter(
				0,
				internal.billingEmail.notifyInvoiceReminder,
				{ invoiceId: inv._id },
			);
			remindersSent++;
		}

		return {
			trialExpired,
			firstInvoicesIssued,
			overdue,
			renewalsIssued,
			autoChargeRetries,
			renewalNotices,
			renewalsDue,
			remindersSent,
			recoveryNudges,
			trialReminders,
		};
	},
});
