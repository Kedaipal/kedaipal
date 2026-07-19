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

import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalMutation,
	type MutationCtx,
	query,
	type QueryCtx,
} from "./_generated/server";
import { isAdmin } from "./lib/auth";
import {
	capsForPlan,
	featuresForPlan,
	type Plan,
	PLAN_CAPS,
	type PlanFeature,
	type PlanFeatures,
	TRIAL_DAYS,
} from "./lib/plans";

const DAY_MS = 24 * 60 * 60 * 1000;

type AnyCtx = QueryCtx | MutationCtx;

export type SubscriptionStatus =
	| "trialing"
	| "active"
	| "past_due"
	| "cancelled";

export type AccessState = {
	plan: Plan;
	status: SubscriptionStatus;
	comped: boolean;
	trialEndsAt?: number;
	currentPeriodEnd?: number;
	caps: { orderCap: number; userCap: number; broadcastQuota: number };
	/** Boolean feature entitlements (CRM, Order Inbox, …) resolved from the plan
	 * — the only place `plan` is read for gating. See lib/plans.ts. */
	features: PlanFeatures;
	/** True when the seller has full dashboard access (not soft-locked). */
	active: boolean;
	/** Soft-lock engaged — dashboard growth-writes must be blocked. */
	frozen: boolean;
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
			comped: true,
			caps,
			features: featuresForPlan("pro"),
			active: true,
			frozen: false,
		};
	}
	const comped = sub.comped === true;
	// Soft-lock only bites a real (non-comped) past_due subscription.
	const frozen = sub.status === "past_due" && !comped;
	return {
		plan: sub.plan,
		status: sub.status,
		comped,
		trialEndsAt: sub.trialEndsAt,
		currentPeriodEnd: sub.currentPeriodEnd,
		caps: {
			orderCap: sub.orderCap,
			userCap: sub.userCap,
			broadcastQuota: sub.broadcastQuota,
		},
		features: featuresForPlan(sub.plan),
		active: !frozen,
		frozen,
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
// Queries
// ---------------------------------------------------------------------------

/** The caller's subscription summary — drives the billing page + nav pill.
 * Returns null when unauthenticated or no retailer/subscription yet. */
export const current = query({
	args: {},
	handler: async (
		ctx,
	): Promise<
		| (AccessState & {
				billingCycle?: "monthly" | "annual";
				createdAt?: number;
		  })
		| null
	> => {
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
		return {
			...resolveAccess(sub, { adminFullAccess }),
			billingCycle: sub?.billingCycle,
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
 *  - `trialing → past_due` when the trial has lapsed (`trialEndsAt < now`).
 *  - `active → past_due` when the retailer has a still-pending invoice past its
 *    `dueDate` (founding ghost / unpaid renewal). Comped subs are never flipped.
 * Also logs `active` subs nearing `currentPeriodEnd` so Arif chases the manual
 * renewal, and emails a one-time pre-due-date reminder for pending invoices.
 * Runs once daily — a retailer keeps access up to ~24h past the boundary
 * (acceptable grace). See docs/manual-subscription.md.
 */
const REMINDER_DAYS_BEFORE = 3;

export const internalDailyBillingStatus = internalMutation({
	args: {},
	handler: async (
		ctx,
	): Promise<{
		trialExpired: number;
		overdue: number;
		lapsed: number;
		renewalsDue: number;
		remindersSent: number;
		trialReminders: number;
	}> => {
		const now = Date.now();
		let trialExpired = 0;
		let overdue = 0;
		let lapsed = 0;
		let renewalsDue = 0;
		let remindersSent = 0;
		let trialReminders = 0;

		// Trial expiry → lock + "trial ended" email (once, on the transition).
		// Otherwise, "trial ends in 3 days" email (once, deduped by trialReminderSentAt).
		const trialing = await ctx.db
			.query("subscriptions")
			.withIndex("by_status", (q) => q.eq("status", "trialing"))
			.collect();
		for (const sub of trialing) {
			if (sub.trialEndsAt === undefined) continue;
			if (sub.trialEndsAt < now) {
				await ctx.db.patch(sub._id, { status: "past_due", updatedAt: now });
				trialExpired++;
				await ctx.scheduler.runAfter(0, internal.billingEmail.notifyTrialEmail, {
					retailerId: sub.retailerId,
					key: "trialEnded",
				});
				continue;
			}
			const daysLeft = Math.ceil((sub.trialEndsAt - now) / DAY_MS);
			if (daysLeft <= 3 && sub.trialReminderSentAt === undefined) {
				await ctx.db.patch(sub._id, { trialReminderSentAt: now });
				await ctx.scheduler.runAfter(0, internal.billingEmail.notifyTrialEmail, {
					retailerId: sub.retailerId,
					key: "trialEndingSoon",
					daysLeft,
				});
				trialReminders++;
			}
		}

		// Active overdue (founding ghost / unpaid renewal) + renewal-chase flag.
		const RENEWAL_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days out
		const active = await ctx.db
			.query("subscriptions")
			.withIndex("by_status", (q) => q.eq("status", "active"))
			.collect();
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
			// Period lapsed with NO pending invoice → lock anyway. We never give a paid
			// vendor free service past their cycle while waiting on Arif to issue a
			// renewal. (A pending invoice with a future due date keeps them in grace.)
			const hasPending = invoices.some((inv) => inv.status === "pending");
			if (
				!hasPending &&
				sub.currentPeriodEnd !== undefined &&
				sub.currentPeriodEnd < now
			) {
				await ctx.db.patch(sub._id, { status: "past_due", updatedAt: now });
				lapsed++;
				await ctx.scheduler.runAfter(
					0,
					internal.billingEmail.notifySubscriptionLapsed,
					{ retailerId: sub.retailerId },
				);
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
			overdue,
			lapsed,
			renewalsDue,
			remindersSent,
			trialReminders,
		};
	},
});
