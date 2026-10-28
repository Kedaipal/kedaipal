// @vitest-environment jsdom
// Dispatch hub (86eyjpv6z, 3 Sep) — one provider card at a time when both are
// armed, plain fall-through otherwise, and the default follows the facts: a
// live booking's card always fronts.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { DispatchHub } from "./dispatch-hub";

const state = vi.hoisted(() => ({
	lalamove: undefined as unknown,
	delyva: undefined as unknown,
	easyparcel: undefined as unknown,
}));

// The hub only switches between the cards — their internals are covered by
// their own suites, so stub them to labelled markers.
vi.mock("./book-delivery-card", () => ({
	// Exposes the courier hand-off the rider dialog uses when no rider
	// vehicle can carry the order.
	BookDeliveryCard: (p: { onUseCourier?: () => void }) => (
		<div>
			LALAMOVE-CARD
			{p.onUseCourier ? (
				<button type="button" onClick={p.onUseCourier}>
					USE-COURIER
				</button>
			) : null}
		</div>
	),
}));
vi.mock("./delyva-dispatch-card", () => ({
	DelyvaDispatchCard: () => <div>DELYVA-CARD</div>,
}));
vi.mock("./easyparcel-dispatch-card", () => ({
	EasyparcelDispatchCard: () => <div>EASYPARCEL-CARD</div>,
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", async () => {
	const { getFunctionName: name } = await import("convex/server");
	return {
		useQuery: (opts: { fn: never }) => {
			const fn = name(opts.fn);
			if (fn === getFunctionName(api.lalamove.getDeliveryJob))
				return { data: state.lalamove };
			if (fn === getFunctionName(api.easyparcel.getDispatchState))
				return { data: state.easyparcel };
			return { data: state.delyva };
		},
	};
});

// A tab is only offered for a provider that RENDERS — which depends on the
// order's own status, so the fixture carries a bookable one.
const order = {
	_id: "o1",
	shortId: "ORD-1",
	deliveryMethod: "delivery",
	status: "confirmed",
} as unknown as Doc<"orders">;

const lalamove = (over: Record<string, unknown> = {}) => ({
	job: null,
	blockReason: null,
	bookingEnabled: true,
	riderOnlyStore: false,
	deliveryDirection: "standard",
	promptBookOnPacked: false,
	...over,
});
const delyva = (over: Record<string, unknown> = {}) => ({
	job: null,
	blockReason: null,
	bookingEnabled: true,
	defaultItemType: "PARCEL",
	computedWeightKg: 1,
	weightIssue: null,
	...over,
});
const easyparcel = (over: Record<string, unknown> = {}) => ({
	job: null,
	blockReason: null,
	bookingEnabled: true,
	isDemo: false,
	computedWeightKg: 1,
	weightIssue: null,
	...over,
});

beforeEach(() => {
	state.lalamove = lalamove();
	state.delyva = delyva();
	// The default fixture is a TWO-provider store (MY-shaped: Lalamove +
	// Delyva), so the suite's original scenarios keep their meaning; the
	// three-provider cases opt in below.
	state.easyparcel = undefined;
	window.localStorage.clear();
});
afterEach(() => cleanup());

describe("when both providers are armed", () => {
	it("shows the switch and exactly ONE card", () => {
		const { container } = render(<DispatchHub order={order} />);
		expect(screen.getByRole("tab", { name: /lalamove rider/i })).toBeTruthy();
		expect(screen.getByRole("tab", { name: /delyva courier/i })).toBeTruthy();
		const cards = ["LALAMOVE-CARD", "DELYVA-CARD"].filter((m) =>
			container.textContent?.includes(m),
		);
		expect(cards).toHaveLength(1);
	});

	it("switching tabs swaps the card and remembers the choice", () => {
		const { container } = render(<DispatchHub order={order} />);
		fireEvent.click(screen.getByRole("tab", { name: /lalamove rider/i }));
		expect(container.textContent).toContain("LALAMOVE-CARD");
		expect(container.textContent).not.toContain("DELYVA-CARD");
		expect(window.localStorage.getItem("kp:dispatch-provider")).toBe(
			"lalamove",
		);
	});

	it("a live LALAMOVE booking fronts its card regardless of preference", () => {
		window.localStorage.setItem("kp:dispatch-provider", "delyva");
		state.lalamove = lalamove({ job: { status: "ongoing" } });
		const { container } = render(<DispatchHub order={order} />);
		expect(container.textContent).toContain("LALAMOVE-CARD");
		// …and the tab wears the live-booking dot.
		expect(screen.getByLabelText(/has a live booking/i)).toBeTruthy();
	});

	it("a live DELYVA booking fronts its card the same way", () => {
		window.localStorage.setItem("kp:dispatch-provider", "lalamove");
		state.delyva = delyva({ job: { status: "picked_up" } });
		const { container } = render(<DispatchHub order={order} />);
		expect(container.textContent).toContain("DELYVA-CARD");
	});

	it("a live-quote (rider-only) store defaults to the rider card", () => {
		state.lalamove = lalamove({ riderOnlyStore: true });
		const { container } = render(<DispatchHub order={order} />);
		expect(container.textContent).toContain("LALAMOVE-CARD");
	});

	it("a terminal job doesn't force its card — preference wins", () => {
		window.localStorage.setItem("kp:dispatch-provider", "delyva");
		state.lalamove = lalamove({ job: { status: "completed" } });
		const { container } = render(<DispatchHub order={order} />);
		expect(container.textContent).toContain("DELYVA-CARD");
	});
});

describe("three providers armed (an SG store with riders + EasyParcel would be two; this is the registry ceiling)", () => {
	it("offers a three-column tab strip and still ONE card", () => {
		state.easyparcel = easyparcel();
		const { container } = render(<DispatchHub order={order} />);
		expect(
			screen.getByRole("tab", { name: /easyparcel courier/i }),
		).toBeTruthy();
		expect(screen.getByRole("tablist").className).toContain("grid-cols-3");
		const cards = ["LALAMOVE-CARD", "DELYVA-CARD", "EASYPARCEL-CARD"].filter(
			(m) => container.textContent?.includes(m),
		);
		expect(cards).toHaveLength(1);
	});

	it("a live EASYPARCEL booking fronts its card regardless of preference", () => {
		window.localStorage.setItem("kp:dispatch-provider", "lalamove");
		state.easyparcel = easyparcel({ job: { status: "picked_up" } });
		const { container } = render(<DispatchHub order={order} />);
		expect(container.textContent).toContain("EASYPARCEL-CARD");
	});

	it("fronting another tab while EasyParcel holds the slot shows the one-booking notice", () => {
		state.easyparcel = easyparcel({ job: { status: "assigning" } });
		render(<DispatchHub order={order} />);
		fireEvent.click(screen.getByRole("tab", { name: /delyva courier/i }));
		expect(screen.getByText(/one booking at a time/i)).toBeTruthy();
		expect(
			screen.getByRole("button", {
				name: /view the easyparcel courier booking/i,
			}),
		).toBeTruthy();
	});
});

describe("a tab is only offered for a provider that renders", () => {
	it("renders every component plainly — no tabs (each hides itself)", () => {
		state.delyva = delyva({ bookingEnabled: false });
		const { container } = render(<DispatchHub order={order} />);
		expect(screen.queryByRole("tab", { name: /lalamove/i })).toBeNull();
		// All markers present: the hub delegates visibility to the cards.
		expect(container.textContent).toContain("LALAMOVE-CARD");
		expect(container.textContent).toContain("DELYVA-CARD");
		expect(container.textContent).toContain("EASYPARCEL-CARD");
	});

	it("a disabled provider with a lingering JOB still gets its tab", () => {
		state.delyva = delyva({
			bookingEnabled: false,
			job: { status: "completed" },
		});
		render(<DispatchHub order={order} />);
		expect(screen.getByRole("tab", { name: /delyva courier/i })).toBeTruthy();
	});

	// Zaki's blank pane, 2 Sep: a DELIVERED order carrying a cancelled Delyva
	// booking. Delyva has history to show; Lalamove has no job and a delivered
	// order can't be booked, so its card returns null — and the hub used to
	// offer the tab anyway, opening onto nothing.
	it("no tabs on a closed order where only one provider has history", () => {
		const delivered = { ...order, status: "delivered" } as Doc<"orders">;
		state.delyva = delyva({
			job: { status: "canceled" },
			blockReason: "bad_status",
		});
		const { container } = render(<DispatchHub order={delivered} />);
		expect(screen.queryByRole("tab", { name: /lalamove rider/i })).toBeNull();
		expect(container.textContent).toContain("DELYVA-CARD");
	});

	it("…and no tabs when neither provider can act on a closed order", () => {
		const delivered = { ...order, status: "delivered" } as Doc<"orders">;
		const { container } = render(<DispatchHub order={delivered} />);
		expect(screen.queryByRole("tablist")).toBeNull();
		// The cards are still mounted — each renders its own nothing.
		expect(container.textContent).toContain("LALAMOVE-CARD");
	});

	it("the Lalamove set-up hint stays out when another courier can book (test-code F8)", () => {
		// An SG store with EasyParcel live and Lalamove never set up: the hint
		// would be a two-hop detour above the courier that works.
		state.lalamove = lalamove({
			bookingEnabled: false,
			blockReason: "booking_disabled",
		});
		const { container } = render(<DispatchHub order={order} />);
		expect(container.textContent).not.toContain("LALAMOVE-CARD");
		expect(container.textContent).toContain("DELYVA-CARD");
	});

	it("…but a store that books nothing still gets the Lalamove hint", () => {
		state.lalamove = lalamove({
			bookingEnabled: false,
			blockReason: "booking_disabled",
		});
		state.delyva = delyva({ bookingEnabled: false });
		const { container } = render(<DispatchHub order={order} />);
		expect(container.textContent).toContain("LALAMOVE-CARD");
	});

	it("a bare discoverability hint never earns a tab", () => {
		// Never-set-up Lalamove renders a dashed one-liner, not a card — a
		// tab strip around it would read as a broken provider.
		state.lalamove = lalamove({
			bookingEnabled: false,
			blockReason: "booking_disabled",
		});
		render(<DispatchHub order={order} />);
		expect(screen.queryByRole("tablist")).toBeNull();
	});
});

describe("the switch is grouped with the card it drives", () => {
	it("wraps tabs and pane in ONE bordered shell, and the card drops its own", () => {
		const { container } = render(<DispatchHub order={order} />);
		const shell = container.querySelector("section");
		expect(shell?.className).toContain("border");
		expect(shell?.className).toContain("rounded-2xl");
		// The tablist is inside that shell, not floating above it.
		expect(shell?.querySelector('[role="tablist"]')).toBeTruthy();
	});
});

describe("the other provider holds the booking", () => {
	// One booking per order (cross-provider reservation) — fronting the OTHER
	// tab while one provider holds a live job must say so, never render an
	// empty pane (the cards null themselves out under job_active).
	it("Lalamove tab shows the Delyva-holds-it notice, not an empty pane", () => {
		state.delyva = delyva({ job: { status: "picked_up" } });
		const { container } = render(<DispatchHub order={order} />);
		fireEvent.click(screen.getByRole("tab", { name: /lalamove rider/i }));
		expect(container.textContent).not.toContain("LALAMOVE-CARD");
		expect(container.textContent).toContain("Delyva courier is");
		expect(container.textContent).toContain("one booking at a time");
	});

	it("the notice's view button jumps back to the booking's tab", () => {
		state.lalamove = lalamove({ job: { status: "ongoing" } });
		const { container } = render(<DispatchHub order={order} />);
		fireEvent.click(screen.getByRole("tab", { name: /delyva courier/i }));
		expect(container.textContent).not.toContain("DELYVA-CARD");
		fireEvent.click(
			screen.getByRole("button", { name: /view the lalamove rider booking/i }),
		);
		expect(container.textContent).toContain("LALAMOVE-CARD");
	});

	it("a terminal job frees both tabs — no notice", () => {
		state.delyva = delyva({ job: { status: "completed" } });
		const { container } = render(<DispatchHub order={order} />);
		fireEvent.click(screen.getByRole("tab", { name: /lalamove rider/i }));
		expect(container.textContent).toContain("LALAMOVE-CARD");
		expect(container.textContent).not.toContain("one booking at a time");
	});
});

describe("the rider dialog's courier hand-off (26 Oct 2026)", () => {
	it("switches the hub to the Delyva tab and remembers it", () => {
		window.localStorage.setItem("kp:dispatch-provider", "lalamove");
		const { container } = render(<DispatchHub order={order} />);
		expect(container.textContent).toContain("LALAMOVE-CARD");

		fireEvent.click(screen.getByRole("button", { name: "USE-COURIER" }));
		expect(container.textContent).toContain("DELYVA-CARD");
		expect(container.textContent).not.toContain("LALAMOVE-CARD");
		expect(window.localStorage.getItem("kp:dispatch-provider")).toBe("delyva");
	});

	it("is never offered when there is no courier tab to hand off to", () => {
		state.delyva = null;
		const { container } = render(<DispatchHub order={order} />);
		expect(container.textContent).toContain("LALAMOVE-CARD");
		expect(screen.queryByRole("button", { name: "USE-COURIER" })).toBeNull();
	});
});
