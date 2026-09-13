// Who is offered annual billing, what it would cost them, and when offering it
// would be unsafe. Pure, so the decision is unit-tested rather than spelled into
// JSX conditions.
//
// Billing is manual in v1 (docs/manual-subscription.md): an admin issues the
// invoice, the seller pays by transfer, the admin marks it paid. That makes
// annual the ONE cycle the current rails already serve well — a year is a single
// transfer instead of twelve — which is why the offer ships here, in the
// seller's own Settings → Billing, rather than as a public /pricing toggle with
// no checkout behind it.
//
// See docs/pricing.md § Annual billing.

import {
	type AnnualQuote,
	annualQuote,
	type BillingCurrency,
	BILLING_CURRENCIES,
	DEFAULT_BILLING_CURRENCY,
	type Plan,
} from "../../convex/lib/plans";
import { daysUntil } from "./subscription";

/**
 * Plans the annual switch is offered on.
 *
 * **Pro only.** Not Starter, by owner decision: Starter is moving to
 * start-when-you-sell billing, so asking that seller for a year upfront
 * contradicts the premise of the tier. Not Scale either — `issueInvoice` throws
 * "Scale is unavailable for v1." (convex/invoices.ts), so offering it would
 * reproduce in-app exactly the dead-end CTA we refuse to ship on the public
 * pricing page. Add `"scale"` in the same change that makes Scale purchasable
 * (ClickUp z8r3fday24).
 *
 * A Starter seller is still TOLD annual exists, in the Starter → Pro nudge —
 * a constraint is surfaced, never enforced silently.
 */
export const ANNUAL_OFFER_PLANS: readonly Plan[] = ["pro"];

/**
 * Paid invoices a seller must already have before annual is offered.
 *
 * There is no proration anywhere in the codebase, so a year taken upfront from
 * someone who churns in month two is a manual refund argument. Two settled
 * invoices means the seller has renewed at least once by choice — the profile
 * annual is actually for — and it caps that exposure without a policy anyone
 * has to enforce by hand.
 */
export const ANNUAL_MIN_PAID_INVOICES = 2;

/**
 * Days of runway a pending invoice needs before we offer to swap it.
 *
 * Swapping means the admin VOIDS the monthly invoice and issues an annual one —
 * `issueInvoice` refuses to create a second pending invoice, so there is no
 * other path. That leaves a window with no pending invoice, and the daily cron
 * flips an active seller to `past_due` (soft-locking their dashboard) both when
 * a pending invoice passes its due date AND when the period lapses with no
 * pending invoice at all (convex/subscriptions.ts). Close to the due date the
 * swap could therefore lock the account of the seller most willing to pay us —
 * so we say so, and let them pay the monthly invoice instead.
 */
export const ANNUAL_SWAP_MIN_DAYS = 4;

/** The subset of a subscription this decision reads. Structural on purpose: the
 * server's `AccessState` payload and the client `SubscriptionView` mirror both
 * satisfy it without either importing the other. */
export type AnnualOfferSubscription = {
	plan: Plan;
	status: "trialing" | "active" | "past_due" | "cancelled";
	billingCycle?: "monthly" | "annual";
	comped?: boolean;
	currentPeriodEnd?: number;
};

/** The subset of an invoice this decision reads. `status` and `billingCycle` are
 * the raw strings off the doc rather than unions, so a stored row and a
 * hand-built test fixture both satisfy it without a cast. */
export type AnnualOfferInvoice = {
	status: string;
	currency: string;
	billingCycle?: string;
	invoiceNumber?: string;
	dueDate?: number;
};

export type AnnualOfferState =
	/** Render nothing — this seller is not in the annual conversation at all. */
	| { kind: "hidden" }
	/** An annual invoice is already waiting to be paid. */
	| { kind: "pendingAnnual"; invoiceNumber?: string }
	/** Already billed annually. A statement of fact, never a pitch. */
	| { kind: "onAnnual"; plan: Plan; renewsAt?: number }
	/** Eligible, an invoice is open, and there is still time to swap it safely. */
	| {
			kind: "switchInstead";
			plan: Plan;
			currency: BillingCurrency;
			quote: AnnualQuote;
			invoiceNumber?: string;
	  }
	/** Eligible, but the open invoice is too close to its due date to swap. */
	| {
			kind: "switchDeferred";
			plan: Plan;
			currency: BillingCurrency;
			quote: AnnualQuote;
			daysToDue: number;
	  }
	/** Eligible, nothing outstanding — show the switch. */
	| {
			kind: "offer";
			plan: Plan;
			currency: BillingCurrency;
			quote: AnnualQuote;
	  };

