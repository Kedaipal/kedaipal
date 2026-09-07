// @vitest-environment jsdom
import { useQuery } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../convex/_generated/api";
import { DEFAULT_SUPPORT_WA_NUMBER } from "../../lib/contact";
import { BillingTab } from "./billing-tab";

// Reads go via `useQuery(convexQuery(api.x, args)).data` — mock the adapter
// pair (convexQuery passes the ref through; useQuery answers by function name).
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));
// InvoiceDownloadButton (rendered inside the pending-invoice card) fetches the
// PDF URL via useAction — stub it so the card renders without a ConvexProvider.
vi.mock("convex/react", () => ({ useAction: () => vi.fn() }));

afterEach(cleanup);

type Retailer = Parameters<typeof BillingTab>[0]["retailer"];

/** Minimal retailer payload for the billing tab — a real (non-comped) Pro store
 * that's past due, matching the screenshot the fix targets. */
function retailer(overrides: Partial<Retailer> = {}): Retailer {
	return {
		slug: "openmarket",
		isFoundingMember: false,
		ordersThisMonth: 0,
		subscription: {
			plan: "pro",
			status: "past_due",
			comped: false,
			caps: { orderCap: 500, userCap: 3, broadcastQuota: 0 },
			features: { crm: true, orderInbox: true, chargeablePickup: true },
			active: false,
			frozen: true,
		},
		...overrides,
	} as unknown as Retailer;
}

/** A number that is deliberately NOT the built-in default, so an assertion
 * against it proves the link followed the configured value. */
const CONFIGURED_WA = "60111111111";

/** Wire the four useQuery calls the tab makes, keyed by function name (the
 * generated `api` proxy hands back a fresh reference per access, so `===` on the
 * reference itself is unreliable — match on the stable name instead). */
function mockQueries({
	isAdmin,
	// `null` = the query hasn't resolved (SSR / first paint), which reaches the
	// component as `undefined`. Passing `undefined` here can't express that —
	// the destructuring default would swallow it.
	supportWa = CONFIGURED_WA,
	invoices = [],
}: {
	isAdmin: boolean;
	supportWa?: string | null;
	invoices?: unknown[];
}) {
	const NAME = {
		amIAdmin: getFunctionName(api.billing.amIAdmin),
		invoices: getFunctionName(api.invoices.myInvoices),
		instructions: getFunctionName(api.billing.paymentInstructions),
		supportWa: getFunctionName(api.contact.supportWhatsapp),
	};
	vi.mocked(useQuery).mockImplementation(((opts: {
		__fn: FunctionReference<"query">;
	}) => {
		const name = getFunctionName(opts.__fn);
		const data = (() => {
			if (name === NAME.amIAdmin) return isAdmin;
			if (name === NAME.invoices) return invoices;
			// Bank/DuitNow details only — the support number has its own query.
			if (name === NAME.instructions) return { bankName: "Maybank" };
			if (name === NAME.supportWa) return supportWa ?? undefined;
			return undefined;
		})();
		return { data, isPending: false };
	}) as unknown as typeof useQuery);
}

/** Every wa.me href the tab renders. */
function waLinks(): string[] {
	return screen
		.getAllByRole("link")
		.map((a) => a.getAttribute("href") ?? "")
		.filter((href) => href.startsWith("https://wa.me/"));
}

describe("BillingTab admin plan suppression", () => {
	it("shows the tier + past-due status to a normal seller", () => {
		mockQueries({ isAdmin: false });
		render(<BillingTab retailer={retailer()} />);
		expect(screen.getByText("Current plan")).toBeTruthy();
		expect(screen.getByText("Pro")).toBeTruthy();
		expect(screen.getByText("Past due")).toBeTruthy();
		expect(screen.queryByText("Admin account")).toBeNull();
	});

	it("hides the plan/tier card for an admin on their own store", () => {
		mockQueries({ isAdmin: true });
		render(<BillingTab retailer={retailer()} />);
		expect(screen.getByText("Admin account")).toBeTruthy();
		// No tier, status badge or renew nudge — admins aren't on a plan.
		expect(screen.queryByText("Current plan")).toBeNull();
		expect(screen.queryByText("Past due")).toBeNull();
		expect(screen.queryByText("Renew your subscription")).toBeNull();
	});

	it("keeps the seller's real plan visible while an admin acts-as", () => {
		mockQueries({ isAdmin: true });
		render(<BillingTab retailer={retailer({ actingAsAdmin: true })} />);
		// White-glove support must see + manage the seller's actual billing.
		expect(screen.getByText("Current plan")).toBeTruthy();
		expect(screen.getByText("Past due")).toBeTruthy();
		expect(screen.queryByText("Admin account")).toBeNull();
	});
});

