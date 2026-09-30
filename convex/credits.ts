// Kedaipal Credits — the order-credit ledger (ClickUp 86eye2ccu,
// docs/credits.md). The pure rules live in lib/credits.ts; this module owns
// every read and write of the three credit tables.
//
// Shape of the system:
//  - `creditLedger` is append-only and the source of truth.
//  - `creditAccounts` caches both balances so the dashboard and the seller
//    lock read one row, never a ledger scan. EVERY balance change goes through
//    `applyEntry`, which writes the ledger row and the cache in one mutation —
//    the two can't drift apart unless someone bypasses it
//    (`internalRecomputeBalance` checks that nobody has).
//  - `creditLots` hold purchased credits in the batches they arrived in, so
//    they're spent oldest-first and expire 12 months after they landed.
//
// The order pipeline calls in through `subscriptionUsage.recordOrderCreated`
// / `recordOrderCancelled` (every channel funnels through those two seams),
// and billing calls in at settle, hold resume and comp. Nothing here can
// refuse an order: the debit is a meter, never a gate.

import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalMutation,
	type MutationCtx,
	mutation,
	type QueryCtx,
	query,
} from "./_generated/server";
import {
	logAdminAction,
	requireAdmin,
	requireRetailerAccess,
	resolveMyRetailerFor,
	storeOwnerIsAdmin,
} from "./lib/auth";
import {
	type CancelCause,
	type CreditBucket,
	type CreditLockExemption,
	type CreditRegime,
	type CreditRegimeInputs,
	cancelRefundDecision,
	creditLockExemption,
	creditRegime,
	debitBucket,
	lowCreditLine,
	monthlyCreditGrant,
	refreshedPlanBalance,
	sellerRefundsLeft,
} from "./lib/credits";
import {
	type BillingCycle,
	foundingPriceEligible,
	PURCHASED_CREDIT_LIFETIME_MONTHS,
} from "./lib/plans";
import {
	addMonthsMyt,
	monthStartMyt,
	nextMonthStartMyt,
	usagePeriodKey,
} from "./lib/usagePeriod";

type AnyCtx = QueryCtx | MutationCtx;
type Account = Doc<"creditAccounts">;
type Lot = Doc<"creditLots">;
type LedgerRow = Doc<"creditLedger">;

/** Batch size for the cron sweeps — each run re-schedules itself until the
 * range is empty, so a big month boundary never hits a transaction limit. */
const SWEEP_BATCH = 100;

/** Largest single admin adjustment or custom grant — a typo guard. */
export const ADMIN_CREDIT_LIMIT = 100_000;

const NOTE_MIN = 3;
const NOTE_MAX = 500;

// ---------------------------------------------------------------------------
// Loading + the grant regime
// ---------------------------------------------------------------------------

export async function loadCreditAccount(
	ctx: AnyCtx,
	retailerId: Id<"retailers">,
): Promise<Account | null> {
	return ctx.db
		.query("creditAccounts")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
		.first();
}

async function regimeInputs(
	ctx: AnyCtx,
	retailer: Doc<"retailers">,
	account: Pick<Account, "grantOverride" | "annualGrant"> | null,
	now: number,
): Promise<CreditRegimeInputs> {
	const sub = await ctx.db
		.query("subscriptions")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailer._id))
		.first();
	return {
		status: sub?.status ?? null,
		// The missing-row fail-safe resolves to Pro in `resolveAccess`.
		plan: sub?.plan ?? "pro",
		comped: sub?.comped === true,
		ownerIsAdmin: storeOwnerIsAdmin(retailer),
		foundingEligible: foundingPriceEligible({
			isFoundingMember: retailer.isFoundingMember === true,
			foundingIntent: sub?.foundingIntent === true,
			paidThrough: sub?.currentPeriodEnd,
			benefitsRevokedAt: retailer.foundingBenefitsRevokedAt,
			benefitsRestoredAt: retailer.foundingBenefitsRestoredAt,
			now,
		}),
		override: account?.grantOverride,
		annualGrant: account?.annualGrant,
		now,
	};
}

async function regimeFor(
	ctx: AnyCtx,
	retailerId: Id<"retailers">,
	account: Pick<Account, "grantOverride" | "annualGrant"> | null,
	now: number,
): Promise<CreditRegime | null> {
	const retailer = await ctx.db.get(retailerId);
	if (!retailer) return null;
	return creditRegime(await regimeInputs(ctx, retailer, account, now));
}

// ---------------------------------------------------------------------------
// The ONE write path
// ---------------------------------------------------------------------------

type EntryInput = {
	type: LedgerRow["type"];
	bucket: CreditBucket;
	amount: number;
	reason: LedgerRow["reason"];
	periodKey: string;
	createdBy: string;
	refId?: string;
	refLabel?: string;
	orderId?: Id<"orders">;
	lotId?: Id<"creditLots">;
	cause?: CancelCause;
	note?: string;
};

/**
 * Write one ledger row AND the cached balances it moves, in the same
 * mutation. Every balance change in the system goes through here — the
 * invariant `cache == Σ ledger` holds by construction. Also maintains
 * `exhaustedAt`: set when the total first reaches 0 or below, cleared the
 * moment it rises above 0 (by any route — refresh, top-up, upgrade, refund).
 */
