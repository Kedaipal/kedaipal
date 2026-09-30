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
	product: undefined as Record<string, unknown> | null | undefined,
	loading: false,
	venue: undefined as Record<string, unknown> | null | undefined,
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: ({ fn }: { fn: Parameters<typeof getFunctionName>[0] }) =>
		getFunctionName(fn) === "products:getPublicBySlug"
			? {
					data: state.loading
						? undefined
						: state.product === undefined
							? PRODUCT
							: state.product,
				}
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
/** An event with an unpicked axis — no variant resolves until a size is
 * chosen, so there is no price for this guest yet. */
const OPTIONED = {
	...PRODUCT,
	priceFrom: 300,
	options: [{ name: "Size", values: ["Small", "Medium"] }],
	variants: [
		{
			_id: "var_s",
			optionValues: ["Small"],
			price: 300,
			onHand: 0,
			imageUrls: [],
		},
		{
			_id: "var_m",
			optionValues: ["Medium"],
			price: 500,
			onHand: 0,
			imageUrls: [],
		},
	],
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
	state.loading = false;
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

describe("EventRsvpCheckoutForm — an unsettled price is never quoted as a total", () => {
	// Caught in Zaki's Chrome: with the Size unpicked the receipt read a firm
	// "Total RM 3.00" and the CTA "RSVP · RM 3.00", but RM 3.00 is the listing
	// FLOOR (`priceFrom`) — picking Medium jumps it to RM 5.00. A receipt may
	// never quote a figure that changes under the buyer.
	it("shows the floor as a FROM price, not a per-seat rate", () => {
		state.product = OPTIONED;
		renderForm();
		expect(screen.getAllByText(/^From RM\s3\.00$/).length).toBeGreaterThan(0);
		expect(screen.queryByText(/RM\s3\.00\/seat/)).toBeNull();
	});

	it("withholds the total and says why, rather than printing a wrong one", () => {
		state.product = OPTIONED;
		renderForm();
		expect(screen.queryByText(/^Total$/)).toBeNull();
		expect(
			screen.getAllByText(/pick your size to see the total/i).length,
		).toBeGreaterThan(0);
	});

	it("keeps money off the CTA until a variant resolves", () => {
		state.product = OPTIONED;
		renderForm();
		expect(screen.getAllByRole("button", { name: /^RSVP$/ }).length).toBe(2);
		expect(screen.queryByRole("button", { name: /RSVP · RM/ })).toBeNull();
	});

	it("settles everything the moment the option is picked", () => {
		state.product = OPTIONED;
		renderForm();
		fireEvent.click(screen.getByRole("button", { name: "Medium" }));
		expect(screen.getAllByText(/RM\s5\.00\/seat/).length).toBeGreaterThan(0);
		expect(screen.getAllByText(/^Total$/).length).toBeGreaterThan(0);
		expect(
			screen.getAllByRole("button", { name: /RSVP · RM\s5\.00/ }).length,
		).toBeGreaterThan(0);
	});

	it("a single-variant event settles immediately — no from-price detour", () => {
		renderForm();
		expect(screen.getAllByText(/RM\s5\.00\/seat/).length).toBeGreaterThan(0);
		expect(screen.queryByText(/to see the total/i)).toBeNull();
	});
});

describe("EventRsvpCheckoutForm — an event with nothing bookable (PR #309 FYI 3)", () => {
	// `resolveVariant` skips the custom line, so a made-to-order-only event can
	// never resolve a variant: the pills answer nothing, the total never
	// settles and the CTA never enables. Nothing refuses the combination at
	// save, so the page has to say so rather than hang.
	const madeToOrderOnly = {
		...PRODUCT,
		options: [],
		variants: [
			{
				_id: "var_custom",
				optionValues: [],
				price: 0,
				onHand: 0,
				imageUrls: [],
				isCustom: true,
				customLabel: "Custom",
				requiresProof: true,
			},
		],
	};

	it("states the dead end and points at the seller, instead of a form that can't finish", () => {
		state.product = madeToOrderOnly;
		renderForm();
		expect(screen.getByText(/aren't open online/i)).toBeTruthy();
		expect(screen.getByText(/message IndoMart/i)).toBeTruthy();
		// And no unfinishable form behind it.
		expect(screen.queryByRole("button", { name: /^RSVP$/ })).toBeNull();
	});

	it("an event with no variants at all lands in the same state", () => {
		state.product = { ...PRODUCT, options: [], variants: [] };
		renderForm();
		expect(screen.getByText(/aren't open online/i)).toBeTruthy();
	});

	it("a finished event still says it has finished — that reason outranks", () => {
		state.product = {
			...madeToOrderOnly,
			event: { date: Date.UTC(2020, 0, 1), timeMinutes: 8 * 60 },
		};
		renderForm();
		expect(screen.getByText(/already taken place/i)).toBeTruthy();
	});
});

describe("EventRsvpCheckoutForm — a gone event is not a loading event", () => {
	it("offers a way back instead of a skeleton that never resolves", () => {
		// `undefined` is loading; `null` is gone. Conflating them left a typo'd
		// or stale `?rsvp=` link spinning forever with nothing to read.
		state.product = null;
		renderForm();
		expect(screen.getByText(/isn't taking RSVPs right now/i)).toBeTruthy();
		expect(
			screen.getByRole("button", { name: /back to IndoMart/i }),
		).toBeTruthy();
	});

	it("still shows the skeleton while the read is genuinely in flight", () => {
		state.product = undefined;
		state.loading = true;
		renderForm();
		expect(screen.queryByText(/isn't taking RSVPs right now/i)).toBeNull();
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
		expect(screen.getByText(/that's all 2 seats/i)).toBeTruthy();
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

	it("names the seat pool without reading as the room's capacity (PR #309 FYI 1)", () => {
		// `eventSeatsLeft` is what REMAINS. "IndoMart has 2 for this event" read
		// as the total capacity on a partially-booked event.
		state.product = { ...PRODUCT, eventSeatsLeft: 2 };
		renderForm();
		fireEvent.click(screen.getByRole("button", { name: /more seats/i }));
		expect(
			screen.getByText("That's all 2 seats IndoMart has left for this event."),
		).toBeTruthy();
	});

	it("says LAST seat, not 'all 1 seats'", () => {
		state.product = { ...PRODUCT, eventSeatsLeft: 1 };
		renderForm();
		expect(
			screen.getByText("That's the last seat IndoMart has for this event."),
		).toBeTruthy();
	});

	it("refuses a full event outright", () => {
		state.product = { ...PRODUCT, eventSeatsLeft: 0 };
		renderForm();
		expect(screen.getAllByText(/fully booked/i).length).toBeGreaterThan(0);
		expect(screen.queryByRole("button", { name: /more seats/i })).toBeNull();
	});
});

describe("buyer questions + approval (z8r3fdkjek)", () => {
	const QUESTIONED = {
		...PRODUCT,
		buyerQuestions: [
			{
				id: "bring001",
				label: "What are you bringing?",
				type: "choice",
				options: ["2 Helinox furniture", "Helinox tent"],
				required: true,
			},
			{
				id: "tent0001",
				label: "Tent model",
				type: "text",
				required: true,
				showWhen: { questionId: "bring001", option: "Helinox tent" },
			},
		],
	};

	function fillGuest() {
		fireEvent.change(screen.getByPlaceholderText("e.g. Aisyah"), {
			target: { value: "Wilson Tan" },
		});
		fireEvent.change(document.getElementById("rsvp-wa-phone") as Element, {
			target: { value: "0123456789" },
		});
	}

	it("asks the questions, blocks on the required one, and sends the answers", async () => {
		state.product = QUESTIONED;
		state.create.mockResolvedValue({ shortId: "ORD-1", trackingToken: "t" });
		renderForm();
		fillGuest();
		expect(screen.getByText("A few questions")).toBeTruthy();
		expect(
			screen.getAllByText("Answer “What are you bringing?”").length,
		).toBeGreaterThan(0);
		// The tent box appears only after "Helinox tent" is picked.
		expect(screen.queryByLabelText(/Tent model/)).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Helinox tent" }));
		expect(screen.getAllByText("Answer “Tent model”").length).toBeGreaterThan(
			0,
		);
		fireEvent.change(screen.getByLabelText(/Tent model/), {
			target: { value: "Tactical One" },
		});
		fireEvent.click(screen.getAllByRole("button", { name: /^RSVP · / })[0]);
		await vi.waitFor(() => expect(state.create).toHaveBeenCalled());
		expect(state.create.mock.calls[0][0].items).toEqual([
			{
				variantId: "var_1",
				quantity: 1,
				answers: [
					{ questionId: "bring001", answer: "Helinox tent" },
					{ questionId: "tent0001", answer: "Tactical One" },
				],
			},
		]);
	});

	it("switching the trigger away drops the hidden answer", () => {
		state.product = QUESTIONED;
		renderForm();
		fireEvent.click(screen.getByRole("button", { name: "Helinox tent" }));
		fireEvent.change(screen.getByLabelText(/Tent model/), {
			target: { value: "Tactical One" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "2 Helinox furniture" }),
		);
		expect(screen.queryByLabelText(/Tent model/)).toBeNull();
		// The receipt echoes only what will be sent.
		expect(screen.queryByText("Tactical One")).toBeNull();
	});

	it("an event that approves each RSVP says so before the guest commits", () => {
		state.product = {
			...PRODUCT,
			event: { ...PRODUCT.event, requiresApproval: true },
		};
		renderForm();
		fillGuest();
		expect(screen.getByText("IndoMart approves each RSVP.")).toBeTruthy();
		expect(
			screen.getAllByRole("button", { name: "Request 1 seat" }).length,
		).toBeGreaterThan(0);
		expect(
			screen.getAllByText(/you pay only after they approve/i)[0],
		).toBeTruthy();
	});
});