describe("BillingTab support WhatsApp number", () => {
	/** ClickUp 86eyjuvyu: every seller→Kedaipal CTA must reach the number an
	 * operator configured (`SUPPORT_WA_PHONE`), never the buyer-facing WABA
	 * checkout sender (`WHATSAPP_CHECKOUT_PHONE`) and never a hardcoded value. */
	it("points every WhatsApp CTA at the configured support number", () => {
		mockQueries({ isAdmin: false });
		render(<BillingTab retailer={retailer()} />);
		const links = waLinks();
		expect(links.length).toBeGreaterThan(0);
		for (const href of links) {
			expect(href.startsWith(`https://wa.me/${CONFIGURED_WA}?`)).toBe(true);
		}
	});

	it("falls back to the default number before the query resolves", () => {
		// SSR and first paint have no answer yet; the CTA must still be live.
		mockQueries({ isAdmin: false, supportWa: null });
		render(<BillingTab retailer={retailer()} />);
		const links = waLinks();
		expect(links.length).toBeGreaterThan(0);
		for (const href of links) {
			expect(
				href.startsWith(`https://wa.me/${DEFAULT_SUPPORT_WA_NUMBER}?`),
			).toBe(true);
		}
	});

	it("renders the support card even with no billing config", () => {
		// The CTA used to hang off a server-provided phone, so an unset env var
		// silently removed the seller's only way to reach us.
		vi.mocked(useQuery).mockImplementation(((opts: {
			__fn: FunctionReference<"query">;
		}) => {
			const name = getFunctionName(opts.__fn);
			const data = (() => {
				if (name === getFunctionName(api.invoices.myInvoices)) return [];
				if (name === getFunctionName(api.billing.paymentInstructions))
					return null;
				return false;
			})();
			return { data, isPending: false };
		}) as unknown as typeof useQuery);
		render(<BillingTab retailer={retailer()} />);
		expect(screen.getByText("Contact support on WhatsApp")).toBeTruthy();
	});
});

describe("BillingTab pending invoice — how to pay", () => {
	/** Minimal `myInvoices` row for the pending-invoice card. */
	function pendingInvoice(currency: string) {
		return {
			_id: "inv1",
			status: "pending",
			invoiceNumber: "INV-202608-SG01",
			total: currency === "SGD" ? 5900 : 14900,
			currency,
			dueDate: Date.now() + 7 * 24 * 60 * 60 * 1000,
		};
	}

	it("MYR invoice shows the configured MY rails", () => {
		mockQueries({ isAdmin: false, invoices: [pendingInvoice("MYR")] });
		render(<BillingTab retailer={retailer()} />);
		// mockQueries wires paymentInstructions with only bankName ("Maybank"),
		// which has no account number — so the fallback line renders; the point
		// is the MYR branch still goes through the pay-details path.
		expect(screen.getByText("How to pay")).toBeTruthy();
		expect(
			screen.queryByText(/confirm payment details with you on WhatsApp/i),
		).toBeNull();
	});

	it("a cross-border (SGD) invoice hides the MY rails and points at WhatsApp", () => {
		// Fully-configured MY rails must STILL not render — they can't settle SGD.
		vi.mocked(useQuery).mockImplementation(((opts: {
			__fn: FunctionReference<"query">;
		}) => {
			const name = getFunctionName(opts.__fn);
			const data = (() => {
				if (name === getFunctionName(api.invoices.myInvoices))
					return [pendingInvoice("SGD")];
				if (name === getFunctionName(api.billing.paymentInstructions))
					return {
						bankName: "Maybank",
						bankAccountNumber: "5123 4567 8901",
						duitnowId: "kedaipal",
					};
				if (name === getFunctionName(api.contact.supportWhatsapp))
					return CONFIGURED_WA;
				return false;
			})();
			return { data, isPending: false };
		}) as unknown as typeof useQuery);
		render(<BillingTab retailer={retailer()} />);
		expect(
			screen.getByText(/confirm payment details with you on WhatsApp/i),
		).toBeTruthy();
		// The number renders both in the card header and as the payment reference.
		expect(
			screen.getAllByText("INV-202608-SG01", { exact: false }).length,
		).toBeGreaterThanOrEqual(2);
		expect(screen.queryByText("Maybank")).toBeNull();
		expect(screen.queryByText("DuitNow")).toBeNull();
	});
});

