// Replacing a pending invoice with a corrected one (ClickUp z8r3fdpm2p) — the
// PURE rules, so the admin form's disabled-with-reason line and the server's
// refusal are one author.
//
// An admin mis-tiers a bill; the fix has always been "void it, then issue the
// right one", and the void dialog says exactly that ("frees them up for a
// corrected invoice"). Two steps in two different cards, with a window in
// between where the store has no bill at all. This makes it one act.
//
// The seller already has their own version of this (`invoices.switchPendingPlan`),
// which refuses RENEWAL invoices outright because the auto-charge machine is
// scheduled against the row being replaced. The admin door cannot refuse them —
// correcting a renewal is the commonest reason to reach for this — so it has
// to answer the two questions that exclusion was dodging: when is replacing a
// renewal unsafe, and does the replacement inherit the charge.

/** An invoice's `origin`, as the rules below care about it. */
export type ReplaceableOrigin =
	| "admin"
	| "self_serve"
	| "auto_renewal"
	| "first_invoice";

/**
 * Why this pending invoice must not be replaced in place, or `null`.
 *
 * The in-flight case is the one that matters. `chargeDueRenewal` stamps
 * `lastChargeAttemptAt` BEFORE it calls HitPay and clears it only on a
 * recorded outcome, so a standing stamp means a charge may have landed and
 * died before it could say so. Voiding that row then is a supported path —
 * the reconcile audits it as a *stranded charge* and switches the store's
 * auto-renew off until a human sorts it — but that is a safety net, not a
 * thing to walk into on purpose. The outcome resolves on the next daily run;
 * replacing after that costs the admin a day and costs the seller nothing.
 */
export function invoiceReplaceRefusal(args: {
	invoiceNumber: string;
	kind: "plan" | "hold";
	/** `autoRenew.lastChargeAttemptAt` is standing on this store. */
	chargeInFlight: boolean;
}): string | null {
	if (args.kind === "hold")
		return `${args.invoiceNumber} bills an Off-Season Hold, not a tier — resume the plan before changing what they're billed.`;
	if (args.chargeInFlight)
		return `A card charge for ${args.invoiceNumber} hasn't reported back yet — replacing it now could strand that payment. The daily run settles the question; try again after it.`;
	return null;
}

/**
 * Does the replacement inherit the voided bill's auto-charge?
 *
 * Only a RENEWAL ever had one scheduled (`internalIssueRenewalInvoice` is the
 * only issuer that arms `chargeDueRenewal`), so every other origin answers no
 * because there was nothing to inherit — not because we withheld anything.
 *
 * And only DOWNWARD. The seller's mandate is the amount already queued
 * against their card; a correction that costs the same or less stays inside
 * it, so letting it charge spares them a bill nothing would have paid and a
 * lock on day 14. An INCREASE is a new ask — Kedaipal decided (Zaki, 7 Oct
 * 2026) that it never charges itself on an admin's say-so, however the change
 * was agreed. The bill still exists and still carries its Pay-now link; the
 * seller pays it when they're ready.
 */
export function replacementKeepsAutoCharge(args: {
	replacedOrigin: ReplaceableOrigin;
	/** Minor units, the bill being replaced. */
	replacedTotal: number;
	/** The replaced bill's currency — "no more than" only means something
	 * inside ONE of them. */
	replacedCurrency: string;
	/** Minor units, the corrected bill. */
	newTotal: number;
	newCurrency: string;
	/** `autoChargeIdle(sub.autoRenew)` — armed, and nothing in flight. */
	autoChargeIdle: boolean;
}): boolean {
	if (args.replacedOrigin !== "auto_renewal") return false;
	if (!args.autoChargeIdle) return false;
	// Minor units are not comparable across currencies: S$60.00 (6000) reads
	// "cheaper" than RM79.00 (7900) and is worth roughly three times more. The
	// admin form picks the currency freely on a listed tier and takes the
	// contract's frozen one on Enterprise, so neither is guaranteed to match
	// the renewal being replaced — and converting to compare would invent an
	// FX rate nobody agreed, exactly as the contract template refuses to. A
	// mismatch is simply not a downward move, and the seller pays by link.
	if (args.replacedCurrency !== args.newCurrency) return false;
	return args.newTotal <= args.replacedTotal;
}

/**
 * The store's auto-renew with the dead bill's DUNNING dropped.
 *
 * `failedAttempts` / `nextRetryAt` / `lastChargeError` describe one bill — the
 * schema says so ("Dunning state for the CURRENT pending renewal invoice").
 * When a replacement voids that bill they describe nothing, and leaving them
 * standing is not inert: the daily sweep fires on `nextRetryAt` alone, picks
 * whatever invoice is open (it checks no origin, and neither does
 * `chargeDueRenewal`), and charges it. After a DECLINE that is the live state —
 * `recordChargeFailure` clears the attempt stamp, so `autoChargeIdle` is true
 * and the replacement is allowed — so a dearer correction the form promised
 * would never be charged gets charged two days later (found in review, 7 Oct).
 *
 * Clearing is also simply correct: a replaced bill is a new bill, and its
 * dunning ladder starts at zero. A charge this replacement DOES inherit
 * schedules itself, and a failure there mints a fresh ladder.
 */
export function autoRenewAfterReplace<
	T extends {
		failedAttempts?: number;
		nextRetryAt?: number;
		lastChargeError?: string;
	},
>(autoRenew: T): T {
	return {
		...autoRenew,
		failedAttempts: undefined,
		nextRetryAt: undefined,
		lastChargeError: undefined,
	};
}

/**
 * What the admin is told about the card, once a replacement is drafted. Said
 * BEFORE the tap, because "their card will/won't be charged" is the part an
 * admin cannot discover afterwards without reading a webhook log.
 */
export function replacementChargeNote(args: {
	replacedOrigin: ReplaceableOrigin;
	replacedTotal: number;
	replacedCurrency: string;
	newTotal: number;
	newCurrency: string;
	autoChargeIdle: boolean;
	/** Formatted, e.g. "RM 79.00" — the caller owns money formatting. */
	newTotalLabel: string;
}): string | null {
	if (args.replacedOrigin !== "auto_renewal") return null;
	if (!args.autoChargeIdle)
		return "Their saved card won't charge this automatically — send them the Pay-now link.";
	if (replacementKeepsAutoCharge(args))
		return `Their saved card will be charged ${args.newTotalLabel} automatically, as the renewal it replaces would have been.`;
	// Two different reasons, never collapsed into "costs more": across
	// currencies there is no cheaper or dearer, and saying there is would be
	// the note inventing an exchange rate.
	return args.replacedCurrency !== args.newCurrency
		? "This bills a different currency from the renewal it replaces, so their saved card won't be charged for it — send them the Pay-now link."
		: "This costs more than the renewal it replaces, so their saved card won't be charged for it — send them the Pay-now link.";
}
