import { describe, expect, it } from "vitest";
import { annualQuote, FOUNDING_MONTHLY_PRICE } from "../../convex/lib/plans";
import {
	ANNUAL_MIN_PAID_INVOICES,
	ANNUAL_OFFER_PLANS,
	ANNUAL_SWAP_MIN_DAYS,
	type AnnualOfferInvoice,
	type AnnualOfferSubscription,
	offerCurrency,
	resolveAnnualOffer,
} from "./annual-billing";

const NOW = Date.UTC(2026, 8, 4);
const DAY = 24 * 60 * 60 * 1000;

function sub(
	overrides: Partial<AnnualOfferSubscription> = {},
): AnnualOfferSubscription {
	return {
		plan: "pro",
		status: "active",
		billingCycle: "monthly",
		comped: false,
		...overrides,
	};
}

/** N settled invoices in `currency` — the baseline "proven payer". */
function paid(n: number, currency = "MYR"): AnnualOfferInvoice[] {
	return Array.from({ length: n }, () => ({ status: "paid", currency }));
}

function pendingInvoice(
	overrides: Partial<AnnualOfferInvoice> = {},
): AnnualOfferInvoice {
	return {
		status: "pending",
		currency: "MYR",
		invoiceNumber: "INV-202609-A1B2",
		dueDate: NOW + 10 * DAY,
		...overrides,
	};
}

const PROVEN = paid(ANNUAL_MIN_PAID_INVOICES);

/** Everything but the varying bits, so each test reads as its own condition. */
function resolve(
	overrides: Partial<Parameters<typeof resolveAnnualOffer>[0]> = {},
) {
	return resolveAnnualOffer({
		subscription: sub(),
		invoices: PROVEN,
		now: NOW,
		...overrides,
	});
}

describe("resolveAnnualOffer — who sees the switch", () => {
	it("offers the year to a proven, active Pro seller", () => {
		const state = resolve();
		expect(state.kind).toBe("offer");
		if (state.kind !== "offer") return;
		expect(state.plan).toBe("pro");
		expect(state.currency).toBe("MYR");
		expect(state.quote.annualTotal).toBe(149_000); // RM1,490
		expect(state.quote.saving).toBe(29_800); // two months
	});

	it("hides from a Starter — a year upfront before the shop is proven", () => {
		expect(ANNUAL_OFFER_PLANS).not.toContain("starter");
		expect(resolve({ subscription: sub({ plan: "starter" }) }).kind).toBe(
			"hidden",
		);
	});

	/**
	 * `issueInvoice` throws "Scale is unavailable for v1." — offering annual on
	 * Scale would reproduce in-app the dead-end CTA we refuse to ship publicly,
	 * and would hand the operator a request the mutation rejects.
	 */
	it("hides from Scale, which cannot be invoiced at all yet", () => {
		expect(ANNUAL_OFFER_PLANS).not.toContain("scale");
		expect(resolve({ subscription: sub({ plan: "scale" }) }).kind).toBe(
			"hidden",
		);
	});

	it("hides from an admin on their own store", () => {
		expect(resolve({ adminOwnAccount: true }).kind).toBe("hidden");
	});

	it("hides from a comped account — nothing is billed to switch", () => {
		expect(resolve({ subscription: sub({ comped: true }) }).kind).toBe("hidden");
	});

	it("hides with no subscription at all", () => {
		expect(resolve({ subscription: null }).kind).toBe("hidden");
		expect(resolve({ subscription: undefined }).kind).toBe("hidden");
	});

	it.each(["trialing", "past_due", "cancelled"] as const)(
		"hides while %s — that seller has a more urgent card on this page",
		(status) => {
			expect(resolve({ subscription: sub({ status }) }).kind).toBe("hidden");
		},
	);
});

