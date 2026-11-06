// @vitest-environment jsdom
// Delyva dispatch card (86eyjpv6z) — the service-picker flow and every state
// that must never be a dead end: no couriers, an unweighable cart, a failed
// booking, a blocked order. The Convex layer is mocked; the assertions are all
// about what the seller sees and can do next.
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { toast } from "sonner";
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
		useMutation: (ref: unknown) =>
			state.actions.get(name(ref as never)) ?? vi.fn(),
	};
});
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", async () => {
	const { getFunctionName } = await import("convex/server");
	return {
		// The courier-wallet line (z8r3fdx34j) reads its own query; everything
		// else answers with this card's own state.
		useQuery: (q: { fn: unknown }) => ({
			data:
				getFunctionName(q.fn as never) === "courierWallets:list"
					? walletState.wallets
					: getFunctionName(q.fn as never) === "courierWallets:topUpSuggestion"
						? undefined
						: state.dispatch,
		}),
	};
});
const walletState = vi.hoisted(() => ({
	wallets: [] as unknown[],
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ to, search, ...props }: Record<string, unknown>) => (
		<a href={String(to)} {...props} />
	),
}));
vi.mock("../../hooks/usePermission", () => ({
	// The top-up sheet inside `DispatchWalletLine` gates its re-check on the
	// integrations grant; these tests are about the card, so the reader has it.
	usePermission: () => ({ canRead: true, canWrite: true, role: "owner" }),
	useStoreRole: () => "owner",
}));
vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock("../../lib/download", () => ({
	downloadPdfBytes: vi.fn(),
}));