async function applyEntry(
	ctx: MutationCtx,
	account: Account,
	entry: EntryInput,
	now: number,
	extraPatch: Partial<Account> = {},
	/** What put credits in, for the unlock notice + analytics (a grant can
	 * be a monthly refresh, a paid invoice or an upgrade — only the caller
	 * knows which). Defaults from the entry's type. */
	route?: CreditInRoute,
): Promise<Account> {
	const beforeTotal = account.planBalance + account.purchasedBalance;
	const planBalance =
		account.planBalance + (entry.bucket === "plan" ? entry.amount : 0);
	const purchasedBalance =
		account.purchasedBalance + (entry.bucket === "purchased" ? entry.amount : 0);
	await ctx.db.insert("creditLedger", {
		retailerId: account.retailerId,
		...entry,
		planAfter: planBalance,
		purchasedAfter: purchasedBalance,
		createdAt: now,
	});
	const total = planBalance + purchasedBalance;
	const exhaustion: Partial<Account> =
		total <= 0
			? account.exhaustedAt === undefined
				? { exhaustedAt: now }
				: {}
			: account.exhaustedAt !== undefined
				? { exhaustedAt: undefined }
				: {};
	const patch: Partial<Account> = {
		planBalance,
		purchasedBalance,
		updatedAt: now,
		...exhaustion,
		...extraPatch,
	};
	await ctx.db.patch(account._id, patch);
	// The low line of the month the balance now sits in (a refresh's grant row
	// carries the new month's grant in `extraPatch`).
	const lowLine = lowCreditLine(patch.periodGrant ?? account.periodGrant);
	if (crossesNoticeLine(beforeTotal, total, lowLine)) {
		await scheduleNoticeCheck(ctx, account.retailerId, route ?? routeFor(entry));
	}
	return { ...account, ...patch };
}

/** What put credits back in — carried to the unlock notice and the
 * `credits_seller_unlocked` event. */
export type CreditInRoute =
	| "topup"
	| "refresh"
	| "settle"
	| "upgrade"
	| "resume"
	| "adjust"
	| "refund";

function routeFor(entry: EntryInput): CreditInRoute {
	if (entry.type === "purchase") return "topup";
	if (entry.type === "refund") return "refund";
	if (entry.type === "adjust") return "adjust";
	return "settle";
}

/**
 * Balance notices (Credits T3) are judged a few minutes AFTER a line is
 * crossed, from the state at that moment: a burst that takes a store from 12
 * to −3 in one busy hour produces ONE "you're out" notice, not a "10 left"
 * and then a "0". The delay also keeps the chain inert inside any test file's
 * lifetime (the FIRST_INVOICE_DELAY_MS lesson in convex/subscriptions.ts).
 */
const NOTICE_DELAY_MS = 5 * 60 * 1000;

/** Crossing into the low band (the last 20% of the month's credits), into
 * zero-or-below, or back above zero. */
function crossesNoticeLine(
	before: number,
	after: number,
	lowLine: number,
): boolean {
	return (
		(before > lowLine && after <= lowLine) ||
		(before > 0 && after <= 0) ||
		(before <= 0 && after > 0)
	);
}

async function scheduleNoticeCheck(
	ctx: MutationCtx,
	retailerId: Id<"retailers">,
	route: CreditInRoute,
): Promise<void> {
	await ctx.scheduler.runAfter(
		NOTICE_DELAY_MS,
		internal.creditNotices.evaluate,
		{ retailerId, route },
	);
}

// ---------------------------------------------------------------------------
// Usage periods
// ---------------------------------------------------------------------------

/**
 * Bring an account into the current usage period. A MONTHLY store forfeits a
 * positive plan leftover (no rollover — written as an `expire` row under the
 * old period, so the seller can see it went) and receives the new grant; a
 * debt carries. A store with NO grant right now (past_due / on_hold /
 * cancelled) forfeits the leftover and waits: its grant lands when it pays or
 * resumes. A TRIAL store keeps its one-off trial balance untouched. Lazy AND
 * swept: every debit rolls its own account, and the 00:05 MYT cron rolls the
 * rest so a quiet store's meter is right too.
 */
async function rollPeriod(
	ctx: MutationCtx,
	account: Account,
	now: number,
): Promise<Account> {
	const periodKey = usagePeriodKey(now);
	// `>=` rather than `===`: a clock read that lands a hair earlier than the
	// row's own stamp must never roll a period backwards.
	if (account.periodKey >= periodKey) return account;
	const regime = await regimeFor(ctx, account.retailerId, account, now);
	if (!regime) return account;
	if (regime.kind === "trial") {
		await ctx.db.patch(account._id, { periodKey, updatedAt: now });
		return { ...account, periodKey, updatedAt: now };
	}
	let next = account;
	if (next.planBalance > 0) {
		next = await applyEntry(
			ctx,
			next,
			{
				type: "expire",
				bucket: "plan",
				amount: -next.planBalance,
				reason: "plan",
				periodKey: next.periodKey,
				createdBy: "system",
			},
			now,
		);
	}
	const grant = regime.kind === "monthly" ? regime.grant : 0;
	if (grant > 0) {
		const rolled = await applyEntry(
			ctx,
			next,
			{
				type: "grant",
				bucket: "plan",
				amount: grant,
				reason: "plan",
				periodKey,
				createdBy: "system",
			},
			now,
			{ periodKey, periodGrant: grant },
			"refresh",
		);
		// A carried debt bigger than the new grant leaves the store locked
		// through its refresh — the seller is told how far short they are.
		if (rolled.planBalance + rolled.purchasedBalance <= 0) {
			await scheduleNoticeCheck(ctx, rolled.retailerId, "refresh");
		}
		return rolled;
	}
	await ctx.db.patch(next._id, { periodKey, periodGrant: 0, updatedAt: now });
	return { ...next, periodKey, periodGrant: 0, updatedAt: now };
}

/**
 * The store's account, created on first touch and rolled into the current
 * period. A new account opens with the grant its status earns right now: the
 * one-off trial allowance, the monthly grant, or nothing (past_due / on_hold).
 * Returns null only when the retailer itself is gone. Never throws on the
 * order path's behalf.
 */
