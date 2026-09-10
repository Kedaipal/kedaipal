// Subscription reads + the soft-lock access guard. The whole manual-billing model
// rests on `resolveAccess`: it turns a retailer's subscription into an access
// descriptor that the seller-side dashboard reads (nav pill, disabled-with-reason
// UI) and that `assertSubscriptionActive` enforces on growth-write mutations.
//
// Two invariants the rest of the system depends on:
//  1. FAIL SAFE — a missing subscription row resolves to FULL access (comped),
//     logged, never locked. So a backfill miss degrades to "works", not "locked
//     out" (ticket launch-blocker EC).
//  2. The storefront + order pipeline NEVER call this — they're public and stay
//     live regardless of subscription status. Soft-lock freezes only the seller's
//     dashboard growth-writes (products, settings, future broadcast).
//
// See docs/manual-subscription.md.

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalMutation,
	mutation,
	type MutationCtx,
	query,
	type QueryCtx,
} from "./_generated/server";
import {
	adminUserIds,
	isAdmin,
	logAdminAction,
	requireRetailerAccess,
} from "./lib/auth";
import { autoRenewMethodLabel } from "./lib/hitpayBilling";
import {
	type BillingCycle,
	capsForPlan,
	featuresForPlan,
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
	/** Founding onboard promise (86eyb6z4r): lets the self-serve plan picker
	 * show the discounted Pro price this store was promised. Owner-only. */
	foundingIntent?: boolean;
};

/** Pure access resolution from a subscription doc (or null). Exported for tests
 * + the getMyRetailer embed. A missing row → comped full access (fail safe).
 *
 * `opts.adminFullAccess` is set only on the OWNER read when the caller is a
 * Kedaipal admin operating their OWN store: they run the app for free with the
 * highest tier unlocked (never soft-locked, every Pro+ feature on), so we force
 * full `features` + `active` while KEEPING the real plan/status/trial so the
 * billing page still tells the truth. Mirrors the server bypass in
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
		// Highest tier — an admin should have any Pro/Scale-only feature.
		features: featuresForPlan("scale"),
		active: true,
		frozen: false,
	};
}

function resolveAccessBase(sub: Doc<"subscriptions"> | null): AccessState {
	if (!sub) {
		// Fail safe: never lock out a retailer because their subscription row is
		// missing (pre-backfill, or a backfill miss). Treat as comped full access.
		const caps = capsForPlan("pro");
		return {
			plan: "pro",
			status: "active",
			// A retailer with no subscription row is comped, so no cycle is really
			// being billed. "monthly" is the honest default: it is what every real
			// row starts as, and it keeps the annual offer from being shown to an
			// account that has no billing relationship at all.
			billingCycle: "monthly",
			comped: true,
			caps,
			features: featuresForPlan("pro"),
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
		trialEndsAt: sub.trialEndsAt,
		freePeriodEndedAt: sub.freePeriodEndedAt,
		freePeriodEndReason: sub.freePeriodEndReason,
		currentPeriodEnd: sub.currentPeriodEnd,
		caps: {
			orderCap: held ? 0 : sub.orderCap,
			userCap: sub.userCap,
			broadcastQuota: sub.broadcastQuota,
		},
		features: featuresForPlan(sub.plan),
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
 * Soft-lock guard for seller dashboard GROWTH-WRITES (product create/update,
 * updateSettings, future broadcast/reminder). Throws a `ConvexError` when the
 * subscription is past_due (and not comped). NEVER call from the storefront or
 * the order pipeline — those must stay live for the buyer.
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
			"Your subscription is past due. Pay your invoice to keep editing your store — your storefront and existing orders stay live in the meantime.",
		);
	}
}

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

/** Void a pending invoice the hold flow is replacing (a plan bill on pause, a
 * hold bill on resume) and kill its Pay-now link. Nothing has been collected
 * — a pending invoice is a request, not money. */
async function voidForHoldFlow(
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
		const sub = await loadSubscription(ctx, retailerId);
		if (!sub) throw new ConvexError("No subscription found for this store");
		const now = Date.now();
		const pending = await pendingInvoiceFor(ctx, retailerId);

		if (hold) {
			if (sub.status === "on_hold")
				throw new ConvexError("Your subscription is already on hold.");
			if (!canEnterHold(sub.status, sub.comped === true))
				throw new ConvexError(
					sub.comped === true
						? "Your account is on the house — there's nothing to pause."
						: "Off-Season Hold is for paid plans. Finish your free period first — a store that isn't selling yet simply doesn't convert.",
				);
			if (pending) {
				await voidForHoldFlow(
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
			await voidForHoldFlow(
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
 *    same 14-day trial (`converted`). At v1 `comped` is only ever produced by an
 *    earlier backfill, so this safely heals a re-run without touching real subs.
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
				// Heal a stale comped row from a previous backfill into the trial.
				if (existing.comped === true) {
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
 * Plus the one-time pre-due-date reminder for pending invoices. Runs once
 * daily — a retailer keeps access up to ~24h past any boundary (acceptable
 * grace). See docs/manual-subscription.md + docs/hitpay-recurring.md.
 */
const REMINDER_DAYS_BEFORE = 3;

export const internalDailyBillingStatus = internalMutation({
	args: {},
	handler: async (
		ctx,
	): Promise<{
		/** Trials locked over an OVERDUE first invoice (+ the legacy comped flip). */
		trialExpired: number;
		/** Free periods the backstop ended → first invoices scheduled. */
		firstInvoicesIssued: number;
		overdue: number;
		renewalsIssued: number;
		autoChargeRetries: number;
		renewalNotices: number;
		renewalsDue: number;
		remindersSent: number;
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
			if (sub.freePeriodEndedAt === undefined) {
				if (sub.trialEndsAt === undefined) continue;
				if (sub.trialEndsAt < now) {
					if (sub.comped === true) {
						// A comped row can't be billed; the legacy flip keeps its status
						// honest (comped is never frozen, so nothing actually locks).
						await ctx.db.patch(sub._id, { status: "past_due", updatedAt: now });
						trialExpired++;
						continue;
					}
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
			if (sub.comped === true) continue;
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
			trialReminders,
		};
	},
});
