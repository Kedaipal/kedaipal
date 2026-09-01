import {
	CLAIM_PAYMENT_RUNWAY_MS,
	describeClaimWindow,
} from "../../convex/lib/orderClaims";

/**
 * The Counter Checkout panel's mode rules (86eyq0epn).
 *
 * The panel asks ONE question first — "How is this order paid?" — and every
 * block below it depends on the answer. These are the parts of that dependency
 * that are RULES rather than markup, so they live here where they can be
 * asserted directly instead of through a 2,600-line route component.
 *
 *   counter — the buyer is standing here: the seller keys collection + payment.
 *   send    — the buyer finishes on their phone under a countdown, so the
 *             seller keys NEITHER. Rendering those controls in send mode was
 *             the original confusion: a seller filled them in, tapped Send, and
 *             nothing they had keyed ever reached the buyer.
 */
export type CounterPayMode = "counter" | "send";

/** Does this mode let the seller key collection + payment? The one predicate
 * both blocks gate on, so they can never disagree about which mode they're in. */
export function showsSellerPaymentControls(mode: CounterPayMode): boolean {
	return mode === "counter";
}

export interface PrimaryActionInput {
	mode: CounterPayMode;
	/** Cart is empty — nothing to sell either way. */
	empty: boolean;
	/** A line still has no price. Only blocks SEND: a claim freezes prices at
	 * send, so an unpriced line would lock a zero. The counter path resolves
	 * price at create and its own review dialog catches it. */
	unpriced: boolean;
	/** Formatted money for the label, e.g. "RM 20.00". */
	money: string;
	windowMinutes: number;
	/** Who the link goes to, for the helper line. */
	buyerName?: string;
}

export interface PrimaryAction {
	label: string;
	disabled: boolean;
	/** Why it's disabled, in the seller's words — never a silently dead button. */
	reason?: string;
	/** Sub-line under the CTA; absent on the counter path, which needs none. */
	helper?: string;
}

/**
 * The single primary action. There is exactly one at any time — two competing
 * full-width buttons in the same slot is what made the old panel ambiguous.
 */
export function counterPrimaryAction(input: PrimaryActionInput): PrimaryAction {
	const { mode, empty, unpriced, money, windowMinutes, buyerName } = input;
	if (mode === "send") {
		const reason = empty
			? "Add an item first"
			: unpriced
				? "Set a price for every custom item first"
				: undefined;
		const runwayMinutes = Math.round(CLAIM_PAYMENT_RUNWAY_MS / 60_000);
		return {
			// Shows the MONEY, mirroring the counter primary: the price is what a
			// send commits, and it is the figure directly above the button.
			label: `Send link · ${money}`,
			disabled: reason !== undefined,
			reason,
			helper:
				reason ??
				// Verb agrees with the subject: a named buyer "gets", an unnamed
				// one is "They get" — "They gets" is the giveaway that a template
				// was written for one case only.
				`${buyerName ? `${buyerName} gets` : "They get"} the link on WhatsApp and ${buyerName ? "has" : "have"} ${describeClaimWindow(windowMinutes)} to complete it, then at least ${runwayMinutes} minutes to pay. Nothing is charged until they pay.`,
		};
	}
	return {
		label: `Review order · ${money}`,
		disabled: empty,
		reason: empty ? "Add an item first" : undefined,
	};
}
