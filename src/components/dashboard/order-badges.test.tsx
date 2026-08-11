// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { todayMytMidnight } from "../../../convex/lib/fulfilmentDate";
import { FulfilmentDateBadge } from "./fulfilment-date-badge";
import { OrderContextBadge } from "./order-badges";

afterEach(cleanup);

const NOW = 1_770_000_000_000;
const DAY = 86_400_000;
// A due date two MYT days in the past → "Overdue" when urgency is shown.
const OVERDUE = todayMytMidnight(NOW) - 2 * DAY;

describe("FulfilmentDateBadge — muted", () => {
	it("shows the red 'Overdue' urgency by default", () => {
		render(<FulfilmentDateBadge epoch={OVERDUE} now={NOW} />);
		const el = screen.getByText(/Overdue/);
		expect(el.className).toMatch(/red/);
	});

	it("muted drops the urgency label + colour, keeping a plain neutral date", () => {
		render(<FulfilmentDateBadge epoch={OVERDUE} now={NOW} muted />);
		expect(screen.queryByText(/Overdue/)).toBeNull();
		// The date still renders, but in neutral (muted) chrome — no red/orange/amber.
		const el = screen.getByText(/\d/);
		expect(el.className).not.toMatch(/red|orange|amber/);
		expect(el.className).toMatch(/muted/);
	});
});

describe("OrderContextBadge — fulfilment date gating", () => {
	function base(overrides = {}) {
		return { status: "confirmed", createdAt: NOW, ...overrides };
	}

	it("shows the urgency badge for an open storefront order", () => {
		render(
			<OrderContextBadge
				order={base({ source: "storefront", fulfilmentDate: OVERDUE })}
				now={NOW}
			/>,
		);
		expect(screen.getByText(/Overdue/).className).toMatch(/red/);
	});

	it("legacy order (no source) still behaves as storefront", () => {
		render(
			<OrderContextBadge order={base({ fulfilmentDate: OVERDUE })} now={NOW} />,
		);
		expect(screen.getByText(/Overdue/)).toBeTruthy();
	});

	it("terminal (delivered) order never shows urgency — neutral date only", () => {
		render(
			<OrderContextBadge
				order={base({ status: "delivered", fulfilmentDate: OVERDUE })}
				now={NOW}
			/>,
		);
		expect(screen.queryByText(/Overdue/)).toBeNull();
		expect(screen.getByText(/\d/).className).not.toMatch(/red|orange|amber/);
	});

	it("counter order shows NO fulfilment-date badge at all", () => {
		const { container } = render(
			<OrderContextBadge
				order={base({ source: "counter", fulfilmentDate: OVERDUE })}
				now={NOW}
			/>,
		);
		expect(screen.queryByText(/Overdue/)).toBeNull();
		// The confirmed counter order isn't escalated → the whole badge is empty.
		expect(container.textContent).toBe("");
	});
});

describe("OrderContextBadge — collection orders (86eyg0n8e)", () => {
	function collection(overrides = {}) {
		return {
			status: "confirmed",
			createdAt: NOW,
			source: "storefront",
			fulfilmentDate: OVERDUE,
			deliveryDirection: "collection",
			...overrides,
		};
	}

	it("stays red before collection — the day passed and nothing has arrived", () => {
		render(<OrderContextBadge order={collection()} now={NOW} />);
		expect(screen.getByText(/Overdue/).className).toMatch(/red/);
	});

	it("goes neutral once the rider delivered the goods, even though the order never reaches `delivered`", () => {
		// The regression: a collection order's date is the COLLECTION day, and
		// the webhook deliberately never advances the order — so without the
		// collectedAt mute this reads red for the whole service window.
		render(
			<OrderContextBadge
				order={collection({ collectedAt: NOW - DAY })}
				now={NOW}
			/>,
		);
		expect(screen.queryByText(/Overdue/)).toBeNull();
		expect(screen.getByText(/\d/).className).not.toMatch(/red|orange|amber/);
	});

	it("a collected order still surfaces a blocking mockup — the mute is date-only", () => {
		render(
			<OrderContextBadge
				order={collection({ collectedAt: NOW - DAY, mockupStatus: "pending" })}
				now={NOW}
			/>,
		);
		expect(screen.getByText("Mockup pending")).toBeTruthy();
	});

	it("a standard order with the same stamp is unaffected (guard against over-reach)", () => {
		render(
			<OrderContextBadge
				order={collection({
					deliveryDirection: undefined,
					collectedAt: NOW - DAY,
				})}
				now={NOW}
			/>,
		);
		expect(screen.getByText(/Overdue/).className).toMatch(/red/);
	});
});