describe("resolveAnnualOffer — the proven-payer gate", () => {
	it("needs two settled invoices", () => {
		expect(ANNUAL_MIN_PAID_INVOICES).toBe(2);
		expect(resolve({ invoices: paid(1) }).kind).toBe("hidden");
		expect(resolve({ invoices: paid(2) }).kind).toBe("offer");
	});

	it("counts only PAID invoices — void and pending don't qualify anyone", () => {
		expect(
			resolve({
				invoices: [
					{ status: "paid", currency: "MYR" },
					{ status: "void", currency: "MYR" },
					pendingInvoice(),
				],
			}).kind,
		).toBe("hidden");
	});

	it("hides for a brand-new seller with no invoice history", () => {
		expect(resolve({ invoices: [] }).kind).toBe("hidden");
	});
});

describe("resolveAnnualOffer — an annual invoice is already waiting", () => {
	/**
	 * `issueInvoice` deliberately never touches the subscription, so a seller who
	 * accepted yesterday still reads `billingCycle: "monthly"` for the whole
	 * payment window. Without this rung the card keeps selling what they bought,
	 * they ask again, and `issueInvoice` throws at the operator.
	 */
	it("short-circuits to pendingAnnual and stops selling", () => {
		const state = resolve({
			invoices: [...PROVEN, pendingInvoice({ billingCycle: "annual" })],
		});
		expect(state).toEqual({
			kind: "pendingAnnual",
			invoiceNumber: "INV-202609-A1B2",
		});
	});

	it("wins over every other rung, including a not-yet-proven seller", () => {
		expect(
			resolve({
				invoices: [pendingInvoice({ billingCycle: "annual" })],
				subscription: sub({ plan: "starter" }),
			}).kind,
		).toBe("pendingAnnual");
	});

	it("but never over a comped account", () => {
		expect(
			resolve({
				subscription: sub({ comped: true }),
				invoices: [pendingInvoice({ billingCycle: "annual" })],
			}).kind,
		).toBe("hidden");
	});
});

describe("resolveAnnualOffer — already on annual", () => {
	it("states the fact instead of pitching the switch", () => {
		expect(
			resolve({
				subscription: sub({
					billingCycle: "annual",
					currentPeriodEnd: 1_234,
				}),
			}),
		).toEqual({ kind: "onAnnual", plan: "pro", renewsAt: 1_234 });
	});

	/**
	 * The plan gate is deliberately BELOW this rung. An admin can issue a Starter
	 * annual invoice today, and telling that seller "you're on annual billing" is
	 * true; hiding it because Starter isn't a tier we market annual on would be a
	 * lie by omission about their own money.
	 */
	it("tells a Starter on annual the truth, off-list tier or not", () => {
		expect(
			resolve({
				subscription: sub({ plan: "starter", billingCycle: "annual" }),
			}),
		).toEqual({ kind: "onAnnual", plan: "starter", renewsAt: undefined });
	});

	it("holds on a non-active status too — the fact doesn't change", () => {
		expect(
			resolve({
				subscription: sub({ billingCycle: "annual", status: "past_due" }),
			}).kind,
		).toBe("onAnnual");
	});

	it("does not need a payment history to state it", () => {
		expect(
			resolve({
				subscription: sub({ billingCycle: "annual" }),
				invoices: [],
			}).kind,
		).toBe("onAnnual");
	});

	it("still hides for a comped account on an annual row", () => {
		expect(
			resolve({
				subscription: sub({ billingCycle: "annual", comped: true }),
			}).kind,
		).toBe("hidden");
	});

	it("treats a missing cycle as monthly, never as annual", () => {
		expect(resolve({ subscription: sub({ billingCycle: undefined }) }).kind).toBe(
			"offer",
		);
	});
});