export async function ensureCreditAccount(
	ctx: MutationCtx,
	retailerId: Id<"retailers">,
	now: number,
): Promise<{ account: Account; created: boolean } | null> {
	const existing = await loadCreditAccount(ctx, retailerId);
	if (existing) {
		return { account: await rollPeriod(ctx, existing, now), created: false };
	}
	const regime = await regimeFor(ctx, retailerId, null, now);
	if (!regime) return null;
	const grant = regime.kind === "none" ? 0 : regime.grant;
	const periodKey = usagePeriodKey(now);
	const id = await ctx.db.insert("creditAccounts", {
		retailerId,
		planBalance: 0,
		purchasedBalance: 0,
		periodKey,
		periodGrant: 0,
		createdAt: now,
		updatedAt: now,
	});
	const blank = (await ctx.db.get(id)) as Account;
	if (grant <= 0) {
		await ctx.db.patch(id, { exhaustedAt: now });
		return { account: { ...blank, exhaustedAt: now }, created: true };
	}
	const account = await applyEntry(
		ctx,
		blank,
		{
			type: "grant",
			bucket: "plan",
			amount: grant,
			reason: regime.kind === "trial" ? "trial" : "plan",
			periodKey,
			createdBy: "system",
		},
		now,
		{ periodGrant: grant },
	);
	return { account, created: true };
}

// ---------------------------------------------------------------------------
// Purchased lots
// ---------------------------------------------------------------------------

/** The store's spendable lot that expires soonest — spent first. */
async function oldestOpenLot(
	ctx: AnyCtx,
	retailerId: Id<"retailers">,
): Promise<Lot | null> {
	return ctx.db
		.query("creditLots")
		.withIndex("by_retailer_open_expiry", (q) =>
			q.eq("retailerId", retailerId).eq("open", true),
		)
		.first();
}

async function adjustLot(
	ctx: MutationCtx,
	lot: Lot,
	delta: number,
): Promise<void> {
	const remaining = lot.remaining + delta;
	await ctx.db.patch(lot._id, { remaining, open: remaining > 0 });
}

/**
 * Land purchased-bucket credits as a new lot that expires
 * PURCHASED_CREDIT_LIFETIME_MONTHS after it landed. The ONE entry point for
 * every credit that carries over: a paid pack (T2's webhook), a referral
 * reward, an admin grant. Returns the lot so the caller can link its own
 * record (a purchase row) to it.
 */
