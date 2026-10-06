// @vitest-environment jsdom
import { useQuery } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { type FunctionReference, getFunctionName } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../convex/_generated/api";
import type { CreditBalanceView } from "../../../convex/credits";
import {
	TOP_UP_VIEW_ONLY_MESSAGE,
	type TopUpRefusal,
	topUpRefusalMessage,
} from "../../../convex/lib/creditPurchases";
import { formatShortDate } from "../../lib/format";
import { CreditMeter } from "./credit-meter";

// Reads go via `useQuery(convexQuery(api.x, args)).data` — mock the adapter
// pair and answer by function name (see billing-tab.test.tsx).
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ __fn: fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		search,
		children,
		...props
	}: Record<string, unknown> & { children?: React.ReactNode }) => (
		<a
			href={`${String(to)}?${new URLSearchParams(search as Record<string, string>)}`}
			{...props}
		>
			{children}
		</a>
	),
}));
const viewer = {
	role: "owner" as "owner" | "member",
	canBuy: true,
};
vi.mock("../../hooks/usePermission", () => ({
	useStoreRole: () => viewer.role,
	usePermission: () => ({
		canRead: true,
		canWrite: viewer.canBuy,
		role: viewer.role,
	}),
}));

afterEach(() => {
	viewer.role = "owner";
	viewer.canBuy = true;
	cleanup();
});

const NOV_1 = Date.parse("2026-11-01T00:00:00+08:00");

function balance(over: Partial<CreditBalanceView> = {}): CreditBalanceView {
	return {
		plan: 120,
		purchased: 0,
		total: 120,
		periodKey: "2026-10",
		periodGrant: 200,
		regime: "monthly",
		nextGrant: 200,
		refreshesAt: NOV_1,
		nextExpiry: null,
		exhaustedAt: null,
		sellerRefundsLeft: 10,
		customGrant: false,
		ordersThisPeriod: 80,
		lockExempt: null,
		...over,
	};
}

type Retailer = Parameters<typeof CreditMeter>[0]["retailer"];

function retailer({
	status = "active",
	comped = false,
	plan = "pro",
	founding = false,
	locked = false,
	route = "topup",
	waiting = 0,
}: {
	status?: string;
	comped?: boolean;
	plan?: string;
	founding?: boolean;
	locked?: boolean;
	route?: string;
	waiting?: number;
} = {}): Retailer {
	return {
		_id: "r_1",
		slug: "kedai",
		isFoundingMember: founding,
		subscription: { plan, status, comped },
		creditLock: {
			locked,
			unlockRoute: route,
			since: locked ? Date.now() : null,
			ordersWaiting: waiting,
		},
	} as unknown as Retailer;
}

/** T2's `topUpOptions` answer — only the fields the meter reads. */
type TopUp = {
	available: boolean;
	refusal: TopUpRefusal | null;
	refusalMessage: string | null;
	viewOnly: "acting_as_admin" | "no_write" | null;
};
const CAN_BUY: TopUp = {
	available: true,
	refusal: null,
	refusalMessage: null,
	viewOnly: null,
};
/** The refusal exactly as the server words it for the owner. */
function refused(refusal: TopUpRefusal): TopUp {
	return {
		...CAN_BUY,
		refusal,
		refusalMessage: topUpRefusalMessage(refusal, { audience: "owner" }),
	};
}

function mockQueries({
	bal,
	topUp = CAN_BUY,
}: {
	/** `undefined` = still loading; `null` = no Credits grant. */
	bal: CreditBalanceView | null | undefined;
	topUp?: TopUp;
}) {
	const NAME = {
		balance: getFunctionName(api.credits.getBalance),
		topUp: getFunctionName(api.creditPurchases.topUpOptions),
		admin: getFunctionName(api.billing.amIAdmin),
	};
	vi.mocked(useQuery).mockImplementation(((opts: {
		__fn: FunctionReference<"query">;
	}) => {
		const name = getFunctionName(opts.__fn);
		const data =
			name === NAME.balance
				? bal
				: name === NAME.topUp
					? topUp
					: name === NAME.admin
						? false
						: undefined;
		return { data, isPending: false };
	}) as unknown as typeof useQuery);
}

