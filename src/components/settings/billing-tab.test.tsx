// @vitest-environment jsdom
import { useQuery } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../convex/_generated/api";
import { DEFAULT_SUPPORT_WA_NUMBER } from "../../lib/contact";
import { formatShortDate } from "../../lib/format";
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
		_id: "r_openmarket",
		slug: "openmarket",
		country: "MY",
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
	gateway = GATEWAY_OFF,
}: {
	isAdmin: boolean;
	supportWa?: string | null;
	invoices?: unknown[];
	/** billingGatewayAvailable answer. Defaults to what the server returns with
	 * no HitPay credentials (rails off, list pricing); `null` = still loading. */
	gateway?: Gateway | null;
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

type Gateway = {
	payNow: boolean;
	autoRenew: boolean;
	methods: string[];
	currency: string;
	renewalCurrency: string;
	foundingPricing: boolean;
	foundingPricingLapsed: boolean;
	foundingBenefitsRevoked: boolean;
	foundingBenefitsEndAt?: number;
	nextRenewal: {
		kind: "plan" | "hold";
		plan: string;
		billingCycle: "monthly" | "annual";
		founding: boolean;
		currency: string;
		amount: number;
	} | null;
};

/** No HitPay credentials: every online rail off, a list-price MY store. */
const GATEWAY_OFF: Gateway = {
	payNow: false,
	autoRenew: false,
	methods: ["card", "touch_n_go"],
	currency: "MYR",
	renewalCurrency: "MYR",
	foundingPricing: false,
	foundingPricingLapsed: false,
	foundingBenefitsRevoked: false,
	nextRenewal: {
		kind: "plan",
		plan: "pro",
		billingCycle: "monthly",
		founding: false,
		currency: "MYR",
		amount: 14900,
	},
};

const GATEWAY_ON: Gateway = { ...GATEWAY_OFF, payNow: true, autoRenew: true };

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

	it("returning from HitPay holds the pay rails on a spinner — no double-pay window", () => {
		// Landing back with ?paid=return (or ?autorenew=return): the settle is a
		// beat behind the page load, and quick hands could pay the still-pending
		// invoice a second time. The section shows "Confirming…" instead.
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
		render(<BillingTab retailer={retailer()} billingReturn="paid" />);
		expect(screen.getByText("Confirming your payment…")).toBeTruthy();
		expect(screen.queryByText("Pay online now")).toBeNull();
		expect(screen.queryByText("How to pay")).toBeNull();
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
		expect(screen.getByText(/Subscribe to Pro/)).toBeTruthy();
		// ONE door (Zaki, 11 Sep): no explicit get-an-invoice path — an abandoned
		// authorisation still lands back on a pending invoice with Pay-now +
		// bank details, so the manual rail survives implicitly.
		expect(screen.queryByText(/Get an invoice instead/)).toBeNull();
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
			screen.getByText(/message us on WhatsApp and we'll send your invoice/i),
		).toBeTruthy();
		expect(screen.queryByText(/Subscribe to/)).toBeNull();
		expect(screen.queryByText("Auto-renewal")).toBeNull();
	});

	it("pre-subscription the auto-renewal card is HIDDEN — the picker is the one door", () => {
		mockQueries({ isAdmin: false, gateway: GATEWAY_ON });
		render(<BillingTab retailer={trialing()} />);
		expect(screen.queryByText("Auto-renewal")).toBeNull();
	});

	it("an ACTIVE manual subscriber gets the opt-in auto-renewal card", () => {
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
					},
				} as unknown as Partial<Retailer>)}
			/>,
		);
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
		expect(screen.getByText(/couldn't charge your Visa ·· 4242/)).toBeTruthy();
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
		expect(screen.queryByText(/Subscribe to/)).toBeNull();
	});
});

