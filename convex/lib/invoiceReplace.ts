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
	/** Minor units, the corrected bill. */
	newTotal: number;
	/** `autoChargeIdle(sub.autoRenew)` — armed, and nothing in flight. */
	autoChargeIdle: boolean;
}): boolean {
	if (args.replacedOrigin !== "auto_renewal") return false;
	if (!args.autoChargeIdle) return false;
	return args.newTotal <= args.replacedTotal;
}

/**
 * What the admin is told about the card, once a replacement is drafted. Said
 * BEFORE the tap, because "their card will/won't be charged" is the part an
 * admin cannot discover afterwards without reading a webhook log.
 */
export function replacementChargeNote(args: {
	replacedOrigin: ReplaceableOrigin;
	replacedTotal: number;
	newTotal: number;
	autoChargeIdle: boolean;
	/** Formatted, e.g. "RM 79.00" — the caller owns money formatting. */
	newTotalLabel: string;
}): string | null {
	if (args.replacedOrigin !== "auto_renewal") return null;
	if (!args.autoChargeIdle)
		return "Their saved card won't charge this automatically — send them the Pay-now link.";
	return replacementKeepsAutoCharge(args)
		? `Their saved card will be charged ${args.newTotalLabel} automatically, as the renewal it replaces would have been.`
		: "This costs more than the renewal it replaces, so their saved card won't be charged for it — send them the Pay-now link.";
}