describe("CreditMeter — Billing (full)", () => {
	it("loading shows a skeleton, not a zero", () => {
		mockQueries({ bal: undefined });
		const { container } = render(
			<CreditMeter variant="full" retailer={retailer()} />,
		);
		expect(screen.queryByTestId("credit-balance")).toBeNull();
		expect(
			container.querySelector('[data-slot="skeleton"], .animate-pulse'),
		).not.toBeNull();
	});

	it("a teammate without the Credits grant sees nothing at all", () => {
		mockQueries({ bal: null });
		const { container } = render(
			<CreditMeter variant="full" retailer={retailer()} />,
		);
		expect(container.textContent).toBe("");
	});

	it("an active store: the total, the TWO balances apart and in their order of use, the reset, the rules, and top-up", () => {
		mockQueries({ bal: balance({ purchased: 30, total: 150 }) });
		const { container } = render(
			<CreditMeter variant="full" retailer={retailer()} />,
		);
		expect(screen.getByTestId("credit-balance").textContent).toBe(
			"150 orders left",
		);
		// Monthly credits first, bought credits next — each its own tile.
		expect(screen.getByText("Monthly credits")).toBeTruthy();
		expect(screen.getByText("Used first")).toBeTruthy();
		expect(screen.getByText("Bought credits")).toBeTruthy();
		expect(screen.getByText("Used next")).toBeTruthy();
		expect(container.textContent).toContain("120 of 200");
		expect(screen.getByText("30")).toBeTruthy();
		expect(screen.getByText("Last 12 months from purchase")).toBeTruthy();
		// A RESET, not more on top (Zaki, 1 Oct 2026).
		expect(
			screen.getByText(`Back to 200 on ${formatShortDate(NOV_1)}`),
		).toBeTruthy();
		expect(container.textContent).not.toMatch(/more on/);
		// The rule, in plain words — no hidden behaviour.
		expect(
			screen.getByText(
				/Monthly credits are used first and reset on the 1st — they don't carry over\. Bought credits are used next and last 12 months/,
			),
		).toBeTruthy();
		const topUp = screen.getByRole("link", { name: "Top up credits" });
		expect(topUp.getAttribute("href")).toContain("topup=1");
	});

	it("no bought credits yet: the tile says packs last 12 months", () => {
		mockQueries({ bal: balance() });
		render(<CreditMeter variant="full" retailer={retailer()} />);
		expect(screen.getByText("None yet — packs last 12 months")).toBeTruthy();
	});

	it("owing orders: the reset says the debt comes off it", () => {
		mockQueries({ bal: balance({ plan: -15, total: -15 }) });
		render(
			<CreditMeter variant="full" retailer={retailer({ locked: true })} />,
		);
		expect(
			screen.getByText(
				`185 on ${formatShortDate(NOV_1)} — the 15 owed come off`,
			),
		).toBeTruthy();
	});

	it("amber in the last fifth, red at zero", () => {
		mockQueries({ bal: balance({ plan: 30, total: 30 }) });
		render(<CreditMeter variant="full" retailer={retailer()} />);
		expect(screen.getByTestId("credit-balance").className).toMatch(/amber/);
		cleanup();
		mockQueries({ bal: balance({ plan: 0, total: 0 }) });
		render(
			<CreditMeter variant="full" retailer={retailer({ locked: true })} />,
		);
		expect(screen.getByTestId("credit-balance").className).toMatch(/red/);
	});

	it("at zero: says what's paused", () => {
		mockQueries({ bal: balance({ plan: 0, total: 0 }) });
		render(
			<CreditMeter variant="full" retailer={retailer({ locked: true })} />,
		);
		expect(screen.getByTestId("credit-balance").textContent).toBe(
			"0 orders left",
		);
		expect(
			screen.getByText(
				"Accepting and updating orders and editing products are paused until you add credits.",
			),
		).toBeTruthy();
	});

	it("below zero: how far, and that it comes off the next pack or grant", () => {
		mockQueries({ bal: balance({ plan: -15, total: -15 }) });
		render(
			<CreditMeter variant="full" retailer={retailer({ locked: true })} />,
		);
		expect(screen.getByTestId("credit-balance").textContent).toBe(
			"15 orders owed",
		);
		expect(screen.getByText("15 owed")).toBeTruthy();
		expect(
			screen.getByText(
				/The 15 orders owed come off your next pack or your next monthly credits/,
			),
		).toBeTruthy();
	});

	it("trialing: 200 from the first order, pick a plan — and no top-up", () => {
		mockQueries({
			bal: balance({
				regime: "trial",
				nextGrant: null,
				refreshesAt: null,
				plan: 170,
				total: 170,
			}),
			topUp: refused("trialing"),
		});
		render(
			<CreditMeter
				variant="full"
				retailer={retailer({ status: "trialing" })}
			/>,
		);
		expect(
			screen.getByText(/Your free trial includes 200 orders/),
		).toBeTruthy();
		const topUp = screen.getByRole("button", { name: "Top up credits" });
		expect((topUp as HTMLButtonElement).disabled).toBe(true);
		// T2's own sentence — the meter and the pack picker never disagree.
		expect(
			screen.getByText(topUpRefusalMessage("trialing", { audience: "owner" })),
		).toBeTruthy();
	});

	it("past due with bought credits: they're kept, but only work once the plan is paid", () => {
		mockQueries({
			bal: balance({
				regime: "none",
				nextGrant: null,
				plan: 0,
				purchased: 150,
				total: 150,
			}),
			topUp: refused("past_due"),
		});
		render(
			<CreditMeter
				variant="full"
				retailer={retailer({ status: "past_due" })}
			/>,
		);
		expect(
			screen.getByText(
				"Pay your invoice and this month's credits land straight away. Your 150 bought credits are kept, and work again once your plan is active.",
			),
		).toBeTruthy();
		expect(screen.getByText("None granted this month")).toBeTruthy();
	});

	it("past due: pay the invoice, and top-up waits for it", () => {
		mockQueries({
			bal: balance({ regime: "none", nextGrant: null, plan: 4, total: 4 }),
			topUp: refused("past_due"),
		});
		render(
			<CreditMeter
				variant="full"
				retailer={retailer({ status: "past_due" })}
			/>,
		);
		expect(
			screen.getByText(
				"Pay your invoice and this month's credits land straight away.",
			),
		).toBeTruthy();
		expect(
			screen.getByText(topUpRefusalMessage("past_due", { audience: "owner" })),
		).toBeTruthy();
	});

	it("comped: metered, never locked, said so — and nothing to top up", () => {
		mockQueries({
			bal: balance({ lockExempt: "sponsored" }),
			topUp: refused("sponsored"),
		});
		render(
			<CreditMeter variant="full" retailer={retailer({ comped: true })} />,
		);
		expect(screen.getByText(/Sponsored stores are never locked/)).toBeTruthy();
		expect(screen.queryByText("Top up credits")).toBeNull();
		// One balance, so no order of use to explain.
		expect(screen.queryByText("Bought credits")).toBeNull();
		expect(screen.queryByText("Used first")).toBeNull();
	});

	it("an UNMETERED store renders nothing at all — no meter, no state line", () => {
		// z8r3fdp4er: a Kedaipal admin's own store has no credit regime, so
		// `getBalance` answers null and both variants disappear. The null is
		// the whole mechanism — one read, every surface follows it.
		mockQueries({ bal: null });
		const { container } = render(
			<CreditMeter variant="full" retailer={retailer({ status: "past_due" })} />,
		);
		expect(container.textContent).toBe("");
		const card = render(
			<CreditMeter variant="card" retailer={retailer({ status: "past_due" })} />,
		);
		expect(card.container.textContent).toBe("");
	});

	it("a Founding Member on Pro wears the 300 badge", () => {
		mockQueries({ bal: balance({ periodGrant: 300, nextGrant: 300 }) });
		render(
			<CreditMeter variant="full" retailer={retailer({ founding: true })} />,
		);
		expect(screen.getByText("Founding · 300 a month")).toBeTruthy();
	});

	it("a custom allowance is named, and no founding badge claims it", () => {
		mockQueries({
			bal: balance({ customGrant: true, nextGrant: 150, periodGrant: 150 }),
		});
		render(
			<CreditMeter variant="full" retailer={retailer({ founding: true })} />,
		);
		expect(
			screen.getByText(
				"Your store has a custom allowance of 150 orders a month.",
			),
		).toBeTruthy();
		expect(screen.queryByText(/Founding · 300/)).toBeNull();
	});

	it("bought credits expiring within 30 days get a heads-up", () => {
		const at = Date.now() + 10 * 24 * 60 * 60 * 1000;
		mockQueries({
			bal: balance({
				purchased: 20,
				total: 140,
				nextExpiry: { credits: 20, at },
			}),
		});
		render(<CreditMeter variant="full" retailer={retailer()} />);
		expect(
			screen.getByText(`20 bought credits expire on ${formatShortDate(at)}.`, {
				exact: false,
			}),
		).toBeTruthy();
	});

	it("a far-off expiry stays quiet", () => {
		const at = Date.now() + 90 * 24 * 60 * 60 * 1000;
		mockQueries({
			bal: balance({
				purchased: 20,
				total: 140,
				nextExpiry: { credits: 20, at },
			}),
		});
		render(<CreditMeter variant="full" retailer={retailer()} />);
		expect(screen.queryByText(/expire on/)).toBeNull();
	});

	it("a teammate who can see credits but not buy them is told who can", () => {
		viewer.role = "member";
		viewer.canBuy = false;
		mockQueries({
			bal: balance(),
			topUp: { ...CAN_BUY, viewOnly: "no_write" },
		});
		render(<CreditMeter variant="full" retailer={retailer()} />);
		expect(
			(
				screen.getByRole("button", {
					name: "Top up credits",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		expect(screen.getByText(/ask the owner for edit access/)).toBeTruthy();
	});

	it("a teammate holding Credits write buys packs themselves", () => {
		viewer.role = "member";
		viewer.canBuy = true;
		mockQueries({ bal: balance() });
		render(<CreditMeter variant="full" retailer={retailer()} />);
		expect(screen.getByRole("link", { name: "Top up credits" })).toBeTruthy();
	});

	it("admin act-as: view-only, said with T2's sentence", () => {
		mockQueries({
			bal: balance(),
			topUp: { ...CAN_BUY, viewOnly: "acting_as_admin" },
		});
		render(<CreditMeter variant="full" retailer={retailer()} />);
		expect(
			(
				screen.getByRole("button", {
					name: "Top up credits",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		expect(screen.getByText(TOP_UP_VIEW_ONLY_MESSAGE)).toBeTruthy();
	});

	it("no top-up where packs aren't sold", () => {
		mockQueries({ bal: balance(), topUp: { ...CAN_BUY, available: false } });
		render(<CreditMeter variant="full" retailer={retailer()} />);
		expect(screen.queryByText("Top up credits")).toBeNull();
	});
});

describe("CreditMeter — dashboard home (card)", () => {
	it("a quick look — both balances in one line — with a way into Billing", () => {
		mockQueries({ bal: balance({ purchased: 25, total: 145 }) });
		render(<CreditMeter variant="card" retailer={retailer()} />);
		expect(screen.getByTestId("credit-balance").textContent).toBe(
			"145 orders left",
		);
		expect(screen.getByText("120 of 200 monthly · 25 bought")).toBeTruthy();
		expect(
			screen.getByText(`Back to 200 on ${formatShortDate(NOV_1)}`),
		).toBeTruthy();
		expect(screen.getByRole("link", { name: "Billing" })).toBeTruthy();
		// Not running low: no push to buy.
		expect(screen.queryByRole("link", { name: /Top up/ })).toBeNull();
	});

	it("running low (the last 20%): the card offers the top-up itself", () => {
		mockQueries({ bal: balance({ plan: 40, total: 40 }) });
		render(<CreditMeter variant="card" retailer={retailer()} />);
		const topUp = screen.getByRole("link", { name: "Top up credits" });
		expect(topUp.getAttribute("href")).toContain("topup=1");
	});

	it("running low but not this reader's to buy: no top-up button", () => {
		mockQueries({
			bal: balance({ plan: 40, total: 40 }),
			topUp: { ...CAN_BUY, viewOnly: "acting_as_admin" },
		});
		render(<CreditMeter variant="card" retailer={retailer()} />);
		expect(screen.queryByRole("link", { name: /Top up/ })).toBeNull();
	});

	it("locked: the one way back, by route", () => {
		mockQueries({ bal: balance({ plan: 0, total: 0 }) });
		render(
			<CreditMeter
				variant="card"
				retailer={retailer({
					locked: true,
					route: "pick_plan",
					status: "trialing",
				})}
			/>,
		);
		expect(
			screen.getByText(
				"Paused: accepting and updating orders, editing products.",
			),
		).toBeTruthy();
		expect(screen.getByRole("link", { name: "Pick a plan" })).toBeTruthy();
	});

	it("locked, for a teammate holding Credits write: the top-up is theirs to take", () => {
		viewer.role = "member";
		viewer.canBuy = true;
		mockQueries({ bal: balance({ plan: 0, total: 0 }) });
		render(
			<CreditMeter variant="card" retailer={retailer({ locked: true })} />,
		);
		expect(screen.getByRole("link", { name: "Top up credits" })).toBeTruthy();
	});

	it("locked, for a teammate who can't buy: no button that isn't theirs", () => {
		viewer.role = "member";
		viewer.canBuy = false;
		mockQueries({ bal: balance({ plan: 0, total: 0 }) });
		render(
			<CreditMeter variant="card" retailer={retailer({ locked: true })} />,
		);
		expect(screen.queryByRole("link", { name: "Top up credits" })).toBeNull();
		expect(screen.getByRole("link", { name: "Billing" })).toBeTruthy();
	});
});

describe("the card's one button, with the seller lock switched off", () => {
	// `creditTone` returns "out" (not "low") at a balance of zero or below, and
	// the locked branch — which used to cover that state — is unreachable while
	// CREDIT_LOCK_ENABLED is false. Gating the top-up on "low" alone therefore
	// left a store IN DEBT with no action button while a store merely running
	// low got one: the urgency ladder upside down.
	it("offers Top up at a debt balance, not only when running low", () => {
		mockQueries({ bal: balance({ plan: -15, total: -15 }) });
		render(<CreditMeter variant="card" retailer={retailer()} />);
		expect(screen.getByRole("link", { name: "Top up credits" })).toBeTruthy();
		cleanup();

		mockQueries({ bal: balance({ plan: 30, total: 30 }) });
		render(<CreditMeter variant="card" retailer={retailer()} />);
		expect(screen.getByRole("link", { name: "Top up credits" })).toBeTruthy();
	});

	it("still offers nothing when the server refuses the top-up", () => {
		// The widened tone must not widen WHO may buy — `canTopUp` is T2's own
		// answer (`topUpOptions`), and a debt balance doesn't override it.
		mockQueries({
			bal: balance({ plan: -15, total: -15 }),
			topUp: refused("past_due"),
		});
		render(<CreditMeter variant="card" retailer={retailer()} />);
		expect(screen.queryByRole("link", { name: "Top up credits" })).toBeNull();
	});
});