/**
 * Annual billing (src/lib/annual-billing.ts). The eligibility ladder is unit
 * tested there; these cover the WIRING — that the tab feeds the resolver the
 * right seller and renders the state it gets back.
 */
describe("BillingTab annual billing", () => {
	/** An active Pro seller — the default fixture is past_due, which is hidden. */
	function activePro(overrides: Record<string, unknown> = {}) {
		return retailer({
			subscription: {
				plan: "pro",
				status: "active",
				comped: false,
				caps: { orderCap: 500, userCap: 3, broadcastQuota: 0 },
				features: { crm: true, orderInbox: true, chargeablePickup: true },
				active: true,
				frozen: false,
				...overrides,
			},
		} as never);
	}

	const settled = [
		{ _id: "i1", status: "paid", currency: "MYR", total: 14900, invoiceNumber: "INV-1" },
		{ _id: "i2", status: "paid", currency: "MYR", total: 14900, invoiceNumber: "INV-2" },
	];

	it("offers the year to a proven, active Pro seller", () => {
		mockQueries({ isAdmin: false, invoices: settled });
		render(<BillingTab retailer={activePro()} />);
		expect(screen.getByText(/Pay for the year, get 2 months free/)).toBeTruthy();
		// The real invoice total — RM1,490, not the RM650 the pricing page used
		// to derive from a rounded effective monthly.
		expect(screen.getByText(/RM\s*1,490\.00/)).toBeTruthy();
		expect(screen.getByText(/Save RM\s*298\.00/)).toBeTruthy();
		expect(screen.getByText("Switch to annual billing")).toBeTruthy();
	});

	it("puts the store, plan and exact amount in the WhatsApp message", () => {
		mockQueries({ isAdmin: false, invoices: settled });
		render(<BillingTab retailer={activePro()} />);
		const href = waLinks().find((l) => l.includes("annual"));
		expect(href).toBeTruthy();
		const text = decodeURIComponent(href ?? "");
		expect(text).toContain("/openmarket");
		expect(text).toContain("Pro");
		expect(text).toContain("1,490.00");
		expect(text).toContain("12 months");
	});

	it("states the refund position before the seller commits", () => {
		mockQueries({ isAdmin: false, invoices: settled });
		render(<BillingTab retailer={activePro()} />);
		expect(screen.getByText(/isn't refunded in cash/)).toBeTruthy();
	});

	it("hides from a seller with only one settled invoice", () => {
		mockQueries({ isAdmin: false, invoices: [settled[0]] });
		render(<BillingTab retailer={activePro()} />);
		expect(screen.queryByText(/Pay for the year/)).toBeNull();
	});

	it("hides while past due — the renew card is the urgent thing", () => {
		mockQueries({ isAdmin: false, invoices: settled });
		render(<BillingTab retailer={retailer()} />); // fixture is past_due
		expect(screen.queryByText(/Pay for the year/)).toBeNull();
	});

	it("hides from an admin on their own store", () => {
		mockQueries({ isAdmin: true, invoices: settled });
		render(<BillingTab retailer={activePro()} />);
		expect(screen.queryByText(/Pay for the year/)).toBeNull();
	});

	it("tells an annual seller they're on annual, and stops selling", () => {
		mockQueries({ isAdmin: false, invoices: settled });
		render(
			<BillingTab
				retailer={activePro({
					billingCycle: "annual",
					currentPeriodEnd: Date.UTC(2027, 2, 12),
				})}
			/>,
		);
		expect(screen.getByText("You're on annual billing")).toBeTruthy();
		// Locale-independent — the runner's default locale decides the date shape
		// ("12 Mar 2027" vs "Mar 12, 2027"), so assert the year, not the order.
		expect(screen.getByText(/Your current year runs to .*2027/)).toBeTruthy();
		expect(screen.queryByText("Switch to annual billing")).toBeNull();
	});

	it("offers the swap while an invoice is still open, not after", () => {
		mockQueries({
			isAdmin: false,
			invoices: [
				...settled,
				{
					_id: "i3",
					status: "pending",
					currency: "MYR",
					total: 14900,
					invoiceNumber: "INV-3",
					billingCycle: "monthly",
					dueDate: Date.now() + 10 * 24 * 60 * 60 * 1000,
				},
			],
		});
		render(<BillingTab retailer={activePro()} />);
		expect(screen.getByText("Pay for the year instead?")).toBeTruthy();
		expect(screen.getByText("Ask for an annual invoice")).toBeTruthy();
		const href = waLinks().find((l) => l.includes("annual"));
		const swap = decodeURIComponent(href ?? "");
		expect(swap).toContain("cancel that invoice");
		// The invoice number the operator must void, and the seller's own
		// assertion that nothing has been transferred yet.
		expect(swap).toContain("INV-3");
		expect(swap).toContain("haven't paid it yet");
	});

	it("quotes an SGD seller in SGD", () => {
		mockQueries({
			isAdmin: false,
			invoices: settled.map((i) => ({ ...i, currency: "SGD" })),
		});
		render(<BillingTab retailer={activePro()} />);
		expect(screen.getByText(/S\$\s*590\.00/)).toBeTruthy();
		expect(screen.queryByText(/RM\s*1,490\.00/)).toBeNull();
	});

	it("tells a Starter that Pro can be billed yearly", () => {
		mockQueries({ isAdmin: false, invoices: settled });
		render(<BillingTab retailer={activePro({ plan: "starter" })} />);
		// The offer itself is Pro+, but the tier must still learn it exists.
		expect(screen.queryByText(/Pay for the year/)).toBeNull();
		expect(screen.getByText(/billed annually, with two months free/)).toBeTruthy();
		// The constraint is explained, not left as an unexplained absence.
		expect(screen.getByText(/We don't offer annual on Starter/)).toBeTruthy();
	});

	it("stops selling once an annual invoice is already waiting", () => {
		mockQueries({
			isAdmin: false,
			invoices: [
				...settled,
				{
					_id: "i4",
					status: "pending",
					currency: "MYR",
					billingCycle: "annual",
					total: 149000,
					invoiceNumber: "INV-4",
					dueDate: Date.now() + 10 * 24 * 60 * 60 * 1000,
				},
			],
		});
		render(<BillingTab retailer={activePro()} />);
		expect(screen.getByText("Your annual invoice is ready")).toBeTruthy();
		expect(screen.queryByText(/Pay for the year/)).toBeNull();
		expect(screen.queryByText("Ask for an annual invoice")).toBeNull();
	});

	it("defers the swap when the open invoice is nearly due", () => {
		// Voiding this close to the due date can land the seller in past_due —
		// the daily cron locks an active seller with no pending invoice.
		mockQueries({
			isAdmin: false,
			invoices: [
				...settled,
				{
					_id: "i5",
					status: "pending",
					currency: "MYR",
					billingCycle: "monthly",
					total: 14900,
					invoiceNumber: "INV-5",
					dueDate: Date.now() + 2 * 24 * 60 * 60 * 1000,
				},
			],
		});
		render(<BillingTab retailer={activePro()} />);
		expect(screen.getByText("Moving to annual billing")).toBeTruthy();
		expect(screen.getByText(/too soon to swap it safely/)).toBeTruthy();
		expect(screen.getByText("Ask for annual next cycle")).toBeTruthy();
		expect(screen.queryByText("Ask for an annual invoice")).toBeNull();
	});

	it("hides from Scale, which cannot be invoiced at all yet", () => {
		mockQueries({ isAdmin: false, invoices: settled });
		render(<BillingTab retailer={activePro({ plan: "scale" })} />);
		expect(screen.queryByText(/Pay for the year/)).toBeNull();
	});

});

/**
 * Invoice history documents (z8r3fdcrzj): a PAID row carries two — the frozen
 * bill and its payment receipt; a VOID row carries neither.
 */
describe("BillingTab invoice history documents", () => {
	const history = [
		{
			_id: "p1",
			status: "paid",
			currency: "MYR",
			total: 14900,
			invoiceNumber: "INV-PAID",
			createdAt: Date.UTC(2026, 7, 1),
		},
		{
			_id: "v1",
			status: "void",
			currency: "MYR",
			total: 14900,
			invoiceNumber: "INV-VOID",
			createdAt: Date.UTC(2026, 6, 1),
		},
	];

	it("offers invoice + receipt on a paid row, nothing on a void row", () => {
		mockQueries({ isAdmin: false, invoices: history });
		render(<BillingTab retailer={retailer()} />);
		expect(
			screen.getAllByRole("button", { name: /download invoice pdf/i }),
		).toHaveLength(1);
		expect(
			screen.getAllByRole("button", { name: /download receipt pdf/i }),
		).toHaveLength(1);
	});

	it("offers no receipt while the invoice is still pending", () => {
		mockQueries({
			isAdmin: false,
			invoices: [{ ...history[0], _id: "p2", status: "pending" as const }],
		});
		render(<BillingTab retailer={retailer()} />);
		expect(
			screen.queryByRole("button", { name: /download receipt pdf/i }),
		).toBeNull();
	});
});
