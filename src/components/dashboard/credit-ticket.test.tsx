// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreditBalanceView } from "../../../convex/credits";
import {
	type CreditStubInput,
	creditStub,
	STUB_DOTS,
} from "../../lib/credit-stub";
import { CreditTicket, CreditTicketPlaceholder } from "./credit-ticket";

/**
 * The always-on credits ticket (z8r3fdx34j, Zaki 31 Oct): the menu stub torn
 * down to its number, in the rail, the collapsed rail and the phone header.
 * Built from the real `creditStub`, so these pin the words AND the drawing.
 */

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		search,
		...props
	}: Record<string, unknown> & { to?: string; search?: unknown }) => (
		<a
			href={`${to}${search ? `?${new URLSearchParams(search as Record<string, string>)}` : ""}`}
			{...props}
		/>
	),
}));

afterEach(cleanup);

const bal = (o: Partial<CreditBalanceView> = {}): CreditBalanceView =>
	({
		plan: 254,
		purchased: 0,
		total: 254,
		periodKey: "2026-10",
		periodGrant: 200,
		regime: "monthly",
		nextGrant: 200,
		refreshesAt: Date.UTC(2026, 9, 31, 16),
		nextExpiry: null,
		exhaustedAt: null,
		sellerRefundsLeft: 3,
		customGrant: false,
		ordersThisPeriod: 0,
		lockExempt: null,
		ordersWaiting: 0,
		...o,
	}) as CreditBalanceView;
const stub = (o: Partial<CreditStubInput> = {}) =>
	creditStub({
		balance: bal(),
		ordersWaiting: 0,
		route: "topup",
		canAct: true,
		perDay: 0,
		topUpRefusal: null,
		topUpSold: true,
		sponsored: false,
		...o,
	});

const ticket = () => screen.getByTestId("credit-ticket");

describe("CreditTicket", () => {
	it("rail: the stub's headline and its row of dots, opening Billing", () => {
		render(<CreditTicket stub={stub()} variant="rail" />);
		const t = ticket();
		expect(t.getAttribute("href")).toBe("/app/settings?tab=billing");
		expect(t.getAttribute("aria-label")).toBe(
			"Kedaipal credits: 254 orders left. Open billing.",
		);
		expect(t.textContent).toContain("254 orders left");
		expect(t.querySelectorAll("i")).toHaveLength(STUB_DOTS);
		expect(t.className).toContain("kp-credit-ticket");
		// Healthy is plain ink: no stamp, no warning colour.
		expect(screen.queryByTestId("credit-ticket-stamp")).toBeNull();
		expect(t.className).toContain("text-foreground");
	});

	it("rail: the plan pill rides the top tear — beside the ticket's link, never inside it", () => {
		render(
			<CreditTicket
				stub={stub()}
				variant="rail"
				plan={<a href="/app/settings?tab=billing">Pro</a>}
			/>,
		);
		const plan = screen.getByTestId("credit-ticket-plan");
		expect(plan.textContent).toBe("Pro");
		// A link inside a link is invalid HTML and a broken tab order.
		expect(ticket().contains(plan)).toBe(false);
		expect(ticket().querySelector("a")).toBeNull();
	});

	it("low is amber AND stamped — the state never rests on colour alone", () => {
		render(
			<CreditTicket
				stub={stub({ balance: bal({ plan: 18, total: 18 }) })}
				variant="rail"
			/>,
		);
		expect(ticket().getAttribute("data-tone")).toBe("low");
		expect(ticket().className).toMatch(/text-amber-700/);
		const stamp = screen.getByTestId("credit-ticket-stamp");
		expect(stamp.textContent).toBe("Low");
		// The bottom tear, by the dots it describes — the top is the plan's.
		expect(stamp.className).toContain("-bottom-1");
	});

	it("orders waiting: red, stamped, every dot torn off", () => {
		render(
			<CreditTicket
				stub={stub({ balance: bal({ plan: -3, total: -3 }), ordersWaiting: 3 })}
				variant="rail"
			/>,
		);
		const t = ticket();
		expect(t.textContent).toContain("3 orders waiting");
		expect(t.className).toMatch(/text-red-600/);
		expect(screen.getByTestId("credit-ticket-stamp").textContent).toBe(
			"Waiting",
		);
		const filled = [...t.querySelectorAll("i")].filter((d) =>
			d.className.includes("bg-red-500"),
		);
		expect(filled).toHaveLength(0);
	});

	it("collapsed: the figure and the one word it counts, the sentence on hover", () => {
		render(
			<CreditTicket
				stub={stub({ balance: bal({ plan: 18, total: 18 }) })}
				variant="collapsed"
			/>,
		);
		const t = ticket();
		expect(t.textContent).toBe("18low");
		expect(t.getAttribute("title")).toBe("18 orders left");
		// 44px wide: the collapsed rail's tap target.
		expect(t.className).toContain("w-11");
	});

	it("phone: a ticket torn left and right, with a 44px tap area around it", () => {
		render(<CreditTicket stub={stub({ ordersWaiting: 2 })} variant="phone" />);
		const t = ticket();
		expect(t.textContent).toBe("2 waiting");
		expect(t.querySelector(".kp-credit-ticket-side")).not.toBeNull();
		expect(t.className).toContain("py-[13px]");
	});

	it("placeholder: the pill on an empty frame, no link and nothing for a reader to hear", () => {
		const { container } = render(
			<CreditTicketPlaceholder plan={<a href="/billing">Pro</a>} />,
		);
		expect(screen.getByTestId("credit-ticket-plan").textContent).toBe("Pro");
		expect(
			container.querySelector('.kp-credit-ticket[aria-hidden="true"]'),
		).not.toBeNull();
		expect(screen.queryByTestId("credit-ticket")).toBeNull();
	});

	it("an unmetered store gets no ticket — the menu still says 'On us'", () => {
		const { container } = render(
			<CreditTicket stub={stub({ balance: null })} variant="rail" />,
		);
		expect(container.innerHTML).toBe("");
	});
});
