// @vitest-environment jsdom
// Delyva dispatch card (86eyjpv6z) — the service-picker flow and every state
// that must never be a dead end: no couriers, an unweighable cart, a failed
// booking, a blocked order. The Convex layer is mocked; the assertions are all
// about what the seller sees and can do next.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { DelyvaDispatchCard } from "./delyva-dispatch-card";

const state = vi.hoisted(() => ({
	dispatch: undefined as unknown,
	actions: new Map<string, ReturnType<typeof vi.fn>>(),
}));

vi.mock("convex/react", async () => {
	const { getFunctionName: name } = await import("convex/server");
	return {
		useAction: (ref: unknown) =>
			state.actions.get(name(ref as never)) ?? vi.fn(),
	};
});
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: state.dispatch }),
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ to, search, ...props }: Record<string, unknown>) => (
		<a href={String(to)} {...props} />
	),
}));
vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const NAME = {
	prepare: getFunctionName(api.delyva.prepareBooking),
	confirm: getFunctionName(api.delyva.confirmBooking),
	cancel: getFunctionName(api.delyva.cancelBooking),
};

const order = {
	_id: "order1",
	shortId: "ORD-1234",
	deliveryMethod: "delivery",
	// Bookable: set-up hints only render on orders the seller can still act
	// on, so an order with no status would suppress them.
	status: "confirmed",
	currency: "MYR",
	deliveryFee: 1200,
	items: [],
	customer: { waPhone: "60123456789" },
} as unknown as Doc<"orders">;

function dispatchState(overrides: Record<string, unknown> = {}) {
	return {
		job: null,
		blockReason: null,
		bookingEnabled: true,
		defaultItemType: "CHILLED",
		computedWeightKg: 2.5,
		weightIssue: null,
		...overrides,
	};
}

const SERVICES = [
	{
		code: "NINJA-COLD",
		name: "Ninja Cold",
		companyName: "Ninja Van",
		price: 1850,
		currency: "MYR",
		serviceType: "NDD",
		itemTypes: ["CHILLED"],
	},
	{
		code: "DDEX",
		name: "DD Express Chilled",
		companyName: "DD Express",
		price: 2100,
		currency: "MYR",
		serviceType: "NDD",
		itemTypes: ["CHILLED"],
	},
];