export async function addPurchasedCredits(
	ctx: MutationCtx,
	args: {
		retailerId: Id<"retailers">;
		credits: number;
		source: Lot["source"];
		type: "purchase" | "grant" | "adjust";
		reason: LedgerRow["reason"];
		refId?: string;
		refLabel?: string;
		note?: string;
		createdBy: string;
		now: number;
	},
): Promise<{ lotId: Id<"creditLots">; account: Account } | null> {
	if (!Number.isInteger(args.credits) || args.credits <= 0) return null;
	const ensured = await ensureCreditAccount(ctx, args.retailerId, args.now);
	if (!ensured) return null;
	const lotId = await ctx.db.insert("creditLots", {
		retailerId: args.retailerId,
		source: args.source,
		refId: args.refId,
		credits: args.credits,
		remaining: args.credits,
		open: true,
		expiresAt: addMonthsMyt(args.now, PURCHASED_CREDIT_LIFETIME_MONTHS),
		createdAt: args.now,
	});
	const account = await applyEntry(
		ctx,
		ensured.account,
		{
			type: args.type,
			bucket: "purchased",
			amount: args.credits,
			reason: args.reason,
			periodKey: ensured.account.periodKey,
			createdBy: args.createdBy,
			refId: args.refId,
			refLabel: args.refLabel,
			lotId,
			note: args.note,
		},
		args.now,
	);
	return { lotId, account };
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/** Every ledger row keyed to one order (a handful at most). */
async function ledgerForOrder(
	ctx: AnyCtx,
	retailerId: Id<"retailers">,
	orderId: Id<"orders">,
): Promise<LedgerRow[]> {
	return ctx.db
		.query("creditLedger")
		.withIndex("by_retailer_ref_type", (q) =>
			q.eq("retailerId", retailerId).eq("refId", orderId),
		)
		.collect();
}

function countOf(rows: LedgerRow[], type: LedgerRow["type"]): number {
	return rows.filter((r) => r.type === type).length;
}

/**
 * Use one credit for a freshly created order. Idempotent on the order's own
 * ledger history (debits − refunds), so a retried mutation can never charge
 * twice. Plan credits first, then the oldest purchased lot, then the plan
 * bucket goes below zero — an order is NEVER refused here.
 */
export async function debitCreditForOrder(
	ctx: MutationCtx,
	args: {
		retailerId: Id<"retailers">;
		orderId: Id<"orders">;
		orderShortId?: string;
		now: number;
	},
): Promise<void> {
	const ensured = await ensureCreditAccount(ctx, args.retailerId, args.now);
	if (!ensured) return;
	const history = await ledgerForOrder(ctx, args.retailerId, args.orderId);
	if (countOf(history, "debit") > countOf(history, "refund")) return;
	const account = ensured.account;
	let bucket = debitBucket(account.planBalance, account.purchasedBalance);
	let lotId: Id<"creditLots"> | undefined;
	if (bucket === "purchased") {
		const lot = await oldestOpenLot(ctx, args.retailerId);
		if (lot) {
			await adjustLot(ctx, lot, -1);
			lotId = lot._id;
		} else {
			// `purchasedBalance` says there's credit but no lot holds it — the
			// invariant broke somewhere. Never fail the order over it: take the
			// credit from the plan bucket and leave a trail for the audit.
			console.error("[credits] purchased balance with no open lot", {
				retailerId: args.retailerId,
				purchasedBalance: account.purchasedBalance,
			});
			bucket = "plan";
		}
	}
	await applyEntry(
		ctx,
		account,
		{
			type: "debit",
			bucket,
			amount: -1,
			reason: "order",
			periodKey: account.periodKey,
			createdBy: "system",
			refId: args.orderId,
			refLabel: args.orderShortId,
			orderId: args.orderId,
			lotId,
		},
		args.now,
	);
}

/**
 * Give an order's credit back when the order ended before it ever got going
 * (`cancelRefundDecision`). Only an order this ledger actually debited can be
 * refunded — an order from before credits launched, or one already refunded,
 * is a no-op, so a cancel can never mint a credit. The credit returns to the
 * bucket (and lot) it came out of. `order.status` must be the status the
 * order held BEFORE the cancel.
 */
export async function refundCreditForOrder(
	ctx: MutationCtx,
	args: { order: Doc<"orders">; cause: CancelCause; now: number },
): Promise<void> {
	const { order, cause, now } = args;
	const existing = await loadCreditAccount(ctx, order.retailerId);
	if (!existing) return;
	const history = await ledgerForOrder(ctx, order.retailerId, order._id);
	const debits = history
		.filter((r) => r.type === "debit")
		.sort((a, b) => a.createdAt - b.createdAt);
	if (debits.length <= countOf(history, "refund")) return;
	const account = await rollPeriod(ctx, existing, now);
	const used =
		account.sellerRefunds?.periodKey === account.periodKey
			? account.sellerRefunds.count
			: 0;
	const decision = cancelRefundDecision({
		cause,
		statusAtCancel: order.status,
		sellerRefundsUsed: used,
	});
	if (!decision.refund) return;
	const last = debits[debits.length - 1];
	let bucket = last.bucket;
	let lotId = last.lotId;
	if (bucket === "purchased") {
		const lot = lotId ? await ctx.db.get(lotId) : null;
		if (lot) {
			// Back into the lot it came from — even an expired one, which the
			// next expiry pass then retires ("no new expiry", 86eye2ccu).
			await adjustLot(ctx, lot, 1);
		} else {
			bucket = "plan";
			lotId = undefined;
		}
	}
	await applyEntry(
		ctx,
		account,
		{
			type: "refund",
			bucket,
			amount: 1,
			reason: "order",
			periodKey: account.periodKey,
			createdBy: "system",
			refId: order._id,
			refLabel: order.shortId,
			orderId: order._id,
			lotId,
			cause,
		},
		now,
		decision.countsAgainstAllowance
			? { sellerRefunds: { periodKey: account.periodKey, count: used + 1 } }
			: {},
	);
}

// ---------------------------------------------------------------------------
// Billing lifecycle
// ---------------------------------------------------------------------------

/**
 * Land this period's grant if it hasn't landed yet — a store that was
 * past_due or on hold when the month turned. Called on hold resume and when
 * a comp is switched on; `applyCreditsOnSettle` does the same for payments.
 */
export async function landCreditGrant(
	ctx: MutationCtx,
	retailerId: Id<"retailers">,
	now: number,
): Promise<void> {
	const ensured = await ensureCreditAccount(ctx, retailerId, now);
	if (!ensured || ensured.created) return;
	const { account } = ensured;
	if (account.periodGrant > 0) return;
	const regime = await regimeFor(ctx, retailerId, account, now);
	if (regime?.kind !== "monthly" || regime.grant <= 0) return;
	await applyEntry(
		ctx,
		account,
		{
			type: "grant",
			bucket: "plan",
			amount: regime.grant,
			reason: "plan",
			periodKey: account.periodKey,
			createdBy: "system",
		},
		now,
		{ periodGrant: regime.grant },
		"resume",
	);
}

/**
 * Called by `settleInvoicePaid` BEFORE it rewrites the subscription: brings
 * the account into the current period under the status the store held while
 * that period turned (a trial keeps its balance; a past_due store forfeits
 * its leftover), so the payment's own effect below starts from the truth.
 */
export async function prepareCreditsForSettle(
	ctx: MutationCtx,
	retailerId: Id<"retailers">,
	now: number,
): Promise<void> {
	await ensureCreditAccount(ctx, retailerId, now);
}

/**
 * What a paid invoice does to the plan bucket — called by `settleInvoicePaid`
 * AFTER the subscription holds its new plan and status:
 *  - a HOLD invoice: nothing (no grant while held);
 *  - the store was TRIALING: the trial allowance ends and the plan's credits
 *    start like a refresh — the new grant plus any trial debt, never "grant
 *    minus what the trial used", which left a paying seller locked;
 *  - no grant landed this period yet (past_due, a comp that ended): it lands;
 *  - a HIGHER grant than this period's (an upgrade): the difference now;
 *  - the same or a lower grant (renewal, downgrade): nothing until the next
 *    period, so a downgrade never takes back credits mid-month.
 * Also stamps (annual) or clears (monthly) the grant an annual payment locks
 * for its prepaid term, computed from the plan just paid for — so an upgrade
 * mid-term re-stamps.
 */
export async function applyCreditsOnSettle(
	ctx: MutationCtx,
	args: {
		retailerId: Id<"retailers">;
		/** The subscription's status BEFORE this payment. */
		fromStatus: Doc<"subscriptions">["status"];
		isHold: boolean;
		billingCycle: BillingCycle;
		/** The end of the period this payment bought. */
		periodEnd: number;
		now: number;
	},
): Promise<void> {
	if (args.isHold) return;
	const retailer = await ctx.db.get(args.retailerId);
	if (!retailer) return;
	const ensured = await ensureCreditAccount(ctx, args.retailerId, args.now);
	if (!ensured) return;
	let account = ensured.account;

	const inputs = await regimeInputs(ctx, retailer, account, args.now);
	const unlockedGrant = monthlyCreditGrant({
		...inputs,
		annualGrant: undefined,
	});
	const annualGrant =
		args.billingCycle === "annual"
			? { grant: unlockedGrant, until: args.periodEnd }
			: undefined;
	if (
		account.annualGrant?.grant !== annualGrant?.grant ||
		account.annualGrant?.until !== annualGrant?.until
	) {
		await ctx.db.patch(account._id, { annualGrant, updatedAt: args.now });
		account = { ...account, annualGrant, updatedAt: args.now };
	}
	if (ensured.created) return;

	const regime = creditRegime({ ...inputs, annualGrant });
	if (regime.kind !== "monthly") return;
	const grant = regime.grant;
	const entry = (amount: number): EntryInput => ({
		type: "grant",
		bucket: "plan",
		amount,
		reason: "plan",
		periodKey: account.periodKey,
		createdBy: "system",
	});

	if (args.fromStatus === "trialing") {
		// The conversion IS a refresh (`refreshedPlanBalance`): what's left of
		// the trial allowance goes, a trial debt stays, the plan's grant lands.
		if (account.planBalance > 0) {
			account = await applyEntry(
				ctx,
				account,
				{
					type: "expire",
					bucket: "plan",
					amount: -account.planBalance,
					reason: "trial",
					periodKey: account.periodKey,
					createdBy: "system",
				},
				args.now,
			);
		}
		await applyEntry(
			ctx,
			account,
			entry(grant),
			args.now,
			{ periodGrant: grant },
			"settle",
		);
		return;
	}
	if (account.periodGrant <= 0) {
		await applyEntry(
			ctx,
			account,
			entry(grant),
			args.now,
			{ periodGrant: grant },
			"settle",
		);
		return;
	}
	if (grant > account.periodGrant) {
		await applyEntry(
			ctx,
			account,
			entry(grant - account.periodGrant),
			args.now,
			{ periodGrant: grant },
			"upgrade",
		);
	}
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The balance as the seller should read it. */
export type CreditBalanceView = {
	plan: number;
	purchased: number;
	/** What the meter shows: plan + purchased. Negative = orders owed. */
	total: number;
	periodKey: string;
	/** Plan credits granted this period (the meter's denominator). */
	periodGrant: number;
	/** How this store is granted: monthly, a one-off trial, or nothing
	 * until it pays / resumes. */
	regime: CreditRegime["kind"];
	/** What the next refresh lands — null while trialing or without a grant. */
	nextGrant: number | null;
	/** When plan credits next refresh; null during the one-off trial. */
	refreshesAt: number | null;
	/** The purchased lot that expires soonest, if any. */
	nextExpiry: { credits: number; at: number } | null;
	/** When the balance reached zero, if it's still there. */
	exhaustedAt: number | null;
	/** Seller cancellations that can still give their credit back. */
	sellerRefundsLeft: number;
	/** An admin set a custom monthly grant (no upgrade nudges). */
	customGrant: boolean;
	/** Live orders created this calendar month (the usage counter — a cancel
	 * takes one off, whatever happened to its credit). What a plan change
	 * compares the new allowance against: "you've had 140 this month, Starter
	 * includes 100". */
	ordersThisPeriod: number;
	/** Why this store is never locked (an admin's own store, or a sponsored
	 * one), or null when the lock applies. The meter says it instead of the
	 * status line a billed store would read — an admin store sitting in
	 * `trialing` or `past_due` is never asked to pay (T3 test round). */
	lockExempt: CreditLockExemption | null;
};

/**
 * The balance as it stands NOW — including a month boundary the 00:05 MYT
 * sweep hasn't rolled yet (a query can't write) and a store with no account
 * yet (opened at signup, by its first order, or by the backfill). The seller
 * lock reads this, so a store whose refresh brings it back above zero is
 * unlocked at its own midnight, not five minutes later.
 */
export async function projectedCredits(
	ctx: AnyCtx,
	retailerId: Id<"retailers">,
	account: Account | null,
	now: number,
): Promise<{
	plan: number;
	purchased: number;
	total: number;
	periodKey: string;
	periodGrant: number;
	regime: CreditRegime;
} | null> {
	const regime = await regimeFor(ctx, retailerId, account, now);
	if (!regime) return null;
	const periodKey = usagePeriodKey(now);
	const grantNow = regime.kind === "none" ? 0 : regime.grant;
	let plan: number;
	let periodGrant: number;
	if (!account) {
		plan = grantNow;
		periodGrant = grantNow;
	} else if (account.periodKey < periodKey && regime.kind !== "trial") {
		plan = refreshedPlanBalance(account.planBalance, grantNow);
		periodGrant = grantNow;
	} else {
		plan = account.planBalance;
		periodGrant = account.periodGrant;
	}
	const purchased = account?.purchasedBalance ?? 0;
	return {
		plan,
		purchased,
		total: plan + purchased,
		periodKey,
		periodGrant,
		regime,
	};
}

async function balanceView(
	ctx: AnyCtx,
	retailerId: Id<"retailers">,
	account: Account | null,
	now: number,
): Promise<CreditBalanceView | null> {
	const projected = await projectedCredits(ctx, retailerId, account, now);
	if (!projected) return null;
	const { plan, purchased, total, periodKey, periodGrant, regime } = projected;
	const lot = account ? await oldestOpenLot(ctx, retailerId) : null;
	const refundsUsed =
		account?.sellerRefunds?.periodKey === periodKey
			? account.sellerRefunds.count
			: 0;
	const usage = await ctx.db
		.query("subscriptionUsage")
		.withIndex("by_retailer_month", (q) =>
			q.eq("retailerId", retailerId).eq("monthStart", monthStartMyt(now)),
		)
		.unique();
	const retailer = await ctx.db.get(retailerId);
	const sub = await ctx.db
		.query("subscriptions")
		.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
		.first();
	return {
		plan,
		purchased,
		total,
		periodKey,
		periodGrant,
		regime: regime.kind,
		nextGrant: regime.kind === "monthly" ? regime.grant : null,
		refreshesAt: regime.kind === "trial" ? null : nextMonthStartMyt(now),
		nextExpiry: lot ? { credits: lot.remaining, at: lot.expiresAt } : null,
		exhaustedAt:
			total <= 0 ? (account?.exhaustedAt ?? now) : null,
		sellerRefundsLeft: sellerRefundsLeft(refundsUsed),
		customGrant: account?.grantOverride !== undefined,
		ordersThisPeriod: usage?.orders ?? 0,
		lockExempt: creditLockExemption({
			status: sub?.status ?? null,
			comped: sub?.comped === true,
			ownerIsAdmin: retailer ? storeOwnerIsAdmin(retailer) : false,
		}),
	};
}

/** The store to read for a credits query: `retailerId` is the admin act-as
 * path (mirrors `myInvoices`); omitted, the caller's own store. Members need
 * the `credits` grant — without it, null and the surface renders locked. */
async function creditsStore(
	ctx: AnyCtx,
	retailerId: Id<"retailers"> | undefined,
): Promise<Doc<"retailers"> | null> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) return null;
	const access = retailerId
		? await requireRetailerAccess(ctx, retailerId, {
				area: "credits",
				level: "read",
			})
		: await resolveMyRetailerFor(ctx, { area: "credits", level: "read" });
	return access?.retailer ?? null;
}

