// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	BILLING_CURRENCIES,
	type BillingCurrency,
	planPrice,
} from "../../../convex/lib/plans";
import {
	ANNUAL_OFFER_PLANS,
	type AnnualOfferInvoice,
	type AnnualOfferState,
	resolveAnnualOffer,
} from "../../lib/annual-billing";
import { formatPrice } from "../../lib/format";
import { AnnualBillingCard } from "./annual-billing-card";

afterEach(cleanup);

const NOW = Date.UTC(2026, 8, 4);
const DAY = 24 * 60 * 60 * 1000;
const WA = "60111111111";

function paid(currency: string): AnnualOfferInvoice[] {
	return [
		{ status: "paid", currency },
		{ status: "paid", currency },
	];
}

function state(
	overrides: Partial<Parameters<typeof resolveAnnualOffer>[0]> = {},
): AnnualOfferState {
	return resolveAnnualOffer({
		subscription: { plan: "pro", status: "active", billingCycle: "monthly" },
		invoices: paid("MYR"),
		now: NOW,
		...overrides,
	});
}

function renderCard(s: AnnualOfferState, founding = false) {
	return render(
		<AnnualBillingCard
			state={s}
			slug="openmarket"
			supportWa={WA}
			founding={founding}
		/>,
	);
}

/** The single wa.me href the card renders, decoded. */
function waText(): string {
	const a = screen
		.getAllByRole("link")
		.map((n) => n.getAttribute("href") ?? "")
		.find((h) => h.startsWith("https://wa.me/"));
	return decodeURIComponent(a ?? "");
}

describe("AnnualBillingCard — the number on screen is the number on the invoice", () => {
	/**
	 * The regression this whole change exists for: /pricing derived its yearly
	 * total from a rounded effective monthly and advertised RM650 against an
	 * RM790 invoice. Nothing the seller reads may be computed a second way.
	 */
	it.each(
		ANNUAL_OFFER_PLANS.flatMap((plan) =>
			BILLING_CURRENCIES.flatMap((currency) =>
				[false, true].map(
					(founding) => [plan, currency, founding] as const,
				),
			),
		),
	)("%s / %s / founding=%s quotes planPrice exactly", (plan, currency, founding) => {
		const s = state({
			subscription: { plan, status: "active", billingCycle: "monthly" },
			invoices: paid(currency),
			founding,
		});
		renderCard(s, founding);
		const expected = formatPrice(
			planPrice(plan, "annual", founding, currency as BillingCurrency),
			currency,
		);
		// formatPrice glues the symbol on with a non-breaking space; the DOM
		// matcher normalizes that to a plain one, so the needle has to as well.
		expect(
			screen.getAllByText(expected.replace(/\u00A0/g, " ")).length,
		).toBeGreaterThan(0);
		// …and the same figure reaches the operator, so the issued invoice can't
		// disagree with what the seller was shown.
		expect(waText()).toContain(expected);
	});
});

describe("AnnualBillingCard — framing rules", () => {
	const cases: [string, AnnualOfferState][] = [
		["offer", state()],
		[
			"switchInstead",
			state({
				invoices: [
					...paid("MYR"),
					{
						status: "pending",
						currency: "MYR",
						billingCycle: "monthly",
						invoiceNumber: "INV-9",
						dueDate: NOW + 10 * DAY,
					},
				],
			}),
		],
		[
			"switchDeferred",
			state({
				invoices: [
					...paid("MYR"),
					{
						status: "pending",
						currency: "MYR",
						billingCycle: "monthly",
						invoiceNumber: "INV-9",
						dueDate: NOW + 2 * DAY,
					},
				],
			}),
		],
		[
			"onAnnual",
			state({
				subscription: {
					plan: "pro",
					status: "active",
					billingCycle: "annual",
					currentPeriodEnd: Date.UTC(2027, 2, 12),
				},
			}),
		],
		[
			"pendingAnnual",
			state({
				invoices: [
					...paid("MYR"),
					{
						status: "pending",
						currency: "MYR",
						billingCycle: "annual",
						invoiceNumber: "INV-9",
						dueDate: NOW + 10 * DAY,
					},
				],
			}),
		],
	];

	/** "2 months free", never "17% off" — a standing percentage reads as a
	 * markdown on a flat price. */
	it.each(cases)("%s names no percentage", (_name, s) => {
		const { container } = renderCard(s);
		expect(container.textContent ?? "").not.toContain("%");
	});

	it.each(cases)("%s hardcodes no currency symbol of its own", (_name, s) => {
		// Every amount must flow through formatPrice from the resolved currency —
		// an SGD seller reading "RM" is the bug the SG pass fixed twice.
		const { container } = renderCard(s);
		const sgd = resolveAnnualOffer({
			subscription: { plan: "pro", status: "active", billingCycle: "monthly" },
			invoices: paid("SGD"),
			now: NOW,
		});
		cleanup();
		const { container: sgdBox } = renderCard(sgd);
		if ((container.textContent ?? "").includes("RM")) {
			expect(sgdBox.textContent ?? "").not.toContain("RM");
		}
	});
});

describe("AnnualBillingCard — states", () => {
	it("hidden renders nothing at all", () => {
		const { container } = renderCard({ kind: "hidden" });
		expect(container.innerHTML).toBe("");
	});

	it("offer leads with the amount transferred, not the flattering one", () => {
		renderCard(state());
		expect(screen.getByText("RM 1,490.00")).toBeTruthy();
		// The effective monthly is present but explicitly never billed.
		expect(screen.getByText(/we only ever invoice the year/)).toBeTruthy();
	});

	it("says nothing changes until support confirms", () => {
		renderCard(state());
		expect(screen.getByText(/Nothing changes until we confirm/)).toBeTruthy();
	});

	it("a Founding member's message names their rate, so the flag gets ticked", () => {
		renderCard(state({ founding: true }), true);
		expect(waText()).toContain("at my Founding Member rate");
		expect(screen.getByText("RM 1,040.00")).toBeTruthy();
	});

	it("a standard seller's message does NOT claim a founding rate", () => {
		renderCard(state());
		expect(waText()).not.toContain("Founding");
	});

	it("pendingAnnual offers no call to action", () => {
		renderCard(
			state({
				invoices: [
					...paid("MYR"),
					{
						status: "pending",
						currency: "MYR",
						billingCycle: "annual",
						invoiceNumber: "INV-9",
						dueDate: NOW + 10 * DAY,
					},
				],
			}),
		);
		expect(screen.getByText("Your annual invoice is ready")).toBeTruthy();
		expect(screen.queryByRole("link")).toBeNull();
	});

	it("onAnnual states the credit position without promising an email", () => {
		renderCard(
			state({
				subscription: {
					plan: "pro",
					status: "active",
					billingCycle: "annual",
					currentPeriodEnd: Date.UTC(2027, 2, 12),
				},
			}),
		);
		expect(screen.getByText(/credited to the new one/)).toBeTruthy();
		// The renewal chase is a log line today — never promise a reminder here.
		expect(screen.queryByText(/we'll email|we will email|remind/i)).toBeNull();
	});

	it("switchDeferred explains the wait instead of a button that misbehaves", () => {
		renderCard(
			state({
				invoices: [
					...paid("MYR"),
					{
						status: "pending",
						currency: "MYR",
						billingCycle: "monthly",
						invoiceNumber: "INV-9",
						dueDate: NOW + 2 * DAY,
					},
				],
			}),
		);
		expect(screen.getByText(/too soon to swap it safely/)).toBeTruthy();
		expect(screen.getByText(/pay it as normal/)).toBeTruthy();
		expect(waText()).toContain("from the next one");
	});
});
