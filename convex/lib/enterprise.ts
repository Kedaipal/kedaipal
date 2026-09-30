// Kedaipal Enterprise contracts (Credits T6, ClickUp z8r3fdkp8h,
// docs/pricing.md#enterprise) — the PURE rules. Enterprise has no list price:
// a Kedaipal admin attaches a per-store contract (`enterprise.setContract`),
// and every Enterprise invoice and monthly grant is read from it. No Convex
// imports, so the admin form's disabled-with-reason line and the server's
// refusal are one author.

import type { BillingCycle, Plan } from "./plans";

/** The listed plan and cycle a store was on when its contract was attached —
 * what bought the period still running then (`subscriptions.enterprise.
 * enteredFrom`). */
export type EnterpriseEntry = {
	plan: "starter" | "pro";
	billingCycle: BillingCycle;
};

/** The block an overage is sold in unless the deal says otherwise (HSL:
 * 5,000 credits at RM0.60). */
export const ENTERPRISE_BLOCK_SIZE_DEFAULT = 5000;

/** Typo guards — said beside the button, refused by the server. A monthly fee
 * above RM1,000,000 or a block above a million credits is a slipped zero. */
export const ENTERPRISE_FEE_MAX_MINOR = 100_000_000;
export const ENTERPRISE_BLOCK_MAX = 1_000_000;
export const ENTERPRISE_CONTACT_MAX = 80;
export const ENTERPRISE_NOTES_MAX = 500;

export type EnterpriseContractInput = {
	/** Monthly fee, minor units, in the contract's currency. */
	baseFeeMinor: number;
	includedCredits: number;
	/** Per credit, minor units. Zero is allowed: a deal can include overage. */
	overageRateMinor: number;
	blockSize: number;
	/** The term: monthly = a 1-month term, annual = 12 months prepaid. */
	billingCycle: BillingCycle;
	contactName: string;
	notes?: string;
};

const wholeMinor = (n: number) => Number.isInteger(n) && n >= 0;

/**
 * Why a contract can't be saved as entered, or `null`. `maxIncluded` is the
 * credit ledger's own grant ceiling (`grantOverrideProblem`), passed in so
 * this module stays free of the ledger.
 */
export function enterpriseContractProblem(
	input: EnterpriseContractInput,
	maxIncluded: number,
): string | null {
	if (!wholeMinor(input.baseFeeMinor) || input.baseFeeMinor === 0)
		return "Enter the monthly fee — an Enterprise contract is never free (a store on the house is comped instead).";
	if (input.baseFeeMinor > ENTERPRISE_FEE_MAX_MINOR)
		return "That monthly fee looks like a slipped zero — check it.";
	if (
		!Number.isInteger(input.includedCredits) ||
		input.includedCredits <= 0 ||
		input.includedCredits > maxIncluded
	)
		return `Included credits are a whole number from 1 to ${maxIncluded.toLocaleString("en")}.`;
	if (!wholeMinor(input.overageRateMinor))
		return "The overage rate is a price per credit — zero or more, in sen or cents.";
	if (
		!Number.isInteger(input.blockSize) ||
		input.blockSize <= 0 ||
		input.blockSize > ENTERPRISE_BLOCK_MAX
	)
		return `A block is a whole number of credits from 1 to ${ENTERPRISE_BLOCK_MAX.toLocaleString("en")}.`;
	const contact = input.contactName.trim();
	if (contact.length < 2)
		return "Name the person the contract is with — the buyer's contact.";
	if (contact.length > ENTERPRISE_CONTACT_MAX)
		return `Keep the contact name under ${ENTERPRISE_CONTACT_MAX} characters.`;
	if ((input.notes?.trim().length ?? 0) > ENTERPRISE_NOTES_MAX)
		return `Keep the notes under ${ENTERPRISE_NOTES_MAX} characters.`;
	return null;
}

/** What one overage block costs, minor units — the manual invoice an admin
 * raises before landing the block. */
export function enterpriseBlockPrice(contract: {
	overageRateMinor: number;
	blockSize: number;
}): number {
	return contract.overageRateMinor * contract.blockSize;
}

/** The sentence a seller reads when a self-serve plan path meets their
 * Enterprise contract — plan changes on a contract are a conversation, and
 * the billing page offers "Message us" instead of a picker. */
export const ENTERPRISE_SELF_SERVE_REFUSAL =
	"Your store is on an Enterprise contract, so plan changes go through Kedaipal — message us and we'll sort it.";

/**
 * Why a contract can't be saved while a bill is open, or `null` — said beside
 * the admin form's button and thrown by `enterprise.setContract` (one author).
 * A bill at another tier still bills that tier; a contract bill at the OTHER
 * term would, once paid, write its term back onto the row (settle takes the
 * cycle from the bill), silently undoing the change.
 */
export function enterpriseTermChangeBlocker(args: {
	pending:
		| { invoiceNumber: string; plan: Plan; billingCycle: BillingCycle }
		| undefined;
	billingCycle: BillingCycle;
}): string | null {
	const bill = args.pending;
	if (!bill) return null;
	if (bill.plan !== "enterprise")
		return `Settle or void ${bill.invoiceNumber} first — it bills ${bill.plan === "pro" ? "Pro" : "Starter"}, not the contract.`;
	if (bill.billingCycle !== args.billingCycle)
		return `Settle or void ${bill.invoiceNumber} first — it bills the contract's ${bill.billingCycle === "annual" ? "yearly" : "monthly"} term, and paying it would put that term back.`;
	return null;
}

/** An open bill that takes a contract store OFF its contract — the Pro bill
 * a scheduled move issues at renewal, or one an admin issued by hand. Paying
 * it ends the contract (`settleInvoicePaid`), so calling the move off voids
 * it. */
export function isMoveOffContractBill(
	invoice: { kind?: "plan" | "hold"; plan?: Plan },
	sub: { plan: Plan },
): boolean {
	return (
		sub.plan === "enterprise" &&
		(invoice.kind ?? "plan") === "plan" &&
		invoice.plan !== undefined &&
		invoice.plan !== "enterprise"
	);
}