describe("BillingTab comp accounts (z8r3fdeub2)", () => {
	const DAY = 24 * 60 * 60 * 1000;
	const comped = (comp?: Record<string, unknown>) =>
		retailer({
			subscription: {
				plan: "pro",
				status: "active",
				comped: true,
				comp,
				caps: { orderCap: 1_000_000_000, userCap: 5, broadcastQuota: 500 },
				active: true,
				frozen: false,
			},
			ordersThisMonth: 350,
		} as unknown as Partial<Retailer>);

	it("a sponsored store sees who's sponsoring it, no limits — and nothing to buy, change, pause or cancel", () => {
		mockQueries({ isAdmin: false, gateway: GATEWAY_ON });
		render(
			<BillingTab
				retailer={comped({
					kind: "sponsor",
					label: "Sponsored by Maybank SME",
				})}
			/>,
		);
		expect(screen.getByText("Sponsored account")).toBeTruthy();
		expect(screen.getByText("No limits")).toBeTruthy();
		expect(screen.getByText("Sponsored by Maybank SME")).toBeTruthy();
		expect(screen.getByText(/no limits on orders/)).toBeTruthy();
		// A comp has no end date — nothing may suggest one.
		expect(screen.queryByText(/until|expires|ends/i)).toBeNull();
		// Not a plan: no tier, meter or any billing door.
		expect(screen.queryByText("Current plan")).toBeNull();
		expect(screen.queryByText("Orders this month")).toBeNull();
		expect(screen.queryByText("Change your plan")).toBeNull();
		expect(screen.queryByText(/Subscribe to/)).toBeNull();
		expect(screen.queryByText(/Off-Season Hold/)).toBeNull();
		expect(screen.queryByText("Auto-renewal")).toBeNull();
	});

	it("a comp with no label still reads as a sponsored account", () => {
		mockQueries({ isAdmin: false, gateway: GATEWAY_ON });
		render(<BillingTab retailer={comped({ kind: "partner" })} />);
		expect(screen.getByText("Sponsored account")).toBeTruthy();
		expect(screen.queryByText("Current plan")).toBeNull();
	});

	const ended = () =>
		retailer({
			subscription: {
				plan: "pro",
				status: "past_due",
				comped: false,
				compEnded: { at: Date.now() - DAY },
				caps: { orderCap: 200, userCap: 2, broadcastQuota: 100 },
				active: false,
				frozen: true,
			},
		} as unknown as Partial<Retailer>);

	it("once the comp ends: 'Expired', what still works, and CHOOSING a plan — never 'renew' or a hold offer", () => {
		mockQueries({ isAdmin: false, gateway: GATEWAY_ON });
		render(<BillingTab retailer={ended()} />);
		expect(screen.getByText("Sponsored access")).toBeTruthy();
		expect(
			screen.getByText(`Ended ${formatShortDate(Date.now() - DAY)}`),
		).toBeTruthy();
		expect(screen.getByText("Expired")).toBeTruthy();
		expect(screen.queryByText("Past due")).toBeNull();
		expect(screen.getByText(/buyers can still order/)).toBeTruthy();
		expect(screen.getByText("Ready to choose a plan?")).toBeTruthy();
		expect(screen.queryByText("Renew your subscription")).toBeNull();
		expect(screen.queryByText(/Rather pause than pay/)).toBeNull();
		// No plan, so no "included orders on your plan" meter either.
		expect(screen.queryByText("Orders this month")).toBeNull();
	});

	it("with a method still on file, the picker names the saved method and amount — never a HitPay page that won't appear", () => {
		// subscribeSelf charges a saved method at once (no redirect). A sponsored
		// store that had auto-renew before its comp lands here every time.
		mockQueries({ isAdmin: false, gateway: GATEWAY_ON });
		render(
			<BillingTab
				retailer={retailer({
					subscription: {
						plan: "pro",
						status: "past_due",
						comped: false,
						compEnded: { at: Date.now() - DAY },
						autoRenew: {
							method: "touch_n_go",
							methodLabel: "Touch 'n Go",
							failedAttempts: 0,
							failing: false,
						},
						caps: { orderCap: 200, userCap: 2, broadcastQuota: 100 },
						active: false,
						frozen: true,
					},
				} as unknown as Partial<Retailer>)}
			/>,
		);
		expect(
			screen.getByText(/we'll charge your saved Touch 'n Go/),
		).toBeTruthy();
		expect(
			screen.getByText(/We'll charge RM 149\.00 to your saved Touch 'n Go now/),
		).toBeTruthy();
		expect(screen.queryByText(/HitPay's secure page/)).toBeNull();
	});

	it("gateway off: the manual card asks them to choose a plan, not renew", () => {
		mockQueries({ isAdmin: false });
		render(<BillingTab retailer={ended()} />);
		expect(screen.getByText("Choose a plan to start working again")).toBeTruthy();
		expect(screen.queryByText("Renew your subscription")).toBeNull();
		expect(waLinks().some((href) => href.includes("choose%20a%20plan"))).toBe(
			true,
		);
	});
});

describe("BillingTab — the lapsed-but-not-yet-renewed window (86eyb6z4r)", () => {
	const lapsed = (over: Record<string, unknown> = {}) =>
		retailer({
			subscription: {
				plan: "pro",
				status: "active",
				comped: false,
				billingCycle: "monthly",
				// Paid period ran out yesterday; the cron has not issued the
				// renewal yet. Access stays on, so status is still "active".
				currentPeriodEnd: Date.now() - 24 * 60 * 60 * 1000,
				caps: { orderCap: 500, userCap: 3, broadcastQuota: 0 },
				active: true,
				frozen: false,
				...over,
			},
		} as unknown as Partial<Retailer>);

	it("says renewing instead of naming an expiry date that has gone by", () => {
		mockQueries({ isAdmin: false, gateway: GATEWAY_ON });
		render(<BillingTab retailer={lapsed()} />);
		expect(screen.getByText("Active · renewing")).toBeTruthy();
		expect(screen.queryByText(/expires/)).toBeNull();
	});

	it("still names the expiry while the period is actually running", () => {
		mockQueries({ isAdmin: false, gateway: GATEWAY_ON });
		render(
			<BillingTab
				retailer={lapsed({
					currentPeriodEnd: Date.now() + 10 * 24 * 60 * 60 * 1000,
				})}
			/>,
		);
		expect(screen.getByText(/Active · expires/)).toBeTruthy();
		expect(screen.queryByText("Active · renewing")).toBeNull();
	});

	it("the auto-renewal line says the charge is happening, not that it is due in the past", () => {
		mockQueries({ isAdmin: false, gateway: GATEWAY_ON });
		render(
			<BillingTab
				retailer={lapsed({
					autoRenew: {
						method: "touch_n_go",
						methodLabel: "Touch 'n Go",
						failedAttempts: 0,
						failing: false,
						nextChargeAt: Date.now() - 24 * 60 * 60 * 1000,
					},
				})}
			/>,
		);
		expect(screen.getByText(/Renewing now/)).toBeTruthy();
		expect(screen.queryByText(/Next charge on/)).toBeNull();
	});

	it("a declined charge still outranks it — that message names the problem", () => {
		mockQueries({ isAdmin: false, gateway: GATEWAY_ON });
		render(
			<BillingTab
				retailer={lapsed({
					autoRenew: {
						method: "touch_n_go",
						methodLabel: "Touch 'n Go",
						failedAttempts: 1,
						failing: true,
						nextChargeAt: Date.now() - 24 * 60 * 60 * 1000,
					},
				})}
			/>,
		);
		expect(
			screen.getByText(/We couldn't charge your Touch 'n Go/),
		).toBeTruthy();
		expect(screen.queryByText(/Renewing now/)).toBeNull();
	});
});

/**
 * WHO gets offered a tier change (86eyb6z4r). The card's own copy is covered in
 * plan-change-card.test.tsx; this pins the gate, which has to agree with the
 * server guards on `invoices.changePlan` exactly — an offered control that the
 * server would refuse is a wrong-but-enabled button.
 */
describe("BillingTab plan change gating (86eyb6z4r)", () => {
	const seller = (over: Record<string, unknown> = {}) =>
		retailer({
			subscription: {
				plan: "pro",
				status: "active",
				comped: false,
				billingCycle: "monthly",
				currentPeriodEnd: Date.now() + 12 * 24 * 60 * 60 * 1000,
				caps: { orderCap: 500, userCap: 3, broadcastQuota: 0 },
				active: true,
				frozen: false,
				...over,
			},
		} as unknown as Partial<Retailer>);

	it("an ACTIVE paying seller is offered the other tier", () => {
		mockQueries({ isAdmin: false, gateway: GATEWAY_ON });
		render(<BillingTab retailer={seller()} />);
		expect(screen.getByText("Change your plan")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: /Move down to Starter/ }),
		).toBeTruthy();
	});

	it("hides while TRIALING — choosing a plan is the picker's job", () => {
		mockQueries({ isAdmin: false, gateway: GATEWAY_ON });
		render(
			<BillingTab
				retailer={seller({
					status: "trialing",
					trialEndsAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
				})}
			/>,
		);
		expect(screen.queryByText("Change your plan")).toBeNull();
	});

	it("hides while PAST DUE — the server refuses, so nothing is offered", () => {
		mockQueries({ isAdmin: false, gateway: GATEWAY_ON });
		render(<BillingTab retailer={seller({ status: "past_due" })} />);
		expect(screen.queryByText("Change your plan")).toBeNull();
	});

	it("hides from comped accounts and from an admin on their own store", () => {
		mockQueries({ isAdmin: false, gateway: GATEWAY_ON });
		render(<BillingTab retailer={seller({ comped: true })} />);
		expect(screen.queryByText("Change your plan")).toBeNull();
		cleanup();

		mockQueries({ isAdmin: true, gateway: GATEWAY_ON });
		render(<BillingTab retailer={seller()} />);
		expect(screen.queryByText("Change your plan")).toBeNull();
	});

	it("hides when the gateway is off — there is no way to pay the upgrade", () => {
		mockQueries({ isAdmin: false });
		render(<BillingTab retailer={seller()} />);
		expect(screen.queryByText("Change your plan")).toBeNull();
	});

	it("names the open invoice that is holding an upgrade back", () => {
		mockQueries({
			isAdmin: false,
			gateway: GATEWAY_ON,
			invoices: [
				{
					_id: "inv_open",
					status: "pending",
					invoiceNumber: "INV-202609-AB12",
					total: 7900,
					currency: "MYR",
					dueDate: Date.now() + 7 * 24 * 60 * 60 * 1000,
				},
			],
		});
		render(<BillingTab retailer={seller({ plan: "starter" })} />);
		const up = screen.getByRole("button", { name: /Move up to Pro/ });
		expect((up as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByText(/Moving up waits until invoice/)).toBeTruthy();
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
		{
			_id: "i1",
			status: "paid",
			currency: "MYR",
			total: 14900,
			invoiceNumber: "INV-1",
		},
		{
			_id: "i2",
			status: "paid",
			currency: "MYR",
			total: 14900,
			invoiceNumber: "INV-2",
		},
	];

	it("offers the year to a proven, active Pro seller", () => {
		mockQueries({ isAdmin: false, invoices: settled });
		render(<BillingTab retailer={activePro()} />);
		expect(
			screen.getByText(/Pay for the year, get 2 months free/),
		).toBeTruthy();
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
		expect(
			screen.getByText(/billed annually, with two months free/),
		).toBeTruthy();
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

	it("a spotlight target rings the history card, and only that card", () => {
		// `spotlightHref("invoice_history")` — the "Download a receipt" note.
		mockQueries({ isAdmin: false, invoices: history });
		const { container } = render(
			<BillingTab
				retailer={retailer()}
				target={{ anchor: "settings-invoice-history", highlight: "spotlight" }}
			/>,
		);
		const ringed = container.querySelectorAll("[data-fix-highlight]");
		expect(ringed).toHaveLength(1);
		expect(ringed[0]?.id).toBe("settings-invoice-history");
		expect(ringed[0]?.className).toMatch(/ring-accent/);
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

/**
 * Start-when-you-sell + Off-Season Hold (z8r3fday24). The rules live server-
 * side (convex/startWhenYouSell.test.ts, convex/seasonalHold.test.ts); these
 * cover that the tab tells the seller the truth about each state and offers
 * the right switch.
 */
describe("BillingTab — free period, first invoice, Off-Season Hold (z8r3fday24)", () => {
	const DAY = 24 * 60 * 60 * 1000;
	const paidPro = (overrides: Record<string, unknown> = {}) =>
		retailer({
			subscription: {
				plan: "pro",
				status: "active",
				comped: false,
				currentPeriodEnd: Date.now() + 20 * DAY,
				periodPaidBy: "plan",
				caps: { orderCap: 200, userCap: 2, broadcastQuota: 100 },
				features: { crm: true, orderInbox: true, chargeablePickup: true },
				active: true,
				frozen: false,
				held: false,
				...overrides,
			},
		} as never);

	it("a free store reads 'until your first order' and is told the invoice comes then", () => {
		mockQueries({ isAdmin: false });
		render(
			<BillingTab
				retailer={retailer({
					subscription: {
						plan: "pro",
						status: "trialing",
						comped: false,
						trialEndsAt: Date.now() + 12 * DAY,
						caps: { orderCap: 200, userCap: 2, broadcastQuota: 100 },
						active: true,
						frozen: false,
						held: false,
					},
				} as never)}
			/>,
		);
		expect(screen.getByText("Free · until your first order")).toBeTruthy();
		expect(
			screen.getByText(/free until your first live order, or day 15/),
		).toBeTruthy();
		// No hold card for a store that isn't paying yet.
		expect(screen.queryByText("Pause for the season")).toBeNull();
	});

	it("the first invoice card names itself and offers the Starter switch; an admin-issued invoice does not", () => {
		const first = {
			_id: "i_first",
			status: "pending",
			currency: "MYR",
			total: 14900,
			amount: 14900,
			plan: "pro",
			billingCycle: "monthly",
			origin: "free_period_end",
			invoiceNumber: "INV-FIRST",
			dueDate: Date.now() + 12 * DAY,
			createdAt: Date.now(),
		};
		mockQueries({ isAdmin: false, invoices: [first] });
		const ended = retailer({
			subscription: {
				plan: "pro",
				status: "trialing",
				comped: false,
				trialEndsAt: Date.now() + 9 * DAY,
				freePeriodEndedAt: Date.now() - DAY,
				freePeriodEndReason: "first_order",
				caps: { orderCap: 200, userCap: 2, broadcastQuota: 100 },
				active: true,
				frozen: false,
				held: false,
			},
		} as never);
		const { unmount } = render(<BillingTab retailer={ended} />);
		expect(
			screen.getByText("Free period over · first invoice due"),
		).toBeTruthy();
		expect(screen.getByText("Your first invoice")).toBeTruthy();
		expect(screen.getByText("Switch to Starter")).toBeTruthy();
		// The consequence is stated where the tap is.
		expect(
			screen.getByText(/no customer database, order inbox or insights/),
		).toBeTruthy();
		unmount();

		mockQueries({ isAdmin: false, invoices: [{ ...first, origin: "admin" }] });
		render(<BillingTab retailer={ended} />);
		expect(screen.queryByText("Switch to Starter")).toBeNull();
	});

	it("a Starter invoice offers the switch back to Pro", () => {
		mockQueries({
			isAdmin: false,
			invoices: [
				{
					_id: "i_st",
					status: "pending",
					currency: "MYR",
					total: 7900,
					amount: 7900,
					plan: "starter",
					billingCycle: "monthly",
					origin: "self_serve",
					invoiceNumber: "INV-ST",
					dueDate: Date.now() + 10 * DAY,
					createdAt: Date.now(),
				},
			],
		});
		render(
			<BillingTab
				retailer={paidPro({
					status: "trialing",
					freePeriodEndedAt: Date.now(),
				})}
			/>,
		);
		expect(screen.getByText("Switch to Pro")).toBeTruthy();
	});

	it("a paid seller is offered the pause, with the price and when it starts billing", () => {
		mockQueries({ isAdmin: false });
		render(<BillingTab retailer={paidPro()} />);
		expect(screen.getByText("Off-Season Hold")).toBeTruthy();
		expect(screen.getByText("Pause for the season")).toBeTruthy();
		// The price is a header chip now — the headline fact, not mid-paragraph.
		expect(screen.getByText(/RM\s*19\.00\/month/)).toBeTruthy();
		// Paid through a future date → the hold bills after it, not today.
		expect(screen.getByText(/the hold starts billing after that/)).toBeTruthy();
	});

	it("a held seller sees the resume switch, what a resume bills, and the status chip", () => {
		mockQueries({ isAdmin: false });
		render(
			<BillingTab
				retailer={paidPro({
					status: "on_hold",
					held: true,
					heldAt: Date.now() - 3 * DAY,
					periodPaidBy: "hold",
					caps: { orderCap: 0, userCap: 2, broadcastQuota: 100 },
				})}
			/>,
		);
		expect(screen.getByText(/^On hold · since/)).toBeTruthy();
		expect(screen.getByText("Resume Pro")).toBeTruthy();
		expect(screen.getByText(/unused hold days aren't refunded/i)).toBeTruthy();
		// The cap meter is meaningless at cap 0 — hidden, not "0 / 0".
		expect(screen.queryByText("Orders this month")).toBeNull();
	});

	it("pause copy uses the SERVER billing rule — a hold-bought period or a pending plan invoice bills now, never 'after {date}'", () => {
		const DAY2 = 24 * 60 * 60 * 1000;
		// Resumed mid-hold-bought period: paid through a future date, but by the
		// HOLD — pausing again bills the hold immediately (the live-found bug).
		mockQueries({ isAdmin: false });
		const { unmount } = render(
			<BillingTab retailer={paidPro({ periodPaidBy: "hold" })} />,
		);
		expect(screen.queryByText(/the hold starts billing after that/)).toBeNull();
		expect(
			screen.getByText(/hold invoice \(RM\s*19\.00\) is issued right away/),
		).toBeTruthy();
		unmount();

		// Active with a pending PLAN invoice: pausing voids it and bills the hold
		// now — the copy must say both.
		mockQueries({
			isAdmin: false,
			invoices: [
				{
					_id: "i_pend",
					status: "pending",
					currency: "MYR",
					total: 14900,
					amount: 14900,
					plan: "pro",
					billingCycle: "monthly",
					origin: "self_serve",
					invoiceNumber: "INV-PEND",
					dueDate: Date.now() + 12 * DAY2,
					createdAt: Date.now(),
				},
			],
		});
		render(<BillingTab retailer={paidPro()} />);
		expect(
			screen.getByText(
				/unpaid Pro invoice is cancelled and your first hold invoice/,
			),
		).toBeTruthy();
		expect(screen.queryByText(/the hold starts billing after that/)).toBeNull();
	});

	it("a seller locked over the TIER invoice is offered 'pause instead'; comped and admins never see the card", () => {
		mockQueries({ isAdmin: false });
		const { unmount } = render(<BillingTab retailer={retailer()} />); // past_due fixture
		expect(screen.getByText("Rather pause than pay for Pro?")).toBeTruthy();
		expect(screen.getByText("Pause instead")).toBeTruthy();
		unmount();

		mockQueries({ isAdmin: false });
		const { unmount: u2 } = render(
			<BillingTab retailer={paidPro({ comped: true })} />,
		);
		expect(screen.queryByText("Pause for the season")).toBeNull();
		u2();

		mockQueries({ isAdmin: true });
		render(<BillingTab retailer={paidPro()} />);
		expect(screen.queryByText("Pause for the season")).toBeNull();
	});

	it("a hold invoice is labelled as the hold, not the tier", () => {
		mockQueries({
			isAdmin: false,
			invoices: [
				{
					_id: "i_hold",
					status: "pending",
					kind: "hold",
					currency: "MYR",
					total: 1900,
					amount: 1900,
					plan: "pro",
					billingCycle: "monthly",
					origin: "auto_renewal",
					invoiceNumber: "INV-HOLD",
					dueDate: Date.now() + 10 * DAY,
					createdAt: Date.now(),
				},
			],
		});
		render(
			<BillingTab
				retailer={paidPro({
					status: "on_hold",
					held: true,
					periodPaidBy: "hold",
				})}
			/>,
		);
		expect(screen.getByText(/Amount due · Off-Season Hold/)).toBeTruthy();
		expect(screen.queryByText("Switch to Starter")).toBeNull();
	});
});

/**
 * z8r3fdfty4 — Founding Members were quoted list price on this page. Every
 * price now comes from the server's founding flag and renewal quote, and the
 * founding plan lock (Zaki, 17 Sep 2026: Founding Members stay on Founding
 * Pro, monthly or yearly) is stated where a change would be offered. The
 * server half is pinned in convex/subscriptionPayments.test.ts.
 */
describe("BillingTab founding price — one server-resolved answer (z8r3fdfty4)", () => {
	const DAY = 24 * 60 * 60 * 1000;

	/** What billingGatewayAvailable answers for a store. */
	function gatewayFor({
		currency = "MYR",
		founding = false,
		lapsed = false,
		revoked = false,
		cycle = "monthly",
	}: {
		currency?: "MYR" | "SGD";
		founding?: boolean;
		lapsed?: boolean;
		revoked?: boolean;
		cycle?: "monthly" | "annual";
	} = {}): Gateway {
		const monthly = {
			MYR: founding ? 10400 : 14900,
			SGD: founding ? 4100 : 5900,
		}[currency];
		return {
			...GATEWAY_ON,
			methods: currency === "SGD" ? ["card"] : ["card", "touch_n_go"],
			currency,
			renewalCurrency: currency,
			foundingPricing: founding,
			foundingPricingLapsed: lapsed,
			foundingBenefitsRevoked: revoked,
			nextRenewal: {
				kind: "plan",
				plan: "pro",
				billingCycle: cycle,
				founding,
				currency,
				amount: cycle === "annual" ? monthly * 10 : monthly,
			},
		};
	}

	/** A Founding Member marked the v1 way — the rank flag on the retailer,
	 * `foundingIntent` never set — on an active Pro plan mid-period. */
	const activeFounder = (
		sub: Record<string, unknown> = {},
		store: Record<string, unknown> = {},
	) =>
		retailer({
			isFoundingMember: true,
			foundingMemberRank: 2,
			...store,
			subscription: {
				plan: "pro",
				status: "active",
				comped: false,
				billingCycle: "monthly",
				currentPeriodEnd: Date.now() + 12 * DAY,
				caps: { orderCap: 200, userCap: 2, broadcastQuota: 100 },
				active: true,
				frozen: false,
				...sub,
			},
		} as unknown as Partial<Retailer>);

	const cardOn = {
		method: "card",
		methodLabel: "Visa ·· 4242",
		failedAttempts: 0,
		failing: false,
		nextChargeAt: Date.now() + 12 * DAY,
	};

	it("renewing: a Founding Member is offered Founding Pro alone — RM104 in MY, S$41 in SG, yearly still on (the screenshot)", () => {
		mockQueries({ isAdmin: false, gateway: gatewayFor({ founding: true }) });
		const { unmount } = render(
			<BillingTab
				retailer={retailer({ isFoundingMember: true, foundingMemberRank: 2 })}
			/>,
		);
		expect(screen.getByText("Renew your subscription")).toBeTruthy();
		// No Starter for a Founding Member.
		expect(
			screen.queryByText("Storefront, orders + WhatsApp confirmations"),
		).toBeNull();
		expect(screen.getByText(/RM\s*104\.00\/month/)).toBeTruthy();
		expect(screen.queryByText(/149/)).toBeNull();
		expect(
			screen.getByRole("button", { name: "Subscribe to Founding Pro" }),
		).toBeTruthy();
		expect(
			screen.getByText(/As a Founding Member you stay on Founding Pro/),
		).toBeTruthy();
		expect(screen.getByText(/be charged/).textContent).toMatch(/RM\s*104\.00/);
		// Moving between monthly and yearly on the same tier is theirs to make.
		fireEvent.click(screen.getByRole("button", { name: /Yearly/ }));
		expect(screen.getByText(/RM\s*1,040\.00\/year/)).toBeTruthy();
		unmount();

		mockQueries({
			isAdmin: false,
			gateway: gatewayFor({ founding: true, currency: "SGD" }),
		});
		render(
			<BillingTab
				retailer={retailer({
					country: "SG",
					isFoundingMember: true,
					foundingMemberRank: 7,
				})}
			/>,
		);
		expect(screen.getByText(/S\$\s*41\.00\/month/)).toBeTruthy();
		expect(screen.queryByText(/RM\s*\d/)).toBeNull();
	});

	it("a list seller keeps both plans at list — RM79 / RM149, S$29 / S$59", () => {
		mockQueries({ isAdmin: false, gateway: gatewayFor() });
		const { unmount } = render(<BillingTab retailer={retailer()} />);
		expect(screen.getByText(/RM\s*79\.00\/month/)).toBeTruthy();
		expect(screen.getByText(/RM\s*149\.00\/month/)).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Subscribe to Pro" }),
		).toBeTruthy();
		expect(screen.queryByText(/Founding Pro/)).toBeNull();
		unmount();

		mockQueries({ isAdmin: false, gateway: gatewayFor({ currency: "SGD" }) });
		render(<BillingTab retailer={retailer({ country: "SG" })} />);
		expect(screen.getByText(/S\$\s*29\.00\/month/)).toBeTruthy();
		expect(screen.getByText(/S\$\s*59\.00\/month/)).toBeTruthy();
	});

	it("an active Founding Member: named Founding Pro, no plan change offered, auto-renewal names RM104", () => {
		mockQueries({ isAdmin: false, gateway: gatewayFor({ founding: true }) });
		render(<BillingTab retailer={activeFounder({ autoRenew: cardOn })} />);
		expect(
			screen.getByText("Current plan").nextElementSibling?.textContent,
		).toBe("Founding Pro");
		expect(screen.getByText("Your plan stays Founding Pro")).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: /Move (down|up) to/ }),
		).toBeNull();
		expect(screen.getByText(/Next charge of RM\s*104\.00 on/)).toBeTruthy();
		expect(screen.queryByText(/149/)).toBeNull();
		// Stopping renewal is the one thing they CAN do — and the dialog states
		// the founding clause before they confirm.
		fireEvent.click(
			screen.getByRole("button", { name: "Turn off auto-renewal" }),
		);
		expect(screen.getByRole("dialog").textContent).toContain(
			"As a Founding Member you keep your founding price as long as your subscription doesn't lapse for more than 3 months",
		);
	});

	it("a Singapore Founding Member's auto-renewal pitch names S$41 a month — or S$410 a year", () => {
		mockQueries({
			isAdmin: false,
			gateway: gatewayFor({ founding: true, currency: "SGD" }),
		});
		const { unmount } = render(
			<BillingTab retailer={activeFounder({}, { country: "SG" })} />,
		);
		expect(
			screen.getByText(/every renewal \(S\$\s*41\.00 a month\) charges itself/),
		).toBeTruthy();
		unmount();

		mockQueries({
			isAdmin: false,
			gateway: gatewayFor({ founding: true, currency: "SGD", cycle: "annual" }),
		});
		render(
			<BillingTab
				retailer={activeFounder({ billingCycle: "annual" }, { country: "SG" })}
			/>,
		);
		expect(
			screen.getByText(/every renewal \(S\$\s*410\.00 a year\) charges itself/),
		).toBeTruthy();
	});

	it("an unfinished auto-renewal setup names what renewals will charge — S$41 a month for a Singapore founder", () => {
		mockQueries({
			isAdmin: false,
			gateway: gatewayFor({ founding: true, currency: "SGD" }),
		});
		render(
			<BillingTab
				retailer={activeFounder(
					{ autoRenewSetupPending: true },
					{ country: "SG" },
				)}
			/>,
		);
		expect(
			screen.getByText(
				/finish it to switch renewals \(S\$\s*41\.00 a month\) to automatic/,
			),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Finish setting up" }),
		).toBeTruthy();
	});

	it("WHILE THE GATEWAY IS LOADING the ribbon makes no claim about the price", () => {
		// The retailer doc resolves before billingGatewayAvailable, so every flag
		// reads false for a moment. That used to fall through to the amber
		// "your 30% discount is locked in" — told to a REVOKED member on every
		// page load (~310ms on localhost; longer on mobile data). The rank is
		// known and always true, so the title stays; the claim waits.
		mockQueries({ isAdmin: false, gateway: null });
		render(
			<BillingTab
				retailer={retailer({ isFoundingMember: true, foundingMemberRank: 3 })}
			/>,
		);
		expect(screen.getByText("Founding Member #3 of 10")).toBeTruthy();
		expect(screen.queryByText(/discount is locked in/)).toBeNull();
		expect(screen.queryByText(/price ended/)).toBeNull();
		expect(screen.queryByText(/founding price ends/)).toBeNull();
	});

	it("a date already in the PAST never renders as a deadline to beat", () => {
		// The pass runs daily, so for up to a day after the window closes the
		// member is lapsed but not yet revoked. Rendering "founding price ends
		// <yesterday> — renew before then" would be a deadline nobody can meet.
		mockQueries({
			isAdmin: false,
			gateway: {
				...gatewayFor({ lapsed: true }),
				foundingBenefitsEndAt: Date.now() - 2 * 60 * 60 * 1000,
			},
		});
		render(
			<BillingTab
				retailer={retailer({ isFoundingMember: true, foundingMemberRank: 3 })}
			/>,
		);
		expect(screen.queryByText(/founding price ends/)).toBeNull();
		expect(screen.queryByText(/Renew below before then/)).toBeNull();
		// It says the true thing for that day instead.
		expect(
			screen.getByText(/founding\s+price lapsed after more than 3 months/),
		).toBeTruthy();
	});

	it("a REVOKED Founding Member: badge kept, the end is permanent, no renew-to-keep promise", () => {
		mockQueries({
			isAdmin: false,
			gateway: gatewayFor({ lapsed: true, revoked: true }),
		});
		render(
			<BillingTab
				retailer={retailer({ isFoundingMember: true, foundingMemberRank: 3 })}
			/>,
		);
		expect(
			screen.getByText(/Founding Member #3 of 10 · founding price ended/),
		).toBeTruthy();
		// The promise that survives revocation — in the agreement and in this copy.
		expect(
			screen.getByText(/rank and badge stay yours, permanently/),
		).toBeTruthy();
		expect(screen.queryByText(/discount is locked in/)).toBeNull();
		// Never tell a revoked member renewing brings the price back — it doesn't.
		expect(screen.queryByText(/Renew below before then/)).toBeNull();
		// Priced as an ordinary seller, both tiers offered again.
		expect(screen.getByText(/RM\s*79\.00\/month/)).toBeTruthy();
		expect(screen.getByText(/RM\s*149\.00\/month/)).toBeTruthy();
	});

	it("a lapsed Founding Member: rank kept, the lapse explained, list prices, and no promise the discount is locked in", () => {
		mockQueries({ isAdmin: false, gateway: gatewayFor({ lapsed: true }) });
		render(
			<BillingTab
				retailer={retailer({ isFoundingMember: true, foundingMemberRank: 3 })}
			/>,
		);
		expect(screen.getByText("Founding Member #3 of 10")).toBeTruthy();
		expect(
			screen.getByText(/Your rank and badge are yours for good/),
		).toBeTruthy();
		expect(screen.queryByText(/discount is locked in/)).toBeNull();
		expect(
			screen.getByText(/founding\s+price lapses after 3 months/),
		).toBeTruthy();
		// The founding price is revoked — an ordinary seller's choice again.
		expect(screen.getByText(/RM\s*79\.00\/month/)).toBeTruthy();
		expect(screen.getByText(/RM\s*149\.00\/month/)).toBeTruthy();
	});

	it("a Founding Member's first invoice never offers Starter; a Starter invoice's way back quotes their price", () => {
		const first = {
			_id: "i_first",
			status: "pending",
			currency: "MYR",
			total: 10400,
			amount: 14900,
			foundingDiscount: 4500,
			plan: "pro",
			billingCycle: "monthly",
			origin: "free_period_end",
			invoiceNumber: "INV-FIRST",
			dueDate: Date.now() + 12 * DAY,
			createdAt: Date.now(),
		};
		const ended = retailer({
			isFoundingMember: true,
			foundingMemberRank: 4,
			subscription: {
				plan: "pro",
				status: "trialing",
				comped: false,
				trialEndsAt: Date.now() + 9 * DAY,
				freePeriodEndedAt: Date.now() - DAY,
				caps: { orderCap: 200, userCap: 2, broadcastQuota: 100 },
				active: true,
				frozen: false,
			},
		} as unknown as Partial<Retailer>);
		mockQueries({
			isAdmin: false,
			invoices: [first],
			gateway: gatewayFor({ founding: true }),
		});
		const { unmount } = render(<BillingTab retailer={ended} />);
		expect(screen.getByText("Your first invoice")).toBeTruthy();
		expect(screen.queryByText("Switch to Starter")).toBeNull();
		unmount();

		// A Starter bill from before the lock: the switch back is Founding Pro.
		// It used to read the founding flag off THIS invoice — a Starter bill
		// never carries a discount — and quoted RM149.
		mockQueries({
			isAdmin: false,
			invoices: [
				{
					...first,
					plan: "starter",
					total: 7900,
					amount: 7900,
					foundingDiscount: undefined,
					origin: "self_serve",
				},
			],
			gateway: gatewayFor({ founding: true }),
		});
		render(<BillingTab retailer={ended} />);
		expect(screen.getByText("Switch to Pro")).toBeTruthy();
		expect(screen.getByText(/Switch back to Pro/).textContent).toMatch(
			/RM\s*104\.00/,
		);
	});

	it("the annual offer quotes the year from the SERVER's founding flag, not the rank flag", () => {
		const settled = [
			{
				_id: "i1",
				status: "paid",
				currency: "MYR",
				total: 10400,
				invoiceNumber: "INV-1",
			},
			{
				_id: "i2",
				status: "paid",
				currency: "MYR",
				total: 10400,
				invoiceNumber: "INV-2",
			},
		];
		mockQueries({
			isAdmin: false,
			invoices: settled,
			gateway: gatewayFor({ founding: true }),
		});
		const { unmount } = render(<BillingTab retailer={activeFounder()} />);
		expect(screen.getByText(/RM\s*1,040\.00/)).toBeTruthy();
		unmount();

		// Rank flag still set, but the server says the price no longer applies.
		mockQueries({
			isAdmin: false,
			invoices: settled,
			gateway: gatewayFor({ lapsed: true }),
		});
		render(<BillingTab retailer={activeFounder()} />);
		expect(screen.getByText(/RM\s*1,490\.00/)).toBeTruthy();
		expect(screen.queryByText(/RM\s*1,040\.00/)).toBeNull();
	});

	it("quotes nothing founding-sensitive before the server has answered", () => {
		const settled = [
			{
				_id: "i1",
				status: "paid",
				currency: "MYR",
				total: 10400,
				invoiceNumber: "INV-1",
			},
			{
				_id: "i2",
				status: "paid",
				currency: "MYR",
				total: 10400,
				invoiceNumber: "INV-2",
			},
		];
		mockQueries({ isAdmin: false, invoices: settled, gateway: null });
		render(<BillingTab retailer={activeFounder()} />);
		// A founding member must never see a list price flash in first.
		expect(screen.queryByText(/Pay for the year/)).toBeNull();
		expect(screen.queryByText(/RM\s*1,490\.00/)).toBeNull();
	});
});

/**
 * z8r3fdfty4 — the reported repro. Inside admin act-as the tab showed the
 * seller's plan but asked the server about the CALLER's store: the admin's own
 * founding status, currency and invoices. Reads now name the seller's store;
 * writes (which resolve the caller server-side, and which are the owner's
 * consent to give) are disabled with the reason.
 */
describe("BillingTab under admin act-as (z8r3fdfty4)", () => {
	const DAY = 24 * 60 * 60 * 1000;

	/** The args each call of `fn` was made with. */
	function argsFor(fn: FunctionReference<"query">): unknown[] {
		return vi
			.mocked(useQuery)
			.mock.calls.map(
				([opts]) =>
					opts as unknown as {
						__fn: FunctionReference<"query">;
						args: unknown;
					},
			)
			.filter((o) => getFunctionName(o.__fn) === getFunctionName(fn))
			.map((o) => o.args);
	}

	const foundingSg: Gateway = {
		...GATEWAY_ON,
		methods: ["card"],
		currency: "SGD",
		renewalCurrency: "SGD",
		foundingPricing: true,
		nextRenewal: {
			kind: "plan",
			plan: "pro",
			billingCycle: "monthly",
			founding: true,
			currency: "SGD",
			amount: 4100,
		},
	};

	it("reads the SELLER's invoices and prices by id — and the owner path is unchanged", () => {
		vi.mocked(useQuery).mockClear();
		mockQueries({ isAdmin: true, gateway: foundingSg });
		render(
			<BillingTab
				retailer={retailer({
					actingAsAdmin: true,
					country: "SG",
					isFoundingMember: true,
					foundingMemberRank: 7,
				})}
			/>,
		);
		expect(argsFor(api.invoices.myInvoices)).toContainEqual({
			retailerId: "r_openmarket",
		});
		expect(
			argsFor(api.subscriptionPayments.billingGatewayAvailable),
		).toContainEqual({ retailerId: "r_openmarket" });
		// …so the admin sees exactly what the seller sees.
		expect(screen.getByText(/S\$\s*41\.00\/month/)).toBeTruthy();
		cleanup();

		vi.mocked(useQuery).mockClear();
		mockQueries({ isAdmin: false });
		render(<BillingTab retailer={retailer()} />);
		const ownerArgs = [
			...argsFor(api.invoices.myInvoices),
			...argsFor(api.subscriptionPayments.billingGatewayAvailable),
		];
		expect(ownerArgs.length).toBeGreaterThan(0);
		for (const args of ownerArgs)
			expect((args as { retailerId?: string }).retailerId).toBeUndefined();
	});

	it("billing is view-only: a banner says why, and every billing control is disabled beside its reason (Zaki, 17 Sep 2026)", () => {
		const note = /View-only while you're acting as this store/;
		/** Only the always-on support card may still open WhatsApp. */
		const billingWaLinks = () =>
			waLinks().filter(
				(href) => !decodeURIComponent(href).includes("billing question"),
			);
		const disabled = (name: string | RegExp) =>
			(screen.getByRole("button", { name }) as HTMLButtonElement).disabled;

		// A — renewing (past due): Subscribe, and the "pause instead" way out.
		mockQueries({ isAdmin: true, gateway: foundingSg });
		const a = render(
			<BillingTab
				retailer={retailer({
					actingAsAdmin: true,
					storeName: "Her Moolah",
					country: "SG",
					isFoundingMember: true,
					foundingMemberRank: 7,
				})}
			/>,
		);
		expect(screen.getByText("View-only billing")).toBeTruthy();
		expect(screen.getByText(/You're acting as Her Moolah/)).toBeTruthy();
		expect(screen.getByText(/use Admin → Billing/)).toBeTruthy();
		expect(disabled("Subscribe to Founding Pro")).toBe(true);
		expect(disabled("Pause instead")).toBe(true);
		expect(screen.getAllByText(note).length).toBe(2);
		expect(billingWaLinks()).toEqual([]);
		a.unmount();

		// B — active list seller, auto-renewal on, an open invoice with a
		// Pay-now link, and the annual swap on offer.
		mockQueries({
			isAdmin: true,
			gateway: GATEWAY_ON,
			invoices: [
				{
					_id: "i1",
					status: "paid",
					currency: "MYR",
					total: 14900,
					invoiceNumber: "INV-1",
				},
				{
					_id: "i2",
					status: "paid",
					currency: "MYR",
					total: 14900,
					invoiceNumber: "INV-2",
				},
				{
					_id: "i3",
					status: "pending",
					currency: "MYR",
					total: 14900,
					invoiceNumber: "INV-3",
					billingCycle: "monthly",
					dueDate: Date.now() + 10 * DAY,
					gatewayPayment: { url: "https://pay.example/inv-3" },
				},
			],
		});
		const b = render(
			<BillingTab
				retailer={retailer({
					actingAsAdmin: true,
					storeName: "Open Market",
					subscription: {
						plan: "pro",
						status: "active",
						comped: false,
						billingCycle: "monthly",
						currentPeriodEnd: Date.now() + 12 * DAY,
						caps: { orderCap: 200, userCap: 2, broadcastQuota: 100 },
						active: true,
						frozen: false,
						autoRenew: {
							method: "card",
							methodLabel: "Visa ·· 4242",
							failedAttempts: 0,
							failing: false,
							nextChargeAt: Date.now() + 12 * DAY,
						},
					},
				} as unknown as Partial<Retailer>)}
			/>,
		);
		expect(disabled(/Move down to Starter/)).toBe(true);
		expect(disabled("Turn off auto-renewal")).toBe(true);
		expect(disabled("Pause for the season")).toBe(true);
		expect(disabled("Ask for an annual invoice")).toBe(true);
		expect(disabled(/Pay online now/)).toBe(true);
		expect(disabled(/I've paid — notify us/)).toBe(true);
		// Nothing still points at the checkout or messages us about the bill.
		expect(
			screen
				.queryAllByRole("link")
				.some((l) => (l.getAttribute("href") ?? "").includes("pay.example")),
		).toBe(false);
		expect(billingWaLinks()).toEqual([]);
		// Plan change, hold, annual, how-to-pay, auto-renewal: one reason each.
		expect(screen.getAllByText(note).length).toBe(5);
		// Viewing stays viewing: the invoice and its document are all there.
		expect(screen.getByText("INV-3")).toBeTruthy();
		b.unmount();

		// C — gateway off: the manual "message us to renew" card.
		mockQueries({ isAdmin: true });
		render(
			<BillingTab
				retailer={retailer({ actingAsAdmin: true, storeName: "Open Market" })}
			/>,
		);
		expect(disabled(/Message us/)).toBe(true);
		expect(billingWaLinks()).toEqual([]);
	});
});
