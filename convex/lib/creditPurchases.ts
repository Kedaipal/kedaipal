// Kedaipal Credits T2 — top-up packs (ClickUp z8r3fdf8ht, docs/credits.md).
// The PURE rules of a pack purchase: who may buy, what they're told when they
// can't, how long a checkout lives, and how a purchase is named. No Convex
// imports, so the server's refusal and the dashboard's disabled-with-reason
// line are one author and can't disagree.

import { type CreditBillingStatus, type TopUpBlock, topUpBlock } from "./credits";

/**
 * How long a top-up checkout stays payable. The HitPay request is minted with
 * the same expiry (`CREDIT_PURCHASE_HITPAY_EXPIRY`), and the purchase's own
 * expiry is scheduled this far out at creation — a per-purchase timer, not a
 * daily sweep, so "expired" means exactly this.
 */
export const CREDIT_PURCHASE_TTL_MS = 24 * 60 * 60 * 1000;

/** `CREDIT_PURCHASE_TTL_MS` in HitPay's `expires_after` grammar. Minutes,
 * because "N mins" is the form sandbox-verified on this account ("60 mins" on
 * buyer links, "5 mins" on the connect probe) — the API 422s on the singular
 * "1 hour", so an unverified unit is not worth the risk. Pinned equal to the
 * TTL by `creditPurchases.test.ts`. */
export const CREDIT_PURCHASE_HITPAY_EXPIRY = "1440 mins";

/** Why a store can't buy a pack right now: T1's subscription rule
 * (`topUpBlock` — a pack tops up a PAID plan, so trial, overdue, held and
 * ended plans are refused), plus the two kinds of store that have nothing to
 * top up at all:
 *  - a Kedaipal admin's own store — never billed, and permanently
 *    `trialing`, where "pick a plan first" would be advice it can't take;
 *  - a SPONSORED store — comped (UNMETERED since z8r3fdrph7, so there is no
 *    balance a pack could add to), or the missing-row fail-safe
 *    `resolveAccess` treats as comped, whose credits are a meter and never a
 *    lock, so a pack would be money for nothing (Zaki, 1 Oct 2026). The two
 *    share one refusal because what the reader must do is identical —
 *    nothing — and the fail-safe is a data fault that should never exist. */
export type TopUpRefusal = TopUpBlock | "admin_store" | "sponsored";

export function topUpRefusal(args: {
	status: CreditBillingStatus;
	comped: boolean;
	ownerIsAdmin: boolean;
}): TopUpRefusal | null {
	if (args.ownerIsAdmin) return "admin_store";
	if (args.comped || args.status === null) return "sponsored";
	return topUpBlock(args.status);
}

/**
 * The sentence behind every refusal — thrown by `createTopUp` and shown beside
 * the disabled pack picker. Each names the way out. A teammate can't take the
 * way out themselves (paying invoices, picking or resuming a plan are billing
 * writes, owner-only), so their version points at the owner.
 */
export function topUpRefusalMessage(
	refusal: TopUpRefusal,
	opts: { audience: "owner" | "member"; invoiceNumber?: string },
): string {
	if (refusal === "admin_store")
		return "Kedaipal admin stores aren't metered, so there's nothing to top up — they have no credit balance and never lock.";
	// The same sentence for the owner and a teammate: there is no way out to
	// take, because nothing is wrong.
	if (refusal === "sponsored")
		return "Sponsored stores aren't metered, so there's nothing to top up — no monthly limit, no balance to run down, and the store never locks.";
	if (opts.audience === "member") {
		switch (refusal) {
			case "trialing":
				return "Credit packs top up a paid plan, and this store hasn't picked one yet. Ask the store owner to choose a plan first.";
			case "past_due":
				return "This store has an overdue invoice. Ask the store owner to pay it first — this month's credits land the moment it's paid.";
			case "on_hold":
				return "This store's plan is on Off-Season Hold. Ask the store owner to resume it first — this month's credits land as soon as they do.";
			case "cancelled":
				return "This store's subscription has ended. Ask the store owner to choose a plan first — credit packs add to a plan, they don't replace one.";
		}
	}
	switch (refusal) {
		case "trialing":
			return "Credit packs top up a paid plan. Pick a plan first — every plan includes orders each month.";
		case "past_due":
			return opts.invoiceNumber
				? `Your invoice ${opts.invoiceNumber} is overdue. Pay it first — this month's credits land the moment it's paid.`
				: "You have an overdue invoice. Pay it first — this month's credits land the moment it's paid.";
		case "on_hold":
			return "Your plan is on Off-Season Hold. Resume it first — this month's credits land as soon as you do.";
		case "cancelled":
			return "Your subscription has ended. Choose a plan first — credit packs add to a plan, they don't replace one.";
	}
}

/** Refused when no HitPay billing credentials are configured — every top-up
 * surface is hidden then, so only a stale tab reaches it. */
export const TOP_UP_UNAVAILABLE_MESSAGE =
	"Buying credits online isn't available right now. Message us on WhatsApp and we'll help you top up.";

/** Billing is view-only under admin act-as (Zaki, 17 Sep 2026) — the same
 * posture `subscriptions.setSeasonalHold` takes. An admin adds credits with an
 * audited adjustment instead. */
export const TOP_UP_VIEW_ONLY_MESSAGE =
	"Billing is view-only while you're acting as a store — the owner buys their own credits. Admins add credits with an adjustment instead.";

/** "50-credit pack" — the ledger's activity label and the receipt's line. */
export function creditPackLabel(credits: number): string {
	return `${credits}-credit pack`;
}

/** Human purchase reference, `CRD-YYYYMM-XXXX` — the same shape and clock
 * (UTC month) as `INV-YYYYMM-XXXX`. A label for people and HitPay's
 * `reference_number`, never a key: payments route by request id. */
export function generatePurchaseNumber(now: number): string {
	const d = new Date(now);
	const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
	const rand = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, "0");
	return `CRD-${ym}-${rand}`;
}
