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
}));

// The hub only switches between the two cards — their internals are covered
// by their own suites, so stub them to labelled markers.
vi.mock("./book-delivery-card", () => ({
	BookDeliveryCard: () => <div>LALAMOVE-CARD</div>,
}));
vi.mock("./delyva-dispatch-card", () => ({
	DelyvaDispatchCard: () => <div>DELYVA-CARD</div>,
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", async () => {
	const { getFunctionName: name } = await import("convex/server");
	return {
		useQuery: (opts: { fn: never }) =>
			name(opts.fn) === getFunctionName(api.lalamove.getDeliveryJob)
				? { data: state.lalamove }
				: { data: state.delyva },
	};
});

const order = { _id: "o1", shortId: "ORD-1", deliveryMethod: "delivery" } as unknown as Doc<"orders">;

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

beforeEach(() => {
	state.lalamove = lalamove();
	state.delyva = delyva();
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
		expect(window.localStorage.getItem("kp:dispatch-provider")).toBe("lalamove");
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

describe("when only one provider is relevant", () => {
	it("renders both components plainly — no tabs (each hides itself)", () => {
		state.delyva = delyva({ bookingEnabled: false });
		const { container } = render(<DispatchHub order={order} />);
		expect(screen.queryByRole("tab", { name: /lalamove/i })).toBeNull();
		// Both markers present: the hub delegates visibility to the cards.
		expect(container.textContent).toContain("LALAMOVE-CARD");
		expect(container.textContent).toContain("DELYVA-CARD");
	});

	it("a disabled provider with a lingering JOB still counts as relevant", () => {
		state.delyva = delyva({ bookingEnabled: false, job: { status: "completed" } });
		render(<DispatchHub order={order} />);
		expect(screen.getByRole("tab", { name: /delyva courier/i })).toBeTruthy();
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
