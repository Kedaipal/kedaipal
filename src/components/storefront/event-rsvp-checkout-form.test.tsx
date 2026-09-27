// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { EventRsvpCheckoutForm } from "./event-rsvp-checkout-form";

/**
 * The standalone RSVP checkout (`z8r3fdhh45`). What these pin is the point of
 * the whole change: an RSVP is ONE product's order, its date and venue are
 * read back rather than asked for, and the buyer's basket is neither taken
 * along nor thrown away — it is explicitly left where it was.
 */

// Reads go via `useQuery(convexQuery(api.x, args)).data` — mock the adapter
// pair, not `convex/react` (docs/frontend-caching.md).
const state = vi.hoisted(() => ({
	create: vi.fn(),
	product: undefined as Record<string, unknown> | undefined,
	venue: undefined as Record<string, unknown> | null | undefined,
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: ({ fn }: { fn: Parameters<typeof getFunctionName>[0] }) =>
		getFunctionName(fn) === "products:getPublicBySlug"
			? { data: state.product ?? PRODUCT }
			: { data: state.venue === undefined ? VENUE : state.venue },
}));
vi.mock("convex/react", () => ({
	useMutation: () => state.create,
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

const EVENT_DATE = Date.UTC(2026, 10, 7);

const PRODUCT = {
	_id: "prod_1",
	name: "BNI Breakfast",
	slug: "bni-breakfast",
	currency: "MYR",
	priceFrom: 500,
	options: [],
	variants: [
		{
			_id: "var_1",
			optionValues: [],
			price: 500,
			onHand: 0,
			imageUrls: [],
		},
	],
	imageUrls: [],
	event: { date: EVENT_DATE, timeMinutes: 8 * 60 },
	eventSeatsLeft: 10,
	pickupNote: "Bring a cooler bag — these melt in 20 minutes.",
};
const VENUE = {
	_id: "pick_1",
	label: "Matrep Store",
	address: "Eco Majestic",
	locationType: "pickup",
	sortOrder: 0,
};

beforeAll(() => {
	// The mobile CTA bar publishes its height; jsdom has no ResizeObserver.
	globalThis.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as never;
});

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-28T04:00:00Z"));
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.clearAllMocks();
	state.product = undefined;
	state.venue = undefined;
});

function renderForm(cartItemCount = 0) {
	render(
		<EventRsvpCheckoutForm
			retailerId={"ret_1" as Id<"retailers">}
			storeName="IndoMart"
			storeSlug="indomart"
			productSlug="bni-breakfast"
			country="MY"
			confirmPushEnabled
			cartItemCount={cartItemCount}
		/>,
	);
}

describe("EventRsvpCheckoutForm — the basket is neither taken nor lost", () => {
	it("says the basket is kept when the buyer has one", () => {
		renderForm(3);
		// The silent version of this is what made the mixed cart confusing in
		// the first place — a buyer must never have to guess whether their
		// other items came along.
		// Rendered twice on purpose — mobile summary + desktop sticky column.
		expect(screen.getAllByText(/basket \(3 items\)/i).length).toBeGreaterThan(
			0,
		);
	});

	it("says nothing at all when the basket is empty", () => {
		renderForm(0);
		expect(screen.queryByText(/basket/i)).toBeNull();
	});

	it("counts one item in the singular", () => {
		renderForm(1);
		expect(screen.getAllByText(/basket \(1 item\)/i).length).toBeGreaterThan(0);
	});
});

describe("EventRsvpCheckoutForm — the event answers, it doesn't ask", () => {
	it("reads the moment and the venue back instead of offering pickers", () => {
		renderForm();
		expect(screen.getByText(/Matrep Store/)).toBeTruthy();
		expect(
			screen.getByText(/set by the store, the same for every guest/i),
		).toBeTruthy();
		// No date input anywhere: an RSVP's date is the seller's. A DISABLED
		// picker would still read as a choice the guest is failing to make.
		expect(document.querySelector('input[type="date"]')).toBeNull();
	});

	it("carries the product's collection note, so it's read before committing", () => {
		renderForm();
		expect(screen.getByText(/Bring a cooler bag/i)).toBeTruthy();
	});

	it("refuses with the cause named when the event has no venue", () => {
		state.venue = null;
		renderForm();
		expect(
			screen.getByText(/doesn't have a collection point set up yet/i),
		).toBeTruthy();
	});

	it("refuses a product that isn't an event, rather than showing a dead form", () => {
		state.product = { ...PRODUCT, event: undefined };
		renderForm();
		expect(screen.getByText(/isn't an event/i)).toBeTruthy();
	});

	it("closes RSVPs on an event that has already happened", () => {
		state.product = {
			...PRODUCT,
			event: { date: Date.UTC(2020, 0, 1), timeMinutes: 8 * 60 },
		};
		renderForm();
		expect(screen.getByText(/already taken place/i)).toBeTruthy();
	});
});

describe("EventRsvpCheckoutForm — the CTA carries its consequence", () => {
	it("names the money on a paid RSVP", () => {
		renderForm();
		// `formatPrice` joins symbol and amount with a NON-BREAKING space.
		expect(
			screen.getAllByRole("button", { name: /RSVP · RM\s5\.00/ }).length,
		).toBeGreaterThan(0);
	});

	it("says seats, not money, when the RSVP is free", () => {
		state.product = {
			...PRODUCT,
			priceFrom: 0,
			variants: [{ ...PRODUCT.variants[0], price: 0 }],
		};
		renderForm();
		expect(
			screen.getAllByRole("button", { name: /RSVP for 1 seat/ }).length,
		).toBeGreaterThan(0);
		// A free RSVP must never imply a payment is coming, and the answer is up
		// front in the receipt rather than only in the CTA's fine print — which
		// the blocked reason takes over until the guest has identified herself.
		expect(screen.getAllByText("Free").length).toBeGreaterThan(0);
	});

	it("blocks submit with the reason until the guest is identified", () => {
		renderForm();
		for (const cta of screen.getAllByRole("button", {
			name: /RSVP · RM\s5\.00/,
		})) {
			expect((cta as HTMLButtonElement).disabled).toBe(true);
		}
		expect(screen.getAllByText("Enter your name").length).toBeGreaterThan(0);
	});

	it("names the seat ceiling where the stepper stops, rather than going dead", () => {
		state.product = { ...PRODUCT, eventSeatsLeft: 2 };
		renderForm();
		const more = screen.getByRole("button", { name: /more seats/i });
		fireEvent.click(more);
		expect(screen.getByText(/that's every seat left/i)).toBeTruthy();
		expect((more as HTMLButtonElement).disabled).toBe(true);
	});

	it("never claims the seat pool is empty before an option is picked", () => {
		// The ceiling is a placeholder 1 until a variant resolves, so the naive
		// "seats >= maxQty" read said "that's every seat left" beside a 30-seat
		// event. Caught by rendering it.
		state.product = {
			...PRODUCT,
			options: [{ name: "Size", values: ["Small", "Large"] }],
			variants: [
				{
					_id: "var_s",
					optionValues: ["Small"],
					price: 500,
					onHand: 0,
					imageUrls: [],
				},
				{
					_id: "var_l",
					optionValues: ["Large"],
					price: 500,
					onHand: 0,
					imageUrls: [],
				},
			],
			eventSeatsLeft: 30,
		};
		renderForm();
		expect(screen.queryByText(/that's every seat left/i)).toBeNull();
		expect(screen.getByText(/pick your size first/i)).toBeTruthy();
	});

	it("refuses a full event outright", () => {
		state.product = { ...PRODUCT, eventSeatsLeft: 0 };
		renderForm();
		expect(screen.getAllByText(/fully booked/i).length).toBeGreaterThan(0);
		expect(screen.queryByRole("button", { name: /more seats/i })).toBeNull();
	});
});
