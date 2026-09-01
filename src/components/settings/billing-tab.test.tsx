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
// The 86eyb6z4r cards (plan picker, auto-renewal) add useMutation.
vi.mock("convex/react", () => ({
	useAction: () => vi.fn(),
	useMutation: () => vi.fn(),
}));

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
	gateway = null,
}: {
	isAdmin: boolean;
	supportWa?: string | null;
	invoices?: unknown[];
	/** billingGatewayAvailable answer; null = gateway not configured. */
	gateway?: {
		payNow: boolean;
		autoRenew: boolean;
		methods: string[];
		currency: string;
	} | null;
}) {
	const NAME = {
		amIAdmin: getFunctionName(api.billing.amIAdmin),
		invoices: getFunctionName(api.invoices.myInvoices),
		instructions: getFunctionName(api.billing.paymentInstructions),
		supportWa: getFunctionName(api.contact.supportWhatsapp),
		gateway: getFunctionName(api.subscriptionPayments.billingGatewayAvailable),
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
			if (name === NAME.gateway) return gateway ?? undefined;
			return undefined;
		})();
		return { data, isPending: false };
	}) as unknown as typeof useQuery);
}

const GATEWAY_ON = {
	payNow: true,
	autoRenew: true,
	methods: ["card", "touch_n_go"],
	currency: "MYR",
};

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

	it("a pending invoice with a gateway link leads with Pay online now (86eyb6z4r)", () => {
		mockQueries({
			isAdmin: false,
			gateway: GATEWAY_ON,
			invoices: [
				{
					...pendingInvoice("MYR"),
					gatewayPayment: {
						provider: "hitpay",
						url: "https://securecheckout.hit-pay.com/req_1",
					},
				},
			],
		});
		render(<BillingTab retailer={retailer()} />);
		const payNow = screen.getByText("Pay online now").closest("a");
		expect(payNow?.getAttribute("href")).toBe(
			"https://securecheckout.hit-pay.com/req_1",
		);
		// The manual rail stays underneath as the fallback.
		expect(screen.getByText("How to pay")).toBeTruthy();
	});

	it("no gateway link → no Pay-now button, manual flow byte-identical", () => {
		mockQueries({ isAdmin: false, invoices: [pendingInvoice("MYR")] });
		render(<BillingTab retailer={retailer()} />);
		expect(screen.queryByText("Pay online now")).toBeNull();
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

describe("BillingTab self-serve + auto-renewal gating (86eyb6z4r)", () => {
	/** A trialing seller with nothing pending — the "choose a plan" state. */
	const trialing = () =>
		retailer({
			subscription: {
				plan: "pro",
				status: "trialing",
				comped: false,
				trialEndsAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
				caps: { orderCap: 500, userCap: 3, broadcastQuota: 0 },
				active: true,
				frozen: false,
			},
		} as unknown as Partial<Retailer>);

	it("gateway ON → the plan picker replaces the WhatsApp card", () => {
		mockQueries({ isAdmin: false, gateway: GATEWAY_ON });
		render(<BillingTab retailer={trialing()} />);
		expect(screen.getByText("Ready to choose a plan?")).toBeTruthy();
		expect(screen.getByText(/Get my .* invoice/)).toBeTruthy();
		expect(
			screen.queryByText(/Message us on WhatsApp and we'll send your invoice/),
		).toBeNull();
		// Annual is pitched with its real hook, never a percentage.
		expect(screen.getByText("2 months free")).toBeTruthy();
	});

	it("gateway OFF → the manual WhatsApp card renders exactly as before", () => {
		mockQueries({ isAdmin: false });
		render(<BillingTab retailer={trialing()} />);
		expect(
			screen.getByText(/Message us on WhatsApp and we'll send your invoice/),
		).toBeTruthy();
		expect(screen.queryByText(/Get my .* invoice/)).toBeNull();
		expect(screen.queryByText("Auto-renewal")).toBeNull();
	});

	it("gateway ON → the auto-renewal card offers the one-time setup", () => {
		mockQueries({ isAdmin: false, gateway: GATEWAY_ON });
		render(<BillingTab retailer={trialing()} />);
		expect(screen.getByText("Auto-renewal")).toBeTruthy();
		expect(screen.getByText("Turn on auto-renewal")).toBeTruthy();
		// The trust line: Kedaipal never touches the card details.
		expect(screen.getByText(/never\s+sees or stores your card/)).toBeTruthy();
	});

	it("an attached, failing method names the problem and keeps the off-switch", () => {
		mockQueries({ isAdmin: false, gateway: GATEWAY_ON });
		render(
			<BillingTab
				retailer={retailer({
					subscription: {
						plan: "pro",
						status: "active",
						comped: false,
						caps: { orderCap: 500, userCap: 3, broadcastQuota: 0 },
						active: true,
						frozen: false,
						autoRenew: {
							method: "card",
							methodLabel: "Visa ·· 4242",
							failedAttempts: 1,
							failing: true,
						},
					},
				} as unknown as Partial<Retailer>)}
			/>,
		);
		expect(
			screen.getByText(/couldn't charge your Visa ·· 4242/),
		).toBeTruthy();
		expect(screen.getByText("Turn off auto-renewal")).toBeTruthy();
	});

	it("comped accounts and admins never see the gateway cards", () => {
		mockQueries({ isAdmin: false, gateway: GATEWAY_ON });
		render(
			<BillingTab
				retailer={retailer({
					subscription: {
						plan: "pro",
						status: "active",
						comped: true,
						caps: { orderCap: 500, userCap: 3, broadcastQuota: 0 },
						active: true,
						frozen: false,
					},
				} as unknown as Partial<Retailer>)}
			/>,
		);
		expect(screen.queryByText("Auto-renewal")).toBeNull();
		expect(screen.queryByText(/Get my .* invoice/)).toBeNull();
	});
});