beforeEach(() => {
	state.dispatch = dispatchState();
	state.actions.clear();
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("visibility", () => {
	it("renders nothing for a self-collect order", () => {
		const { container } = render(
			<DelyvaDispatchCard
				order={{ ...order, deliveryMethod: "self_collect" } as Doc<"orders">}
			/>,
		);
		expect(container.textContent).toBe("");
	});

	it("renders nothing before the dispatch state resolves", () => {
		state.dispatch = undefined;
		const { container } = render(<DelyvaDispatchCard order={order} />);
		expect(container.textContent).toBe("");
	});

	it("hides itself entirely in an unsupported country when nothing is booked", () => {
		state.dispatch = dispatchState({
			blockReason: "country_unsupported",
			bookingEnabled: false,
		});
		const { container } = render(<DelyvaDispatchCard order={order} />);
		expect(container.textContent).toBe("");
	});

	it("offers a connect hint — not a dead button — when Delyva was never set up", () => {
		state.dispatch = dispatchState({
			bookingEnabled: false,
			blockReason: "not_connected",
		});
		render(<DelyvaDispatchCard order={order} />);
		expect(screen.getByText(/connect Delyva/i)).toBeTruthy();
	});

	it("pitches the feature with a Pro badge for a Starter seller", () => {
		state.dispatch = dispatchState({
			bookingEnabled: false,
			blockReason: "plan_gated",
		});
		const { container } = render(<DelyvaDispatchCard order={order} />);
		expect(container.textContent).toContain("Book couriers straight from an order");
		expect(container.textContent).toContain("Pro");
	});
});

describe("blocked states name their fix", () => {
	it("disables the button and explains a wrong order status", () => {
		state.dispatch = dispatchState({ blockReason: "bad_status" });
		render(<DelyvaDispatchCard order={order} />);
		const button = screen.getByRole("button", { name: /book a courier/i });
		expect(button.hasAttribute("disabled")).toBe(true);
		expect(
			screen.getByText(/only be booked while the order is confirmed or packed/i),
		).toBeTruthy();
	});

	it("points a missing pickup address at the settings card", () => {
		state.dispatch = dispatchState({ blockReason: "no_pickup_address" });
		render(<DelyvaDispatchCard order={order} />);
		expect(
			screen.getByText(/Add your pickup address under Settings/i),
		).toBeTruthy();
	});
});

describe("quote → pick → book", () => {
	it("lists couriers cheapest-first, pre-selects it, and names the choice on the CTA", async () => {
		const prepare = vi.fn().mockResolvedValue({
			ok: true,
			services: SERVICES,
			weightKg: 2.5,
			itemType: "CHILLED",
			buyerPaidFee: 1200,
		});
		state.actions.set(NAME.prepare, prepare);
		const { container } = render(<DelyvaDispatchCard order={order} />);

		fireEvent.click(screen.getByRole("button", { name: /get courier prices/i }));
		await waitFor(() => expect(prepare).toHaveBeenCalled());

		expect(prepare).toHaveBeenCalledWith({
			shortId: "ORD-1234",
			itemType: "CHILLED",
			weightKgOverride: 2.5,
		});
		expect(screen.getByText("Ninja Cold")).toBeTruthy();
		expect(screen.getByText("DD Express Chilled")).toBeTruthy();
		// Cheapest badge belongs to the first row only.
		expect(screen.getAllByText("Cheapest")).toHaveLength(1);
		// The CTA repeats the selection + price, so a tap is never a surprise.
		expect(container.textContent).toContain("Book Ninja Cold");
		expect(container.textContent).toContain("18.50");
		// The buyer's paid fee sits beside the quotes — the margin comparison.
		expect(container.textContent).toContain("12.00");
	});

	it("books the courier the seller selected, not the default", async () => {
		const prepare = vi.fn().mockResolvedValue({
			ok: true,
			services: SERVICES,
			weightKg: 2.5,
			itemType: "CHILLED",
			buyerPaidFee: 1200,
		});
		const confirm = vi
			.fn()
			.mockResolvedValue({ ok: true, providerOrderId: "d1", costActual: 2100 });
		state.actions.set(NAME.prepare, prepare);
		state.actions.set(NAME.confirm, confirm);
		render(<DelyvaDispatchCard order={order} />);

		fireEvent.click(screen.getByRole("button", { name: /get courier prices/i }));
		await waitFor(() => expect(screen.getByText("DD Express Chilled")).toBeTruthy());
		fireEvent.click(screen.getByText("DD Express Chilled"));
		fireEvent.click(screen.getByRole("button", { name: /book DD Express/i }));

		await waitFor(() => expect(confirm).toHaveBeenCalled());
		expect(confirm).toHaveBeenCalledWith({
			shortId: "ORD-1234",
			serviceCode: "DDEX",
			serviceName: "DD Express Chilled",
			itemType: "CHILLED",
			weightKgOverride: 2.5,
		});
	});

	it("keeps a booking failure on screen instead of a toast that vanishes", async () => {
		const prepare = vi.fn().mockResolvedValue({
			ok: true,
			services: SERVICES,
			weightKg: 2.5,
			itemType: "CHILLED",
			buyerPaidFee: 1200,
		});
		const confirm = vi.fn().mockResolvedValue({
			ok: false,
			reason: "booking_failed",
			message: "Your Delyva account doesn't have enough credit.",
		});
		state.actions.set(NAME.prepare, prepare);
		state.actions.set(NAME.confirm, confirm);
		render(<DelyvaDispatchCard order={order} />);

		fireEvent.click(screen.getByRole("button", { name: /get courier prices/i }));
		await waitFor(() => expect(screen.getByText("Ninja Cold")).toBeTruthy());
		fireEvent.click(screen.getByRole("button", { name: /book Ninja Cold/i }));

		await waitFor(() =>
			expect(screen.getByText(/enough credit/i)).toBeTruthy(),
		);
		// …and the picker is still there, so "top up then retry" is one tap.
		expect(screen.getByText("Ninja Cold")).toBeTruthy();
	});

	it("renders an empty courier list as a handoff, never an error", async () => {
		const prepare = vi.fn().mockResolvedValue({
			ok: true,
			services: [],
			weightKg: 2.5,
			itemType: "CHILLED",
			buyerPaidFee: 1200,
		});
		state.actions.set(NAME.prepare, prepare);
		const { container } = render(<DelyvaDispatchCard order={order} />);

		fireEvent.click(screen.getByRole("button", { name: /get courier prices/i }));
		await waitFor(() =>
			expect(screen.getByText(/No courier can take/i)).toBeTruthy(),
		);
		// Country-neutral since SG shipped (z8r3fdbqmc) — the point is that the
		// empty state explains cold-chain coverage, not that it names a market.
		expect(container.textContent).toContain("cover far less ground");
		expect(container.textContent).toContain("add the tracking number below");
	});

	it("drops stale prices when the parcel type changes", async () => {
		const prepare = vi.fn().mockResolvedValue({
			ok: true,
			services: SERVICES,
			weightKg: 2.5,
			itemType: "CHILLED",
			buyerPaidFee: 1200,
		});
		state.actions.set(NAME.prepare, prepare);
		render(<DelyvaDispatchCard order={order} />);

		fireEvent.click(screen.getByRole("button", { name: /get courier prices/i }));
		await waitFor(() => expect(screen.getByText("Ninja Cold")).toBeTruthy());

		// A different parcel type is a different set of couriers and prices.
		fireEvent.click(screen.getByRole("button", { name: /^Parcel$/i }));
		expect(screen.queryByText("Ninja Cold")).toBeNull();
		expect(screen.getByRole("button", { name: /get courier prices/i })).toBeTruthy();
	});

	it("re-quotes with the per-order parcel type after an override", async () => {
		const prepare = vi.fn().mockResolvedValue({
			ok: true,
			services: SERVICES,
			weightKg: 2.5,
			itemType: "PARCEL",
			buyerPaidFee: 1200,
		});
		state.actions.set(NAME.prepare, prepare);
		render(<DelyvaDispatchCard order={order} />);

		fireEvent.click(screen.getByRole("button", { name: /^Parcel$/i }));
		fireEvent.click(screen.getByRole("button", { name: /get courier prices/i }));
		await waitFor(() => expect(prepare).toHaveBeenCalled());
		expect(prepare.mock.calls[0][0].itemType).toBe("PARCEL");
	});
});

describe("weight", () => {
	it("asks for a packed weight when the cart can't be weighed, and gates the quote on it", () => {
		state.dispatch = dispatchState({
			computedWeightKg: null,
			weightIssue: "custom_item",
		});
		render(<DelyvaDispatchCard order={order} />);
		expect(screen.getByText(/custom line/i)).toBeTruthy();
		// Nothing to quote against yet.
		expect(
			screen
				.getByRole("button", { name: /get courier prices/i })
				.hasAttribute("disabled"),
		).toBe(true);

		fireEvent.change(screen.getByLabelText(/parcel weight in kilograms/i), {
			target: { value: "3.2" },
		});
		expect(
			screen
				.getByRole("button", { name: /get courier prices/i })
				.hasAttribute("disabled"),
		).toBe(false);
	});

	it("explains missing product weights differently from a custom line", () => {
		state.dispatch = dispatchState({
			computedWeightKg: null,
			weightIssue: "missing_weights",
		});
		render(<DelyvaDispatchCard order={order} />);
		expect(screen.getByText(/no parcel weight set/i)).toBeTruthy();
	});

	it("sends a seller's overridden weight, not the computed one", async () => {
		const prepare = vi
			.fn()
			.mockResolvedValue({ ok: true, services: [], weightKg: 9, itemType: "CHILLED", buyerPaidFee: 0 });
		state.actions.set(NAME.prepare, prepare);
		render(<DelyvaDispatchCard order={order} />);

		fireEvent.change(screen.getByLabelText(/parcel weight in kilograms/i), {
			target: { value: "9" },
		});
		fireEvent.click(screen.getByRole("button", { name: /get courier prices/i }));
		await waitFor(() => expect(prepare).toHaveBeenCalled());
		expect(prepare.mock.calls[0][0].weightKgOverride).toBe(9);
	});
});

describe("booked states", () => {
	it("shows the AWB, the cost and a cancel for a live booking", () => {
		state.dispatch = dispatchState({
			blockReason: "job_active",
			job: {
				status: "picked_up",
				providerOrderId: "delyva-1",
				costActual: 1850,
				serviceCode: "NINJA-COLD",
				serviceName: "Ninja Cold",
				itemType: "CHILLED",
				awb: "MY0012345678",
				createdAt: Date.now(),
			},
		});
		const { container } = render(
			<DelyvaDispatchCard
				order={
					{
						...order,
						carrierTrackingUrl: "https://track.example/MY0012345678",
					} as Doc<"orders">
				}
			/>,
		);
		expect(screen.getByText("MY0012345678")).toBeTruthy();
		expect(screen.getByText("Ninja Cold")).toBeTruthy();
		expect(container.textContent).toContain("In transit");
		expect(container.textContent).toContain("18.50");
		expect(screen.getByRole("button", { name: /cancel booking/i })).toBeTruthy();
		expect(screen.getByText(/track parcel/i)).toBeTruthy();
	});

	it("says the tracking number is still coming rather than showing a blank", () => {
		state.dispatch = dispatchState({
			blockReason: "job_active",
			job: {
				status: "assigning",
				providerOrderId: "delyva-1",
				costActual: 600,
				serviceCode: "DHLEC-MY",
				serviceName: "DHL eCommerce",
				createdAt: Date.now(),
			},
		});
		render(<DelyvaDispatchCard order={order} />);
		expect(screen.getByText(/waiting for DHL eCommerce to issue/i)).toBeTruthy();
	});

	it("offers one-tap retry after a failed booking and says the buyer wasn't told", () => {
		state.dispatch = dispatchState({
			job: {
				status: "canceled",
				costActual: 0,
				serviceCode: "NINJA-COLD",
				serviceName: "Ninja Cold",
				failureReason: "Not enough credit",
				createdAt: Date.now(),
			},
		});
		const { container } = render(<DelyvaDispatchCard order={order} />);
		expect(container.textContent).toContain("Booking didn't go through");
		expect(container.textContent).toContain("Not enough credit");
		expect(container.textContent).toContain("buyer was not notified");
		expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
	});

	it("marks a completed delivery without offering a cancel", () => {
		state.dispatch = dispatchState({
			job: {
				status: "completed",
				providerOrderId: "delyva-1",
				costActual: 1850,
				serviceCode: "NINJA-COLD",
				serviceName: "Ninja Cold",
				awb: "MY0012345678",
				createdAt: Date.now(),
			},
		});
		const { container } = render(<DelyvaDispatchCard order={order} />);
		expect(container.textContent).toContain("Delivered");
		expect(screen.queryByRole("button", { name: /cancel booking/i })).toBeNull();
	});
});

describe("collect-from line", () => {
	// The address imported from the seller's Delyva profile at connect is
	// prefill, not truth — so the first booking IS the double-check: the card
	// says where the courier will collect, with the edit one tap away.
	it("shows the stored pickup address above the quote, with an Edit link", () => {
		state.dispatch = dispatchState({
			pickupSummary: "55 Jln Eco Majestic, 43500 Semenyih",
		});
		const { container } = render(<DelyvaDispatchCard order={order} />);
		expect(container.textContent).toContain("Collecting from");
		expect(container.textContent).toContain("55 Jln Eco Majestic, 43500 Semenyih");
		expect(screen.getByRole("link", { name: /edit/i })).toBeTruthy();
	});

	it("says nothing when no address is stored — the block reason covers that", () => {
		const { container } = render(<DelyvaDispatchCard order={order} />);
		expect(container.textContent).not.toContain("Collecting from");
	});
});

describe("a closed order's failed booking is history, not a retry", () => {
	// The card offered "Try again" for any failed job, even on an order the
	// server would refuse to book (Zaki's delivered order, 2 Sep) — a
	// wrong-but-enabled button where a disabled-with-reason belongs.
	const cancelledOnClosedOrder = {
		blockReason: "bad_status",
		job: {
			status: "canceled",
			providerOrderId: "delyva-9",
			costActual: 1850,
			serviceCode: "NINJA-COLD",
			serviceName: "Ninja Cold",
			itemType: "CHILLED",
			awb: "DX0010754MY",
			failureReason: "Cancelled by Delyva",
			createdAt: Date.now(),
		},
	};

	it("keeps the failure visible but retires the retry", () => {
		state.dispatch = dispatchState(cancelledOnClosedOrder);
		const { container } = render(<DelyvaDispatchCard order={order} />);
		expect(container.textContent).toContain("Booking didn't go through");
		expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
		expect(container.textContent).toContain(
			"only be booked while the order is confirmed or packed",
		);
	});

	it("still offers the retry while the order IS bookable", () => {
		state.dispatch = dispatchState({
			...cancelledOnClosedOrder,
			blockReason: null,
		});
		render(<DelyvaDispatchCard order={order} />);
		expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
	});
});

describe("embedded in the dispatch hub", () => {
	it("drops its own border so the hub's shell isn't a card inside a card", () => {
		const { container } = render(
			<DelyvaDispatchCard order={order} embedded />,
		);
		const root = container.querySelector("section");
		expect(root?.className).not.toContain("border");
		expect(root?.className).not.toContain("rounded-2xl");
	});

	it("keeps its own chrome when it stands alone", () => {
		const { container } = render(<DelyvaDispatchCard order={order} />);
		const root = container.querySelector("section");
		expect(root?.className).toContain("border");
	});
});

describe("the hint names the RIGHT next step", () => {
	// PR #247 review (LOW): a connected seller who paused booking was told to
	// "connect Delyva" — a screen they already finished — while the switch
	// they actually need went unmentioned.
	it("tells a paused store to resume, not to connect", () => {
		state.dispatch = dispatchState({
			bookingEnabled: false,
			blockReason: "disabled",
		});
		const { container } = render(<DelyvaDispatchCard order={order} />);
		expect(container.textContent).toContain("paused");
		expect(container.textContent).toContain("Courier booking");
		expect(container.textContent).not.toContain("connect Delyva");
	});

	it("still tells a store that never connected to connect", () => {
		state.dispatch = dispatchState({
			bookingEnabled: false,
			blockReason: "not_connected",
		});
		const { container } = render(<DelyvaDispatchCard order={order} />);
		expect(container.textContent).toContain("connect Delyva");
		expect(container.textContent).not.toContain("paused");
	});
})

describe("an empty courier list says WHICH kind of empty", () => {
	// Zaki's SG account, 3 Sep: no couriers connected, so every address he
	// tried quoted nothing — while the card blamed the address, sending him
	// re-typing addresses instead of switching a courier on.
	async function quoteEmpty(accountHasNoCouriers?: boolean) {
		const prepare = vi.fn().mockResolvedValue({
			ok: true,
			services: [],
			weightKg: 2.5,
			itemType: "CHILLED",
			buyerPaidFee: 1200,
			accountHasNoCouriers,
		});
		state.actions.set(NAME.prepare, prepare);
		const view = render(<DelyvaDispatchCard order={order} />);
		fireEvent.click(screen.getByRole("button", { name: /get courier prices/i }));
		await waitFor(() => expect(prepare).toHaveBeenCalled());
		return view;
	}

	it("names the account when nothing is switched on — and clears the address of blame", async () => {
		const { container } = await quoteEmpty(true);
		expect(container.textContent).toContain(
			"no couriers switched on yet",
		);
		expect(container.textContent).toContain("isn't about this order's address");
		expect(container.textContent).not.toContain("No courier can take a");
	});

	it("still blames the route when the account HAS couriers", async () => {
		const { container } = await quoteEmpty(false);
		expect(container.textContent).toContain("No courier can take a");
		expect(container.textContent).not.toContain("no couriers switched on yet");
	});

	it("falls back to the generic wording when the lookup couldn't tell", async () => {
		const { container } = await quoteEmpty(undefined);
		expect(container.textContent).toContain("No courier can take a");
	});
})