function isBillingCurrency(value: string): value is BillingCurrency {
	return (BILLING_CURRENCIES as readonly string[]).includes(value);
}

/**
 * Which currency to quote this seller in.
 *
 * Their own settled invoices, not the visitor geo-detection the marketing pages
 * use: a seller who has paid us twice has already told us what we bill them in,
 * and a VPN or a trip must not re-price their subscription. Falls back to the
 * default billing currency for a seller with no readable invoice currency — who
 * cannot reach the offer anyway, since it needs two paid invoices.
 */
export function offerCurrency(
	invoices: readonly AnnualOfferInvoice[],
): BillingCurrency {
	for (const invoice of invoices) {
		if (invoice.status === "paid" && isBillingCurrency(invoice.currency))
			return invoice.currency;
	}
	return DEFAULT_BILLING_CURRENCY;
}

/**
 * What the annual card should render for this seller.
 *
 * The ladder is ordered so each rung answers one question, and the order is
 * load-bearing:
 *  - `pendingAnnual` is checked FIRST. `issueInvoice` deliberately never touches
 *    the subscription, so a seller who already accepted still reads
 *    `billingCycle: "monthly"` for the whole payment window. Without this rung
 *    the card keeps selling them what they just bought, they ask again, and
 *    `issueInvoice` throws "already has a pending invoice" at the admin.
 *  - `onAnnual` is checked BEFORE the plan gate. A seller already billed
 *    annually is told so on any plan — hiding a true fact about their own
 *    billing because their tier is off-list would be a lie by omission.
 *  - Everything else is gated on `active`. A trialing, past-due or cancelled
 *    seller has a more urgent card on this same page; on `past_due` an upsell
 *    would be layered on a debt.
 */
export function resolveAnnualOffer(input: {
	subscription: AnnualOfferSubscription | null | undefined;
	invoices: readonly AnnualOfferInvoice[];
	now: number;
	/** True when the seller is a Founding Member — their annual is 10 × their
	 * discounted rate, never 10 × list. */
	founding?: boolean;
	/** A Kedaipal admin on their OWN store runs the app for free and is on no
	 * tier — the tab replaces the whole plan apparatus for them. */
	adminOwnAccount?: boolean;
}): AnnualOfferState {
	const {
		subscription: sub,
		invoices,
		now,
		founding = false,
		adminOwnAccount,
	} = input;

	if (adminOwnAccount) return { kind: "hidden" };
	if (!sub) return { kind: "hidden" };
	if (sub.comped) return { kind: "hidden" };

	const pendingInvoice = invoices.find((i) => i.status === "pending");

	if (pendingInvoice?.billingCycle === "annual")
		return { kind: "pendingAnnual", invoiceNumber: pendingInvoice.invoiceNumber };

	if (sub.billingCycle === "annual")
		return { kind: "onAnnual", plan: sub.plan, renewsAt: sub.currentPeriodEnd };

	if (!ANNUAL_OFFER_PLANS.includes(sub.plan)) return { kind: "hidden" };
	if (sub.status !== "active") return { kind: "hidden" };

	const paidCount = invoices.filter((i) => i.status === "paid").length;
	if (paidCount < ANNUAL_MIN_PAID_INVOICES) return { kind: "hidden" };

	const currency = offerCurrency(invoices);
	const quote = annualQuote(sub.plan, founding, currency);

	if (pendingInvoice) {
		// An open invoice does NOT hide the offer. Under manual billing nothing has
		// been collected yet, so this is the one moment in a cycle when switching
		// costs the seller nothing — and a monthly seller has an invoice pending for
		// roughly half of every cycle, so hiding it here would make the card blink
		// in and out on a rhythm they could not explain.
		const daysToDue = daysUntil(pendingInvoice.dueDate, now);
		if (
			pendingInvoice.dueDate !== undefined &&
			daysToDue < ANNUAL_SWAP_MIN_DAYS
		)
			return {
				kind: "switchDeferred",
				plan: sub.plan,
				currency,
				quote,
				daysToDue,
			};
		return {
			kind: "switchInstead",
			plan: sub.plan,
			currency,
			quote,
			invoiceNumber: pendingInvoice.invoiceNumber,
		};
	}

	return { kind: "offer", plan: sub.plan, currency, quote };
}