describe("resolveAnnualOffer — an open invoice is the moment, not the blocker", () => {
	it("offers the swap while a monthly invoice is still unpaid", () => {
		const state = resolve({ invoices: [...PROVEN, pendingInvoice()] });
		expect(state.kind).toBe("switchInstead");
		if (state.kind !== "switchInstead") return;
		expect(state.quote.annualTotal).toBe(149_000);
		// The number the operator needs to void, carried to the CTA.
		expect(state.invoiceNumber).toBe("INV-202609-A1B2");
	});

	it("goes back to a plain offer once that invoice is settled", () => {
		expect(resolve({ invoices: paid(3) }).kind).toBe("offer");
	});

	it("a void invoice is not an open one", () => {
		expect(
			resolve({ invoices: [...PROVEN, { status: "void", currency: "MYR" }] })
				.kind,
		).toBe("offer");
	});
});

describe("resolveAnnualOffer — the swap window", () => {
	/**
	 * Swapping is void-then-reissue, which leaves a gap with no pending invoice.
	 * The daily cron flips an active seller to past_due — and soft-locks their
	 * dashboard — both on an overdue pending invoice and on a lapsed period with
	 * nothing pending. Close to the due date the swap could therefore lock the
	 * account of the seller most willing to pay us.
	 */
	it("defers inside the swap window and says how long is left", () => {
		const state = resolve({
			invoices: [...PROVEN, pendingInvoice({ dueDate: NOW + 3 * DAY })],
		});
		expect(state.kind).toBe("switchDeferred");
		if (state.kind !== "switchDeferred") return;
		expect(state.daysToDue).toBe(3);
		// Still quotes the year — the seller learns the price, just not today.
		expect(state.quote.annualTotal).toBe(149_000);
	});

	it("swaps at exactly the boundary, defers one day inside it", () => {
		expect(ANNUAL_SWAP_MIN_DAYS).toBe(4);
		expect(
			resolve({
				invoices: [...PROVEN, pendingInvoice({ dueDate: NOW + 4 * DAY })],
			}).kind,
		).toBe("switchInstead");
		expect(
			resolve({
				invoices: [...PROVEN, pendingInvoice({ dueDate: NOW + 3 * DAY })],
			}).kind,
		).toBe("switchDeferred");
	});

	it("defers an already-overdue invoice rather than offering a swap", () => {
		expect(
			resolve({
				invoices: [...PROVEN, pendingInvoice({ dueDate: NOW - 2 * DAY })],
			}).kind,
		).toBe("switchDeferred");
	});

	it("a pending invoice with no due date is swappable, not deferred", () => {
		// Legacy rows predate the field; absent is not the same as imminent.
		expect(
			resolve({
				invoices: [...PROVEN, pendingInvoice({ dueDate: undefined })],
			}).kind,
		).toBe("switchInstead");
	});
});

describe("offerCurrency", () => {
	it("quotes an SGD seller in SGD", () => {
		expect(offerCurrency(paid(2, "SGD"))).toBe("SGD");
		const state = resolve({ invoices: paid(2, "SGD") });
		expect(state.kind === "offer" && state.currency).toBe("SGD");
		expect(state.kind === "offer" && state.quote.annualTotal).toBe(59_000);
	});

	it("reads the seller's own settled invoices, not a pending one", () => {
		expect(
			offerCurrency([pendingInvoice({ currency: "SGD" }), ...paid(1, "MYR")]),
		).toBe("MYR");
	});

	it("falls back to MYR on an unknown or missing currency", () => {
		expect(offerCurrency([])).toBe("MYR");
		expect(offerCurrency([{ status: "paid", currency: "USD" }])).toBe("MYR");
	});
});

describe("resolveAnnualOffer — Founding members", () => {
	it("quotes 10 × their discounted rate, never 10 × list", () => {
		const state = resolve({ founding: true });
		expect(state.kind).toBe("offer");
		if (state.kind !== "offer") return;
		expect(state.quote.annualTotal).toBe(FOUNDING_MONTHLY_PRICE.pro * 10);
		expect(state.quote).toEqual(annualQuote("pro", true, "MYR"));
		// And the saving they are shown is their own two months, not ours.
		expect(state.quote.saving).toBeLessThan(annualQuote("pro", false).saving);
	});
});