const NAME = {
	prepare: getFunctionName(api.delyva.prepareBooking),
	confirm: getFunctionName(api.delyva.confirmBooking),
	cancel: getFunctionName(api.delyva.cancelBooking),
	label: getFunctionName(api.delyva.getLabel),
	refresh: getFunctionName(api.delyva.refreshJob),
	markReturned: getFunctionName(api.delyva.markOrderReturned),
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
	walletState.wallets = [];
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
		expect(container.textContent).toContain(
			"Book couriers straight from an order",
		);
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
			screen.getByText(
				/only be booked while the order is confirmed or packed/i,
			),
		).toBeTruthy();
	});

	it("points a missing pickup address at the settings card", () => {
		state.dispatch = dispatchState({ blockReason: "no_pickup_address" });
		render(<DelyvaDispatchCard order={order} />);
		expect(
			screen.getByText(/Add your pickup address under Settings/i),
		).toBeTruthy();
	});

	// Credits T3: out of credits, no quote is offered (it would be refused);
	// the booking control stays in place, disabled, saying why — and the
	// store-wide lock outranks the order's own block, since it's the one the
	// seller can clear today.
	it("out of credits: no quote, a disabled Book with the lock's reason", () => {
		const reason =
			"You're out of credits, so accepting and updating orders and editing products are paused.";
		render(<DelyvaDispatchCard order={order} lockedReason={reason} />);
		expect(
			screen.queryByRole("button", { name: /get courier prices/i }),
		).toBeNull();
		const button = screen.getByRole("button", { name: /book a courier/i });
		expect(button.hasAttribute("disabled")).toBe(true);
		expect(screen.getByText(reason)).toBeTruthy();
		cleanup();
		state.dispatch = dispatchState({ blockReason: "no_pickup_address" });
		render(<DelyvaDispatchCard order={order} lockedReason={reason} />);
		expect(screen.getByText(reason)).toBeTruthy();
		expect(
			screen.queryByText(/Add your pickup address under Settings/i),
		).toBeNull();
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

		fireEvent.click(
			screen.getByRole("button", { name: /get courier prices/i }),
		);
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

	it("a balance read with the quote that can't pay disables Book, the wallet line as its reason", async () => {
		// Since 31 Oct the quote reads Delyva's wallet (GET /customer/{id}).
		walletState.wallets = [
			{
				provider: "delyva",
				armed: true,
				isTest: false,
				state: "low",
				balanceMinor: 900,
				currency: "MYR",
				at: Date.now(),
				lowAlertMinor: 3000,
				lowAlertCustom: false,
				source: "pull",
				refusedAt: null,
				refusedPriceMinor: null,
			},
		];
		state.actions.set(
			NAME.prepare,
			vi.fn().mockResolvedValue({
				ok: true,
				services: SERVICES,
				weightKg: 2.5,
				itemType: "CHILLED",
				buyerPaidFee: 1200,
			}),
		);
		render(<DelyvaDispatchCard order={order} />);
		fireEvent.click(
			screen.getByRole("button", { name: /get courier prices/i }),
		);
		const book = await screen.findByRole("button", { name: /Book Ninja Cold/ });
		expect((book as HTMLButtonElement).disabled).toBe(true);
		expect(book.getAttribute("aria-describedby")).toBe(
			"delyva-wallet-ORD-1234",
		);
		walletState.wallets = [];
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

		fireEvent.click(
			screen.getByRole("button", { name: /get courier prices/i }),
		);
		await waitFor(() =>
			expect(screen.getByText("DD Express Chilled")).toBeTruthy(),
		);
		fireEvent.click(screen.getByText("DD Express Chilled"));
		fireEvent.click(screen.getByRole("button", { name: /book DD Express/i }));

		await waitFor(() => expect(confirm).toHaveBeenCalled());
		expect(confirm).toHaveBeenCalledWith({
			shortId: "ORD-1234",
			serviceCode: "DDEX",
			serviceName: "DD Express Chilled",
			serviceType: "NDD",
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

		fireEvent.click(
			screen.getByRole("button", { name: /get courier prices/i }),
		);
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

		fireEvent.click(
			screen.getByRole("button", { name: /get courier prices/i }),
		);
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

		fireEvent.click(
			screen.getByRole("button", { name: /get courier prices/i }),
		);
		await waitFor(() => expect(screen.getByText("Ninja Cold")).toBeTruthy());

		// A different parcel type is a different set of couriers and prices.
		fireEvent.click(screen.getByRole("button", { name: /^Parcel$/i }));
		expect(screen.queryByText("Ninja Cold")).toBeNull();
		expect(
			screen.getByRole("button", { name: /get courier prices/i }),
		).toBeTruthy();
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
		fireEvent.click(
			screen.getByRole("button", { name: /get courier prices/i }),
		);
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
		const prepare = vi.fn().mockResolvedValue({
			ok: true,
			services: [],
			weightKg: 9,
			itemType: "CHILLED",
			buyerPaidFee: 0,
		});
		state.actions.set(NAME.prepare, prepare);
		render(<DelyvaDispatchCard order={order} />);

		fireEvent.change(screen.getByLabelText(/parcel weight in kilograms/i), {
			target: { value: "9" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: /get courier prices/i }),
		);
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
		expect(
			screen.getByRole("button", { name: /cancel booking/i }),
		).toBeTruthy();
		expect(screen.getByText(/track parcel/i)).toBeTruthy();
	});

	it("delivered says scan-not-photo and never claims the buyer was messaged (z8r3fdytmq)", () => {
		state.dispatch = dispatchState({
			blockReason: "job_active",
			job: {
				status: "completed",
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
						status: "delivered",
						carrierTrackingUrl: "https://track.example/MY0012345678",
					} as Doc<"orders">
				}
			/>,
		);
		expect(container.textContent).toContain(
			"tracking scan, not a photo: Track parcel shows it",
		);
		expect(container.textContent).not.toMatch(/notified automatically/);
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
		expect(
			screen.getByText(/waiting for DHL eCommerce to issue/i),
		).toBeTruthy();
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
		expect(
			screen.queryByRole("button", { name: /cancel booking/i }),
		).toBeNull();
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
		expect(container.textContent).toContain(
			"55 Jln Eco Majestic, 43500 Semenyih",
		);
		expect(screen.getByRole("link", { name: /edit/i })).toBeTruthy();
	});

	it("says nothing when no address is stored — the block reason covers that", () => {
		const { container } = render(<DelyvaDispatchCard order={order} />);
		expect(container.textContent).not.toContain("Collecting from");
	});
});

describe("overseas buyer number (z8r3fdh274)", () => {
	// A foreign buyer number hands the courier the STORE's number. The card
	// says so before the first quote, naming the store's market, so the seller
	// isn't surprised when the courier phones them about this parcel.
	it("says the courier will call the store, in the store's market", () => {
		state.dispatch = dispatchState({
			buyerContactFallback: true,
			country: "MY",
		});
		render(<DelyvaDispatchCard order={order} />);
		expect(
			screen.getByText(
				"This buyer's WhatsApp number isn't a Malaysian number, so the courier gets your store's number instead, with the buyer's real number in the booking note.",
			),
		).toBeTruthy();
	});

	it("names Singapore on an SG store", () => {
		state.dispatch = dispatchState({
			buyerContactFallback: true,
			country: "SG",
		});
		render(<DelyvaDispatchCard order={order} />);
		expect(screen.getByText(/isn't a Singapore number/)).toBeTruthy();
	});

	it("says nothing for a local buyer", () => {
		state.dispatch = dispatchState({
			buyerContactFallback: false,
			country: "MY",
		});
		const { container } = render(<DelyvaDispatchCard order={order} />);
		expect(container.textContent).not.toContain("store's number");
	});

	it("says nothing once a courier is booked — the notice is about the NEXT booking", () => {
		state.dispatch = dispatchState({
			buyerContactFallback: true,
			country: "MY",
			blockReason: "job_active",
			job: {
				status: "picked_up",
				costActual: 1850,
				serviceCode: "NINJA-COLD",
				serviceName: "Ninja Cold",
				awb: "MY0012345678",
				createdAt: Date.now(),
			},
		});
		const { container } = render(<DelyvaDispatchCard order={order} />);
		expect(container.textContent).not.toContain("store's number");
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
		const { container } = render(<DelyvaDispatchCard order={order} embedded />);
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
});

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
		fireEvent.click(
			screen.getByRole("button", { name: /get courier prices/i }),
		);
		await waitFor(() => expect(prepare).toHaveBeenCalled());
		return view;
	}

	it("names the account when nothing is switched on — and clears the address of blame", async () => {
		const { container } = await quoteEmpty(true);
		expect(container.textContent).toContain("no couriers switched on yet");
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
});

describe("cold chain gets its own diagnosis", () => {
	// Chilled/frozen is the ICP's core need, and it fails identically to an
	// unserviceable address because Delyva filters item types server-side.
	// The server re-quotes as a parcel to tell them apart (3 Sep).
	async function quoteEmptyCold(coldChainUnavailable?: boolean) {
		const prepare = vi.fn().mockResolvedValue({
			ok: true,
			services: [],
			weightKg: 2.5,
			itemType: "CHILLED",
			buyerPaidFee: 1200,
			accountHasNoCouriers: false,
			coldChainUnavailable,
		});
		state.actions.set(NAME.prepare, prepare);
		const view = render(<DelyvaDispatchCard order={order} />);
		fireEvent.click(
			screen.getByRole("button", { name: /get courier prices/i }),
		);
		await waitFor(() => expect(prepare).toHaveBeenCalled());
		return view;
	}

	it("clears the address of blame when the route quotes fine as a parcel", async () => {
		const { container } = await quoteEmptyCold(true);
		expect(container.textContent).toContain(
			"None of the couriers on your Delyva account carries",
		);
		expect(container.textContent).toContain("isn't the address or the weight");
		expect(container.textContent).toContain(
			"Ask Delyva to enable a cold-chain",
		);
		expect(container.textContent).not.toContain("No courier can take a");
	});

	it("keeps the route wording when a parcel wouldn't quote either", async () => {
		const { container } = await quoteEmptyCold(false);
		expect(container.textContent).toContain("No courier can take a");
		expect(container.textContent).not.toContain("None of the couriers on your");
	});
});

describe("cross-currency quotes are never presented as comparable", () => {
	// A Delyva account from another market prices in ITS currency — a
	// Malaysian sandbox account quoting a Singapore store (Zaki, 3 Sep). Then
	// "buyer paid S$6.00" beside "RM 0.10" is a margin call out of thin air.
	it("says so when the courier bills in a different currency", async () => {
		const prepare = vi.fn().mockResolvedValue({
			ok: true,
			services: [{ ...SERVICES[0], currency: "MYR" }],
			weightKg: 1,
			itemType: "PARCEL",
			buyerPaidFee: 600,
		});
		state.actions.set(NAME.prepare, prepare);
		const { container } = render(
			<DelyvaDispatchCard
				order={{ ...order, currency: "SGD" } as Doc<"orders">}
			/>,
		);
		fireEvent.click(
			screen.getByRole("button", { name: /get courier prices/i }),
		);
		await waitFor(() => expect(prepare).toHaveBeenCalled());
		expect(container.textContent).toContain("aren't directly comparable");
	});

	it("shows the plain comparison when both are the same currency", async () => {
		const prepare = vi.fn().mockResolvedValue({
			ok: true,
			services: SERVICES,
			weightKg: 1,
			itemType: "CHILLED",
			buyerPaidFee: 1200,
		});
		state.actions.set(NAME.prepare, prepare);
		const { container } = render(<DelyvaDispatchCard order={order} />);
		fireEvent.click(
			screen.getByRole("button", { name: /get courier prices/i }),
		);
		await waitFor(() => expect(prepare).toHaveBeenCalled());
		expect(container.textContent).toContain("Buyer paid");
		expect(container.textContent).not.toContain("aren't directly comparable");
	});
});

describe("the tracking link lands at collection (z8r3fe0t4e)", () => {
	const bookedJob = {
		status: "assigning",
		providerOrderId: "delyva-1",
		costActual: 500,
		serviceCode: "JNTMY-PN-B200",
		serviceName: "J&T Express",
		itemType: "PARCEL",
		awb: "632195694574",
		createdAt: Date.now(),
	};

	it("booked with the number but no link yet: says when the link comes, offers no Track parcel", () => {
		state.dispatch = dispatchState({
			blockReason: "job_active",
			job: bookedJob,
		});
		const { container } = render(
			<DelyvaDispatchCard
				order={{ ...order, trackingNo: "632195694574" } as Doc<"orders">}
			/>,
		);
		expect(screen.getByText("632195694574")).toBeTruthy();
		// No handoff on record (a booking from before z8r3fe11x3): the moment
		// is the first scan, which is true of both kinds.
		expect(container.textContent).toContain(
			"J&T Express's tracking page goes live at the courier's first scan",
		);
		expect(screen.queryByText(/track parcel/i)).toBeNull();
	});

	it("a booking from before the link moved keeps the link it was born with", () => {
		state.dispatch = dispatchState({
			blockReason: "job_active",
			job: bookedJob,
		});
		const { container } = render(
			<DelyvaDispatchCard
				order={
					{
						...order,
						trackingNo: "632195694574",
						carrierTrackingUrl:
							"https://www.jtexpress.my/tracking/632195694574",
					} as Doc<"orders">
				}
			/>,
		);
		expect(screen.getByText(/track parcel/i)).toBeTruthy();
		expect(container.textContent).not.toContain("goes live once");
	});

	it("a seller's own number on the order is never promised a link on the booking's behalf", () => {
		state.dispatch = dispatchState({
			blockReason: "job_active",
			job: bookedJob,
		});
		const { container } = render(
			<DelyvaDispatchCard
				order={{ ...order, trackingNo: "MANUAL-1" } as Doc<"orders">}
			/>,
		);
		expect(container.textContent).not.toContain("goes live once");
		expect(screen.queryByText(/track parcel/i)).toBeNull();
	});

	it("once collected, the link shows and the pre-collection line is gone", () => {
		state.dispatch = dispatchState({
			blockReason: "job_active",
			job: { ...bookedJob, status: "picked_up" },
		});
		const { container } = render(
			<DelyvaDispatchCard
				order={
					{
						...order,
						status: "shipped",
						trackingNo: "632195694574",
						carrierTrackingUrl:
							"https://www.jtexpress.my/tracking/632195694574",
					} as Doc<"orders">
				}
			/>,
		);
		expect(screen.getByText(/track parcel/i)).toBeTruthy();
		expect(container.textContent).not.toContain("goes live once");
	});
});

describe("pickup vs drop-off, logos and the courier's label (z8r3fe11x3)", () => {
	const MIXED_SERVICES = [
		{
			code: "JNTMY-PN-B200",
			name: "J&T Express Drop-off Nationwide Economy Service",
			companyName: "J&T Express",
			logoPath: "servicecompany/jnt.png",
			price: 500,
			currency: "MYR",
			serviceType: "NDD-DROP",
			itemTypes: ["PARCEL"],
		},
		{
			code: "DHLEC-MY",
			name: "DHL eCommerce",
			companyName: "DHL Ecommerce",
			logoPath: "servicecompany/562.png",
			price: 600,
			currency: "MYR",
			serviceType: "NDD",
			itemTypes: ["PARCEL"],
		},
		{
			code: "MYSTERY",
			name: "Mystery Courier",
			companyName: "Mystery Logistics",
			price: 700,
			currency: "MYR",
			itemTypes: ["PARCEL"],
		},
	];

	async function quoted() {
		state.actions.set(
			NAME.prepare,
			vi.fn().mockResolvedValue({
				ok: true,
				services: MIXED_SERVICES,
				weightKg: 2.5,
				itemType: "PARCEL",
				buyerPaidFee: 1200,
			}),
		);
		const confirm = vi
			.fn()
			.mockResolvedValue({ ok: true, providerOrderId: "d1" });
		state.actions.set(NAME.confirm, confirm);
		const view = render(<DelyvaDispatchCard order={order} />);
		fireEvent.click(
			screen.getByRole("button", { name: /get courier prices/i }),
		);
		await waitFor(() => expect(screen.getByText("DHL eCommerce")).toBeTruthy());
		return { ...view, confirm };
	}

	it("every row wears a pill: drop-off amber, pickup navy, a missing class as pickup with a warn", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { container } = await quoted();
		const pills = [...container.querySelectorAll("[data-handoff]")];
		expect(pills.map((p) => p.getAttribute("data-handoff"))).toEqual([
			"dropoff",
			"pickup",
			"pickup",
		]);
		expect(pills[0].textContent).toContain("You drop off");
		expect(pills[1].textContent).toBe("Courier picks up");
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("without a serviceType"),
			expect.objectContaining({ codes: ["MYSTERY"] }),
		);
		// Speed is read from the base class — a drop-off is still next-day.
		expect(container.textContent).toContain("Next-day · J&T Express");
		// The note under the list says what the two kinds mean.
		expect(container.textContent).toContain(
			"You drop off means you take the parcel to one of their branches",
		);
		warn.mockRestore();
	});

	it("nothing in a row truncates, and the price column is fixed", async () => {
		const { container } = await quoted();
		// The Book CTA repeats the name and the parcel-type pills are pressed
		// too, so pick the selected COURIER row: the pressed grid.
		const row = [...container.querySelectorAll('[aria-pressed="true"]')].find(
			(el) => el.className.includes("grid"),
		) as HTMLElement;
		expect(row.textContent).toContain(
			"J&T Express Drop-off Nationwide Economy Service",
		);
		expect(row.className).toContain("grid-cols-[44px_minmax(0,1fr)_92px]");
		expect(row.className).toContain("@md:grid-cols-[48px_minmax(0,1fr)_104px]");
		expect(row.querySelector(".truncate")).toBeNull();
		// Exactly one courier row is selected (the parcel-type pill is pressed too).
		expect(
			[...container.querySelectorAll('[aria-pressed="true"]')].filter((el) =>
				el.className.includes("grid"),
			),
		).toHaveLength(1);
	});

	it("shows the courier's logo from Delyva's CDN, initials when there is none, and initials again when it fails to load", async () => {
		const { container } = await quoted();
		const logos = [...container.querySelectorAll("img")];
		expect(logos.map((img) => img.getAttribute("src"))).toEqual([
			"https://cdn.delyva.app/servicecompany/jnt.png",
			"https://cdn.delyva.app/servicecompany/562.png",
		]);
		// No path on the quote → initials in the same box.
		expect(screen.getByText("ML").getAttribute("data-logo")).toBe("initials");
		fireEvent.error(logos[0]);
		await waitFor(() => expect(screen.getByText("JE")).toBeTruthy());
		expect(container.querySelectorAll("img")).toHaveLength(1);
	});

	it("books with the picked service's class so the booked card knows what was bought", async () => {
		const { confirm } = await quoted();
		fireEvent.click(screen.getByRole("button", { name: /^Book J&T Express/i }));
		await waitFor(() => expect(confirm).toHaveBeenCalled());
		expect(confirm.mock.calls[0][0]).toMatchObject({
			serviceCode: "JNTMY-PN-B200",
			serviceType: "NDD-DROP",
		});
	});

	const dropoffJob = {
		status: "assigning",
		providerOrderId: "delyva-drop-1",
		costActual: 500,
		serviceCode: "JNTMY-PN-B200",
		serviceName: "J&T Express",
		serviceType: "NDD-DROP",
		itemType: "PARCEL",
		awb: "632195694574",
		createdAt: Date.now(),
	};
	const pickupJob = {
		...dropoffJob,
		serviceCode: "DHLEC-MY",
		serviceName: "DHL eCommerce",
		serviceType: "NDD",
	};

	it("booked drop-off: the three steps lead, Print shipping label is primary, the copy names the branch scan", () => {
		state.dispatch = dispatchState({
			blockReason: "job_active",
			job: dropoffJob,
			pickupSummary: "12 Jalan Ampang, 50450 Kuala Lumpur",
		});
		const { container } = render(
			<DelyvaDispatchCard
				order={{ ...order, trackingNo: "632195694574" } as Doc<"orders">}
			/>,
		);
		const steps = screen.getByRole("list", { name: /what to do next/i });
		expect(
			[...steps.querySelectorAll("li")].map((li) => li.textContent),
		).toEqual([
			expect.stringContaining("Print the shipping label"),
			expect.stringContaining("Take it to any J&T Express branch"),
			expect.stringContaining("The order ships itself"),
		]);
		const print = screen.getByRole("button", { name: /print shipping label/i });
		expect(print.getAttribute("data-variant")).toBe("default");
		expect(print.hasAttribute("disabled")).toBe(false);
		expect(
			container.querySelector("[data-handoff]")?.getAttribute("data-handoff"),
		).toBe("dropoff");
		expect(container.textContent).toContain(
			"J&T Express's tracking page goes live once the branch scans the parcel in",
		);
		// No collection line on a drop-off — the courier isn't coming.
		expect(container.textContent).not.toContain("collects from");
	});

	it("booked pickup: the collection line names the pickup address and the label stays secondary", () => {
		state.dispatch = dispatchState({
			blockReason: "job_active",
			job: pickupJob,
			pickupSummary: "12 Jalan Ampang, 50450 Kuala Lumpur",
		});
		const { container } = render(
			<DelyvaDispatchCard
				order={{ ...order, trackingNo: "632195694574" } as Doc<"orders">}
			/>,
		);
		expect(container.textContent).toContain(
			"DHL eCommerce collects from 12 Jalan Ampang, 50450 Kuala Lumpur",
		);
		expect(screen.queryByRole("list", { name: /what to do next/i })).toBeNull();
		const print = screen.getByRole("button", { name: /print shipping label/i });
		expect(print.getAttribute("data-variant")).toBe("outline");
		expect(
			container.querySelector("[data-handoff]")?.getAttribute("data-handoff"),
		).toBe("pickup");
		expect(container.textContent).toContain(
			"DHL eCommerce's tracking page goes live once the parcel is collected",
		);
	});

	it("a booking from before the handoff was stored claims neither kind", () => {
		const { serviceType: _dropped, ...legacy } = dropoffJob;
		state.dispatch = dispatchState({
			blockReason: "job_active",
			job: legacy,
		});
		const { container } = render(
			<DelyvaDispatchCard
				order={
					{
						...order,
						trackingNo: "632195694574",
						carrierTrackingUrl:
							"https://www.jtexpress.my/tracking/632195694574",
					} as Doc<"orders">
				}
			/>,
		);
		expect(container.querySelector("[data-handoff]")).toBeNull();
		expect(container.textContent).toContain(
			"Delyva will update this order when the courier scans the parcel.",
		);
		expect(container.textContent).not.toContain("collects from");
		// The label is still offered — secondary, like any pickup.
		expect(
			screen
				.getByRole("button", { name: /print shipping label/i })
				.getAttribute("data-variant"),
		).toBe("outline");
	});

	it("Print shipping label is disabled with its reason until Delyva confirms the booking", () => {
		state.dispatch = dispatchState({
			blockReason: "job_active",
			job: { ...dropoffJob, providerOrderId: undefined, awb: undefined },
		});
		render(<DelyvaDispatchCard order={order} />);
		const print = screen.getByRole("button", { name: /print shipping label/i });
		expect(print.hasAttribute("disabled")).toBe(true);
		expect(
			screen.getByText("Available once Delyva confirms the booking."),
		).toBeTruthy();
	});

	it("once the parcel is scanned the steps and the label are gone — the label is on the parcel", () => {
		state.dispatch = dispatchState({
			blockReason: "job_active",
			job: { ...dropoffJob, status: "picked_up" },
		});
		const { container } = render(
			<DelyvaDispatchCard
				order={
					{
						...order,
						status: "shipped",
						trackingNo: "632195694574",
						carrierTrackingUrl:
							"https://www.jtexpress.my/tracking/632195694574",
					} as Doc<"orders">
				}
			/>,
		);
		expect(
			screen.queryByRole("button", { name: /print shipping label/i }),
		).toBeNull();
		expect(screen.queryByRole("list", { name: /what to do next/i })).toBeNull();
		expect(
			container.querySelector("[data-handoff]")?.getAttribute("data-handoff"),
		).toBe("dropoff");
		expect(screen.getByText(/track parcel/i)).toBeTruthy();
	});

	it("tapping Print saves PDF bytes, opens a URL in a new tab, and toasts Delyva's message on failure", async () => {
		const { downloadPdfBytes } = await import("../../lib/download");
		const { toast } = await import("sonner");
		const open = vi.spyOn(window, "open").mockImplementation(() => null);
		const getLabel = vi.fn();
		state.actions.set(NAME.label, getLabel);
		state.dispatch = dispatchState({
			blockReason: "job_active",
			job: dropoffJob,
		});
		render(<DelyvaDispatchCard order={order} />);
		const print = () =>
			fireEvent.click(
				screen.getByRole("button", { name: /print shipping label/i }),
			);

		const pdf = new ArrayBuffer(4);
		getLabel.mockResolvedValueOnce({
			ok: true,
			kind: "pdf",
			pdf,
			filename: "shipping-label-ORD-1234.pdf",
		});
		print();
		await waitFor(() =>
			expect(downloadPdfBytes).toHaveBeenCalledWith(
				"shipping-label-ORD-1234.pdf",
				pdf,
			),
		);
		expect(getLabel).toHaveBeenCalledWith({ shortId: "ORD-1234" });

		getLabel.mockResolvedValueOnce({
			ok: true,
			kind: "url",
			url: "https://cdn.delyva.app/labels/1.pdf",
			filename: "shipping-label-ORD-1234.pdf",
		});
		print();
		await waitFor(() =>
			expect(open).toHaveBeenCalledWith(
				"https://cdn.delyva.app/labels/1.pdf",
				"_blank",
				"noopener",
			),
		);

		getLabel.mockResolvedValueOnce({
			ok: false,
			message: "Delyva couldn't provide the label: Label not generated yet",
		});
		print();
		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith(
				"Delyva couldn't provide the label: Label not generated yet",
			),
		);
		open.mockRestore();
	});
});

describe("not scanned, pickup failed, returned (z8r3fe11y8)", () => {
	const HOUR = 60 * 60 * 1000;
	const booked = {
		status: "assigning",
		providerOrderId: "delyva-1",
		costActual: 500,
		serviceCode: "JNTMY-PN-B200",
		serviceName: "J&T Express",
		serviceType: "NDD-DROP",
		awb: "632195694574",
		createdAt: Date.now() - 26 * HOUR,
	};

	it("a flagged booking turns amber: the pill, the waybill in the explainer, the drop-off fix, Refresh + Print, last checked, and the way to Delyva", () => {
		state.dispatch = dispatchState({
			blockReason: "job_active",
			job: {
				...booked,
				staleSince: Date.now() - HOUR,
				lastPulledAt: Date.now() - 12 * 60_000,
			},
		});
		const { container } = render(<DelyvaDispatchCard order={order} />);
		expect(screen.getByText("Not scanned yet")).toBeTruthy();
		expect(container.querySelector("section")?.className).toContain(
			"border-amber-300",
		);
		const panel = screen.getByRole("status", { name: /Not scanned yet/ });
		expect(panel.textContent).toContain(
			"waybill 632195694574 is still unscanned",
		);
		expect(panel.textContent).toContain("ask that branch to scan it in");
		expect(panel.textContent).toContain("Last checked with Delyva 12m ago");
		expect(
			screen.getByRole("button", { name: /refresh status/i }),
		).toBeTruthy();
		// ONE label button on the card, inside the panel.
		expect(
			screen.getAllByRole("button", { name: /print shipping label/i }),
		).toHaveLength(1);
		expect(
			screen.getByRole("link", { name: /Ask Delyva/ }).getAttribute("href"),
		).toBe("https://my.delyva.app");
		// The drop-off steps still show — the seller may not have done them.
		expect(screen.getByRole("list", { name: /what to do next/i })).toBeTruthy();
	});

	it("a pickup booking's stale panel points at the Delyva app, and a never-checked job says so", () => {
		state.dispatch = dispatchState({
			blockReason: "job_active",
			job: { ...booked, serviceType: "NDD", staleSince: Date.now() - HOUR },
		});
		const { container } = render(<DelyvaDispatchCard order={order} />);
		expect(container.textContent).toContain(
			"check your Delyva app that a pickup is scheduled",
		);
		expect(container.textContent).toContain("Not checked with Delyva yet");
	});

	it("Refresh status pulls from Delyva and reports the answer either way", async () => {
		const refresh = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, changed: false })
			.mockResolvedValueOnce({
				ok: false,
				cooldown: true,
				message:
					"Checked with Delyva less than a minute ago — try again in 48s.",
			})
			.mockResolvedValueOnce({
				ok: false,
				message: "Delyva couldn't answer: 502 Bad Gateway",
			});
		state.actions.set(NAME.refresh, refresh);
		state.dispatch = dispatchState({
			blockReason: "job_active",
			job: { ...booked, staleSince: Date.now() - HOUR },
		});
		render(<DelyvaDispatchCard order={order} />);
		fireEvent.click(screen.getByRole("button", { name: /refresh status/i }));
		await waitFor(() =>
			expect(refresh).toHaveBeenCalledWith({ shortId: "ORD-1234" }),
		);
		await waitFor(() =>
			expect(toast.success).toHaveBeenCalledWith(
				"Checked with Delyva — nothing new",
				expect.anything(),
			),
		);
		// A cooldown is a wait, not a failure — it must never read as an error.
		fireEvent.click(screen.getByRole("button", { name: /refresh status/i }));
		await waitFor(() =>
			expect(toast.info).toHaveBeenCalledWith(
				expect.stringMatching(/less than a minute ago/),
			),
		);
		expect(toast.error).not.toHaveBeenCalled();
		// Delyva not answering IS a failure.
		fireEvent.click(screen.getByRole("button", { name: /refresh status/i }));
		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith(
				expect.stringMatching(/couldn't answer/),
			),
		);
	});

	it("the Ask Delyva link lands on the demo tenant for a demo key", () => {
		state.dispatch = dispatchState({
			blockReason: "job_active",
			isDemo: true,
			job: { ...booked, staleSince: Date.now() - HOUR },
		});
		render(<DelyvaDispatchCard order={order} />);
		expect(
			screen.getByRole("link", { name: /ask delyva/i }).getAttribute("href"),
		).toBe("https://demo.delyva.app");
	});

	it("a live booking that isn't flagged still offers Refresh status as the small path, with when it was last checked", () => {
		state.dispatch = dispatchState({
			blockReason: "job_active",
			job: { ...booked, createdAt: Date.now() - HOUR },
		});
		const { container } = render(<DelyvaDispatchCard order={order} />);
		expect(screen.queryByText("Not scanned yet")).toBeNull();
		expect(
			screen.getByRole("button", { name: /refresh status/i }),
		).toBeTruthy();
		expect(container.textContent).toContain("Not checked with Delyva yet");
		expect(container.querySelector("section")?.className).toContain(
			"border-border",
		);
	});

	it("pickup failed (board 5): named as such, Edit pickup address beside it, Book again as the CTA", () => {
		state.dispatch = dispatchState({
			pickupSummary: "55 Jln Eco Majestic, 43500 Semenyih",
			job: {
				...booked,
				status: "rejected",
				failureReason: "Courier cancelled the pickup",
			},
		});
		const { container } = render(<DelyvaDispatchCard order={order} />);
		expect(container.textContent).toContain(
			"Pickup failed — Courier cancelled the pickup",
		);
		expect(container.textContent).toContain("Waybill 632195694574");
		expect(
			screen.getByRole("link", { name: /edit pickup address/i }),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: /book again/i })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
		// The header pill names the state like the other amber states do, and
		// the pickup address has ONE edit control: the banner's, not also the
		// "Collecting from … · Edit" line of the rebook form.
		expect(screen.getAllByText("Pickup failed").length).toBeGreaterThan(0);
		expect(container.textContent).toContain("Collecting from");
		expect(screen.queryByRole("link", { name: /^edit$/i })).toBeNull();
	});

	it("a create failure (99) is still a booking that didn't go through, with Try again", () => {
		state.dispatch = dispatchState({
			job: {
				...booked,
				providerOrderId: undefined,
				awb: undefined,
				status: "rejected",
				failureReason: "Delyva could not create the order",
			},
		});
		const { container } = render(<DelyvaDispatchCard order={order} />);
		expect(container.textContent).toContain(
			"Booking didn't go through — Delyva could not create the order",
		);
		expect(
			screen.queryByRole("link", { name: /edit pickup address/i }),
		).toBeNull();
		expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
	});

	it("returned to you (board 5): Message buyer, Mark order as returned with what it does, Book again disabled with its reason", async () => {
		const markReturned = vi.fn().mockResolvedValue(undefined);
		state.actions.set(NAME.markReturned, markReturned);
		state.dispatch = dispatchState({
			blockReason: "bad_status",
			job: {
				...booked,
				status: "completed",
				returned: true,
				failureReason: "Returned to you",
			},
		});
		const shipped = {
			...order,
			status: "shipped",
			customer: { name: "Aisha", waPhone: "60123456789" },
			carrierTrackingUrl: "https://jtexpress.my/track/632195694574",
		} as Doc<"orders">;
		const { container } = render(<DelyvaDispatchCard order={shipped} />);
		expect(screen.getByText("Returned to you")).toBeTruthy();
		expect(container.querySelector("section")?.className).toContain(
			"border-amber-300",
		);
		expect(container.textContent).toContain(
			"J&T Express brought this parcel back",
		);
		expect(container.textContent).toContain("still reads Shipped");
		expect(container.textContent).not.toContain("Delivered");
		const message = screen.getByRole("link", { name: /message buyer/i });
		expect(message.getAttribute("href")).toContain(
			"https://wa.me/60123456789?text=",
		);
		expect(decodeURIComponent(message.getAttribute("href") ?? "")).toContain(
			"ORD-1234",
		);
		const rebook = screen.getByRole("button", { name: /book again/i });
		expect(rebook.hasAttribute("disabled")).toBe(true);
		expect(container.textContent).toContain("Mark the order as returned first");
		expect(container.textContent).toContain("Puts the order back to Packed");
		expect(
			screen.queryByRole("button", { name: /cancel booking/i }),
		).toBeNull();

		fireEvent.click(
			screen.getByRole("button", { name: /mark order as returned/i }),
		);
		const dialog = await screen.findByRole("dialog");
		expect(dialog.textContent).toContain("goes back to Packed");
		fireEvent.click(
			screen.getByRole("button", { name: /^mark as returned$/i }),
		);
		await waitFor(() =>
			expect(markReturned).toHaveBeenCalledWith({ shortId: "ORD-1234" }),
		);
		await waitFor(() =>
			expect(toast.success).toHaveBeenCalledWith(
				"Order back to Packed",
				expect.anything(),
			),
		);
	});

	it("once marked (the order is Packed again) the returned panel stays as history and the picker offers Book again", () => {
		state.dispatch = dispatchState({
			job: {
				...booked,
				status: "completed",
				returned: true,
				failureReason: "Returned to you",
			},
		});
		const packed = { ...order, status: "packed" } as Doc<"orders">;
		const { container } = render(<DelyvaDispatchCard order={packed} />);
		expect(container.textContent).toContain("brought this parcel back");
		// The explainer follows the order: no "still reads Shipped" once the
		// button it pointed at has gone.
		expect(container.textContent).not.toContain("still reads Shipped");
		expect(container.textContent).toContain("back at Packed");
		expect(
			screen.queryByRole("button", { name: /mark order as returned/i }),
		).toBeNull();
		expect(
			screen
				.getByRole("button", { name: /book again/i })
				.hasAttribute("disabled"),
		).toBe(false);
	});

	it("a counter order with no phone has no Message buyer, and the store lock disables Mark returned with its reason", () => {
		state.dispatch = dispatchState({
			blockReason: "bad_status",
			job: { ...booked, status: "completed", returned: true },
		});
		const shipped = {
			...order,
			status: "shipped",
			customer: { name: "Walk-in" },
		} as Doc<"orders">;
		const { container } = render(
			<DelyvaDispatchCard
				order={shipped}
				lockedReason="Out of credits — top up to work this order."
			/>,
		);
		expect(screen.queryByRole("link", { name: /message buyer/i })).toBeNull();
		const mark = screen.getByRole("button", {
			name: /mark order as returned/i,
		});
		expect(mark.hasAttribute("disabled")).toBe(true);
		expect(container.textContent).toContain("Out of credits");
	});
});