/** The store's credit balance — the one read behind every meter. */
export const getBalance = query({
	args: { retailerId: v.optional(v.id("retailers")) },
	handler: async (ctx, { retailerId }): Promise<CreditBalanceView | null> => {
		const retailer = await creditsStore(ctx, retailerId);
		if (!retailer) return null;
		const account = await loadCreditAccount(ctx, retailer._id);
		return balanceView(ctx, retailer._id, account, Date.now());
	},
});

/** One row of the seller's "Credit activity" list. Admin notes are left off —
 * they're written for the ledger, not for the seller. */
export type CreditActivityRow = Pick<
	LedgerRow,
	| "_id"
	| "type"
	| "bucket"
	| "amount"
	| "reason"
	| "refLabel"
	| "orderId"
	| "periodKey"
	| "cause"
	| "planAfter"
	| "purchasedAfter"
	| "createdAt"
>;

/** The store's credit movements, newest first — so a seller can always
 * answer "why do I have 37 left?". Paginated. */
export const listActivity = query({
	args: {
		retailerId: v.optional(v.id("retailers")),
		paginationOpts: paginationOptsValidator,
	},
	handler: async (ctx, { retailerId, paginationOpts }) => {
		const retailer = await creditsStore(ctx, retailerId);
		if (!retailer) return { page: [], isDone: true, continueCursor: "" };
		const result = await ctx.db
			.query("creditLedger")
			.withIndex("by_retailer_created", (q) =>
				q.eq("retailerId", retailer._id),
			)
			.order("desc")
			.paginate(paginationOpts);
		return {
			...result,
			page: result.page.map(
				(r): CreditActivityRow => ({
					_id: r._id,
					type: r.type,
					bucket: r.bucket,
					amount: r.amount,
					reason: r.reason,
					refLabel: r.refLabel,
					orderId: r.orderId,
					periodKey: r.periodKey,
					cause: r.cause,
					planAfter: r.planAfter,
					purchasedAfter: r.purchasedAfter,
					createdAt: r.createdAt,
				}),
			),
		};
	},
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/** Admin: one store's credit state — the balance view, the raw account and
 * its open lots (the admin console's ledger drawer, Credits T5). */
export const adminGetAccount = query({
	args: { retailerId: v.id("retailers") },
	handler: async (ctx, { retailerId }) => {
		await requireAdmin(ctx);
		const account = await loadCreditAccount(ctx, retailerId);
		const view = await balanceView(ctx, retailerId, account, Date.now());
		const lots = await ctx.db
			.query("creditLots")
			.withIndex("by_retailer_open_expiry", (q) =>
				q.eq("retailerId", retailerId).eq("open", true),
			)
			.take(50);
		return { view, account, lots };
	},
});

/** Admin: the full ledger for one store, notes included, newest first. */
export const adminListLedger = query({
	args: {
		retailerId: v.id("retailers"),
		paginationOpts: paginationOptsValidator,
	},
	handler: async (ctx, { retailerId, paginationOpts }) => {
		await requireAdmin(ctx);
		return ctx.db
			.query("creditLedger")
			.withIndex("by_retailer_created", (q) => q.eq("retailerId", retailerId))
			.order("desc")
			.paginate(paginationOpts);
	},
});

function cleanNote(note: string): string {
	const trimmed = note.trim();
	if (trimmed.length < NOTE_MIN)
		throw new ConvexError(
			"Add a note saying why — it's kept on the store's credit ledger.",
		);
	if (trimmed.length > NOTE_MAX)
		throw new ConvexError(`Keep the note under ${NOTE_MAX} characters.`);
	return trimmed;
}

/**
 * Admin: add or remove credits by hand, with a mandatory note — goodwill,
 * a correction, or refunding a top-up (never by reversing the purchase row).
 * PLAN adjustments live and die with this month's plan credits; PURCHASED
 * additions land as a lot that expires in 12 months like any other, and
 * purchased removals take from the oldest lots first. Audited.
 */
export const adminAdjust = mutation({
	args: {
		retailerId: v.id("retailers"),
		bucket: v.union(v.literal("plan"), v.literal("purchased")),
		amount: v.number(),
		note: v.string(),
		// An Enterprise overage block (T6): bought credits landed once the
		// block's manual invoice is paid, written under its own ledger reason
		// so the book can tell blocks from goodwill. Enterprise stores only,
		// bought credits only, additions only.
		enterpriseBlock: v.optional(v.boolean()),
	},
	handler: async (
		ctx,
		{ retailerId, bucket, amount, note, enterpriseBlock },
	): Promise<{ plan: number; purchased: number }> => {
		const adminSubject = await requireAdmin(ctx);
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) throw new ConvexError("Store not found");
		if (!Number.isInteger(amount) || amount === 0)
			throw new ConvexError(
				"Enter a whole number of credits — positive to add, negative to take away.",
			);
		if (enterpriseBlock === true) {
			const sub = await ctx.db
				.query("subscriptions")
				.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
				.first();
			if (sub?.plan !== "enterprise")
				throw new ConvexError(
					"Only a store on an Enterprise contract buys overage blocks.",
				);
			if (bucket !== "purchased" || amount <= 0)
				throw new ConvexError(
					"An Enterprise block adds bought credits — a positive number, to the bought bucket.",
				);
		}
		if (Math.abs(amount) > ADMIN_CREDIT_LIMIT)
			throw new ConvexError(
				`That's more than ${ADMIN_CREDIT_LIMIT.toLocaleString("en")} credits — check the number.`,
			);
		const cleaned = cleanNote(note);
		const now = Date.now();
		const ensured = await ensureCreditAccount(ctx, retailerId, now);
		if (!ensured) throw new ConvexError("Store not found");
		let account = ensured.account;

		if (bucket === "plan") {
			account = await applyEntry(
				ctx,
				account,
				{
					type: "adjust",
					bucket: "plan",
					amount,
					reason: "adjust",
					periodKey: account.periodKey,
					createdBy: adminSubject,
					note: cleaned,
				},
				now,
			);
		} else if (amount > 0) {
			const added = await addPurchasedCredits(ctx, {
				retailerId,
				credits: amount,
				source: "adjust",
				type: "adjust",
				reason: enterpriseBlock === true ? "enterprise_block" : "adjust",
				refId: `adjust:${now}`,
				note: cleaned,
				createdBy: adminSubject,
				now,
			});
			if (added) account = added.account;
		} else {
			const toTake = -amount;
			if (toTake > account.purchasedBalance)
				throw new ConvexError(
					`This store has ${account.purchasedBalance} purchased credits — take away at most that many, or adjust the plan bucket instead.`,
				);
			let left = toTake;
			while (left > 0) {
				const lot = await oldestOpenLot(ctx, retailerId);
				if (!lot) break;
				const take = Math.min(left, lot.remaining);
				await adjustLot(ctx, lot, -take);
				account = await applyEntry(
					ctx,
					account,
					{
						type: "adjust",
						bucket: "purchased",
						amount: -take,
						reason: "adjust",
						periodKey: account.periodKey,
						createdBy: adminSubject,
						note: cleaned,
						lotId: lot._id,
					},
					now,
				);
				left -= take;
			}
		}
		await logAdminAction(
			ctx,
			{ retailer, role: "admin", actingAsAdmin: true, userId: adminSubject },
			"credits.adminAdjust",
			retailerId,
		);
		return { plan: account.planBalance, purchased: account.purchasedBalance };
	},
});

/** A custom grant's bounds — shared by the admin lever and the Enterprise
 * contract (T6), so "included credits" can't take a value the lever refuses. */
export function grantOverrideProblem(grant: number): string | null {
	if (!Number.isInteger(grant) || grant < 0 || grant > ADMIN_CREDIT_LIMIT)
		return `A custom grant is a whole number of credits from 0 to ${ADMIN_CREDIT_LIMIT.toLocaleString("en")}.`;
	return null;
}

/**
 * Set or clear (null) a store's custom monthly grant — the ONE writer of
 * `creditAccounts.grantOverride`, for the admin lever below and the
 * Enterprise contract (T6), whose included credits ARE this override. A
 * HIGHER grant lands its difference now, like an upgrade; a lower one, or
 * clearing it, waits for the next period, like a downgrade. A trialing store
 * keeps its trial allowance until it converts. Callers validate and audit.
 */
export async function writeGrantOverride(
	ctx: MutationCtx,
	retailerId: Id<"retailers">,
	grant: number | null,
	by: string,
	now: number,
): Promise<{ plan: number; periodGrant: number }> {
	const ensured = await ensureCreditAccount(ctx, retailerId, now);
	if (!ensured) throw new ConvexError("Store not found");
	const grantOverride = grant ?? undefined;
	await ctx.db.patch(ensured.account._id, { grantOverride, updatedAt: now });
	let account: Account = { ...ensured.account, grantOverride, updatedAt: now };
	const regime = await regimeFor(ctx, retailerId, account, now);
	if (regime?.kind === "monthly" && regime.grant > account.periodGrant) {
		account = await applyEntry(
			ctx,
			account,
			{
				type: "grant",
				bucket: "plan",
				amount: regime.grant - account.periodGrant,
				reason: "plan",
				periodKey: account.periodKey,
				createdBy: by,
			},
			now,
			{ periodGrant: regime.grant },
		);
	}
	return { plan: account.planBalance, periodGrant: account.periodGrant };
}

/**
 * Admin: set (or clear, with null) a custom monthly grant for one store — a
 * partner deal, a pilot. It beats every tier grant, and the store gets no
 * upgrade nudges. A HIGHER grant lands its difference now, like an upgrade; a
 * lower one waits for the next period, like a downgrade. A trialing store
 * keeps its trial allowance until it converts. Audited.
 *
 * On an ENTERPRISE store the override IS the contract's included credits
 * (T6): setting it updates the contract too — changing one changes the
 * other — and clearing it is refused while the store is on the contract.
 */
export const adminSetGrantOverride = mutation({
	args: {
		retailerId: v.id("retailers"),
		grant: v.union(v.number(), v.null()),
	},
	handler: async (
		ctx,
		{ retailerId, grant },
	): Promise<{ plan: number; periodGrant: number }> => {
		const adminSubject = await requireAdmin(ctx);
		const retailer = await ctx.db.get(retailerId);
		if (!retailer) throw new ConvexError("Store not found");
		const problem = grant === null ? null : grantOverrideProblem(grant);
		if (problem) throw new ConvexError(problem);
		const sub = await ctx.db
			.query("subscriptions")
			.withIndex("by_retailer", (q) => q.eq("retailerId", retailerId))
			.first();
		if (sub?.plan === "enterprise" && sub.enterprise) {
			if (grant === null)
				throw new ConvexError(
					"This store is on an Enterprise contract — its included credits are the contract's. Change them there, or move the store to Pro.",
				);
			await ctx.db.patch(sub._id, {
				enterprise: { ...sub.enterprise, includedCredits: grant },
			});
		}
		const result = await writeGrantOverride(
			ctx,
			retailerId,
			grant,
			adminSubject,
			Date.now(),
		);
		await logAdminAction(
			ctx,
			{ retailer, role: "admin", actingAsAdmin: true, userId: adminSubject },
			"credits.adminSetGrantOverride",
			retailerId,
		);
		return result;
	},
});

/** Upper bound on the accounts one totals read walks — one row per store, so
 * this is the store count the admin tiles stay exact for (they say so past
 * it). Past a few thousand stores the totals want a denormalized counter. */
const ADMIN_TOTALS_SCAN_LIMIT = 5_000;

export type AdminCreditTotals = {
	/** Σ purchasedBalance: credits sellers bought and haven't used yet — the
	 * deferred-revenue figure (a sold credit is a service still owed). */
	purchasedUnused: number;
	/** How many stores hold any unused purchased credits. */
	storesWithPurchased: number;
	/** Σ min(0, planBalance), as a positive count: orders taken past zero that
	 * the next monthly grant or purchased pack will absorb. */
	ordersOwed: number;
	/** How many stores carry a plan-bucket debt. */
	storesOwing: number;
	/** Accounts read. `truncated` = the scan hit its limit, so the sums are a
	 * floor, not the whole book. */
	accounts: number;
	truncated: boolean;
};

/** Admin: the book-wide credit figures behind Admin → Billing's two credit
 * tiles (Credits T5). Reads the cached balances — one row per store — never
 * the ledger. */
export const adminCreditTotals = query({
	args: {},
	handler: async (ctx): Promise<AdminCreditTotals> => {
		await requireAdmin(ctx);
		const rows = await ctx.db
			.query("creditAccounts")
			.take(ADMIN_TOTALS_SCAN_LIMIT + 1);
		const truncated = rows.length > ADMIN_TOTALS_SCAN_LIMIT;
		const accounts = truncated ? rows.slice(0, ADMIN_TOTALS_SCAN_LIMIT) : rows;
		let purchasedUnused = 0;
		let storesWithPurchased = 0;
		let ordersOwed = 0;
		let storesOwing = 0;
		for (const account of accounts) {
			if (account.purchasedBalance > 0) {
				purchasedUnused += account.purchasedBalance;
				storesWithPurchased += 1;
			}
			if (account.planBalance < 0) {
				ordersOwed += -account.planBalance;
				storesOwing += 1;
			}
		}
		return {
			purchasedUnused,
			storesWithPurchased,
			ordersOwed,
			storesOwing,
			accounts: accounts.length,
			truncated,
		};
	},
});

// ---------------------------------------------------------------------------
// Sweeps + audit (internal)
// ---------------------------------------------------------------------------

/**
 * Daily at 00:05 MYT (crons.ts): roll every account a month boundary has
 * passed. Debits already roll their own account lazily; this makes a quiet
 * store's meter right on the 1st too. Batched + self-rescheduling.
 */
export const internalRollPeriods = internalMutation({
	args: {},
	handler: async (ctx): Promise<{ rolled: number }> => {
		const now = Date.now();
		const current = usagePeriodKey(now);
		const stale = await ctx.db
			.query("creditAccounts")
			.withIndex("by_period", (q) => q.lt("periodKey", current))
			.take(SWEEP_BATCH);
		for (const account of stale) await rollPeriod(ctx, account, now);
		if (stale.length === SWEEP_BATCH) {
			await ctx.scheduler.runAfter(0, internal.credits.internalRollPeriods, {});
		}
		return { rolled: stale.length };
	},
});

/**
 * Daily at 00:10 MYT (crons.ts): retire whatever is left of every purchased
 * lot past its 12 months. Written as an `expire` row per lot so the seller's
 * activity list shows exactly what went and when. Batched + self-rescheduling.
 */
export const internalExpireLots = internalMutation({
	args: {},
	handler: async (ctx): Promise<{ expired: number }> => {
		const now = Date.now();
		const due = await ctx.db
			.query("creditLots")
			.withIndex("by_open_expiry", (q) =>
				q.eq("open", true).lte("expiresAt", now),
			)
			.take(SWEEP_BATCH);
		for (const lot of due) {
			const account = await loadCreditAccount(ctx, lot.retailerId);
			if (account) {
				await applyEntry(
					ctx,
					account,
					{
						type: "expire",
						bucket: "purchased",
						amount: -lot.remaining,
						reason: "expiry",
						periodKey: usagePeriodKey(now),
						createdBy: "system",
						refId: lot.refId,
						lotId: lot._id,
					},
					now,
				);
			}
			await ctx.db.patch(lot._id, { remaining: 0, open: false });
		}
		if (due.length === SWEEP_BATCH) {
			await ctx.scheduler.runAfter(0, internal.credits.internalExpireLots, {});
		}
		return { expired: due.length };
	},
});

/**
 * Audit + repair: rebuild one store's cached balances from its ledger (the
 * source of truth) and report any drift, plus whether the lots still add up
 * to the purchased balance. `npx convex run credits:internalRecomputeBalance
 * '{"retailerId":"…"}'`. A drift means something wrote a balance without
 * going through `applyEntry` — find it, don't just repair it.
 */
export const internalRecomputeBalance = internalMutation({
	args: { retailerId: v.id("retailers"), repair: v.optional(v.boolean()) },
	handler: async (
		ctx,
		{ retailerId, repair },
	): Promise<{
		cached: { plan: number; purchased: number } | null;
		ledger: { plan: number; purchased: number };
		lotsRemaining: number;
		drift: boolean;
	}> => {
		let plan = 0;
		let purchased = 0;
		for await (const row of ctx.db
			.query("creditLedger")
			.withIndex("by_retailer_created", (q) => q.eq("retailerId", retailerId))) {
			if (row.bucket === "plan") plan += row.amount;
			else purchased += row.amount;
		}
		let lotsRemaining = 0;
		for await (const lot of ctx.db
			.query("creditLots")
			.withIndex("by_retailer_open_expiry", (q) =>
				q.eq("retailerId", retailerId).eq("open", true),
			)) {
			lotsRemaining += lot.remaining;
		}
		const account = await loadCreditAccount(ctx, retailerId);
		const drift =
			account !== null &&
			(account.planBalance !== plan ||
				account.purchasedBalance !== purchased ||
				lotsRemaining !== purchased);
		if (drift && repair && account) {
			await ctx.db.patch(account._id, {
				planBalance: plan,
				purchasedBalance: purchased,
				updatedAt: Date.now(),
			});
		}
		return {
			cached: account
				? { plan: account.planBalance, purchased: account.purchasedBalance }
				: null,
			ledger: { plan, purchased },
			lotsRemaining,
			drift,
		};
	},
});
