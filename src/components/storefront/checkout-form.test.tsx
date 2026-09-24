// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
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
import type { Country } from "../../../convex/lib/country";
import type { UseCart } from "../../hooks/useCart";
import { CheckoutPage } from "./checkout-form";
import type { PublicPickupLocation } from "./pickup-location-options";

// Reads go via `useQuery(convexQuery(api.x, args)).data` — mock the adapter
// pair, not `convex/react` (docs/frontend-caching.md, send-claim.test.tsx),
// answering by function name. `orders.create` is the one mutation; its args
// are what the submit test reads back.
const state = vi.hoisted(() => ({ createOrder: vi.fn() }));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: ({
		fn,
		args,
	}: {
		fn: Parameters<typeof getFunctionName>[0];
		args: unknown;
	}) => {
		if (args === "skip") return { data: undefined };
		switch (getFunctionName(fn)) {
			// Nothing listed: every cart line falls back to its own snapshot.
			case "products:list":
				return { data: [] };
			// A free-delivery store — no quote gate in the way of the phone field.
			case "delivery:quote":
				return { data: { kind: "free" } };
			default:
				return { data: undefined };
		}
	},
}));
vi.mock("convex/react", () => ({
	useMutation: () => state.createOrder,
	useAction: () => vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
// The address search talks to Convex (Places actions); these tests are about
// the phone field and what it drives, not Google's UI.
vi.mock("../forms/google-address-autocomplete", () => ({
	GoogleAddressAutocomplete: () => null,
}));

beforeAll(() => {
	// The mobile CTA bar publishes its height; jsdom has no ResizeObserver.
	// Inert polyfill, same as booking-checkout-form.test.tsx.
	globalThis.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as never;
	// A refused submit scrolls to the first error (focus-error.ts).
	Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
	// Only the clock is faked (timers stay real for waitFor): a fixed midday
	// "today" keeps the default fulfilment day inside the store's window.
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-10T04:00:00Z"));
	state.createOrder.mockResolvedValue({
		trackingToken: "tok_abc",
		confirmedAtCreate: true,
	});
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.clearAllMocks();
	window.localStorage.clear();
	window.sessionStorage.clear();
});

function cartStub(): UseCart {
	return {
		hydrated: true,
		items: [
			{
				variantId: "var_1" as Id<"productVariants">,
				productId: "prod_1" as Id<"products">,
				name: "Kek Pandan",
				price: 4500,
				currency: "MYR",
				quantity: 1,
			},
		],
		cartEvent: undefined,
		cartEventName: undefined,
		itemCount: 1,
		total: 4500,
		currency: "MYR",
		addItem: vi.fn(),
		updateQuantity: vi.fn(),
		removeItem: vi.fn(),
		removeEventLines: vi.fn(),
		clearCart: vi.fn(),
		quantityForProduct: () => 1,
		subtotalForProduct: () => 4500,
	};
}

const PICKUP: PublicPickupLocation = {
	_id: "pl_1" as Id<"pickupLocations">,
	label: "Kedai Bangsar",
	address: "12 Jalan Telawi, Bangsar",
	locationType: "self_collect",
	sortOrder: 0,
};

/** The storefront checkout with the smallest store that exercises the phone
 * field: one cart line, no hours, no notice. Delivery-only unless a test asks
 * for the pickup-only store (which needs no address to submit). */
function renderCheckout(
	opts: {
		country?: Country;
		booksCouriers?: boolean;
		method?: "delivery" | "pickup";
	} = {},
) {
	const pickupOnly = opts.method === "pickup";
	render(
		<CheckoutPage
			cart={cartStub()}
			retailerId={"ret_1" as Id<"retailers">}
			storeName="Kek Mama"
			storeSlug="kek-mama"
			checkoutPhone="60123456789"
			locale="en"
			country={opts.country ?? "MY"}
			confirmPushEnabled
			offerSelfCollect={pickupOnly}
			offerDelivery={!pickupOnly}
			collectsFromCustomer={false}
			booksCouriers={opts.booksCouriers ?? false}
			minFulfilmentNoticeDays={undefined}
			openingHours={undefined}
			minOrderValue={undefined}
			pickupLocations={pickupOnly ? [PICKUP] : []}
		/>,
	);
}

const picker = () =>
	screen.getByRole("combobox", {
		name: "Country of your WhatsApp number",
	}) as HTMLSelectElement;
const phoneInput = () =>
	screen.getByRole("textbox", { name: /^WhatsApp number/ }) as HTMLInputElement;

/** One change carrying the box's whole new value — a paste, an autofill, or
 * a single edit anywhere in the box (not only at the end). */
function changePhone(value: string) {
	fireEvent.change(phoneInput(), { target: { value } });
}

/** Typing, one character at a time, each appended to whatever the box holds
 * after the previous keystroke (including any rewrite the field made). */
function typePhone(text: string) {
	for (const ch of text) {
		fireEvent.change(phoneInput(), {
			target: { value: phoneInput().value + ch },
		});
	}
}

// parseBuyerWaPhone's rejection when the digits fit the OTHER store country.
const SG_UNDER_MY = /^That looks like a Singapore mobile number/;
const OVERSEAS_NOTE =
	"Your WhatsApp number is from outside Malaysia, so the rider will contact Kek Mama instead of you. Kek Mama can still reach you on WhatsApp, and your order page shows every update.";

describe("CheckoutPage — WhatsApp number from any country (z8r3fdh274)", () => {
	it("opens on the store's country, with the input the switch refocuses", () => {
		renderCheckout({ country: "SG" });
		expect(picker().value).toBe("SG");
		// BuyerPhoneCountrySwitch focuses by id; TextField ids its input with
		// the field name.
		expect(phoneInput().id).toBe("waPhone");
	});

	it("typing a +44 number from empty moves the picker to GB and keeps only the national part", () => {
		renderCheckout();
		typePhone("+44 7911 123456");
		expect(picker().value).toBe("GB");
		// The code went to the plate, never to the box (`+44 | +44 7911…`).
		expect(phoneInput().value).not.toContain("+44");
		// Exact: the switch lands on "+44" and empties the box, and the space
		// typed right after it must not lead the number.
		expect(phoneInput().value).toBe("7911 123456");
	});

	it("a pasted or autofilled +44 number does the same, leaving exactly the national part", () => {
		renderCheckout();
		changePhone("+44 7911 123456");
		expect(picker().value).toBe("GB");
		expect(phoneInput().value).toBe("7911 123456");
	});

	it("a second paste over a rewritten number still switches — the rewrite is what it replaced", () => {
		renderCheckout();
		changePhone("+44 7911 123456");
		expect(phoneInput().value).toBe("7911 123456");
		// Replacing the 11-character box with a 13-character paste is a bulk
		// insert. Judged against the raw 15-character "+44 7911 123456" instead
		// of what the box actually held, it would read as a keystroke and leave
		// "+65 9123 4567" under a GB plate.
		changePhone("+65 9123 4567");
		expect(picker().value).toBe("SG");
		expect(phoneInput().value).toBe("9123 4567");
	});

	it("a '+' slipped in front of digits already typed does NOT switch the country", () => {
		renderCheckout();
		typePhone("12-345 6789");
		expect(picker().value).toBe("MY");
		// "+12-345 6789" completes "+1" — judged without the value it replaced,
		// that would jump the plate to the United States and eat the 1.
		changePhone(`+${phoneInput().value}`);
		expect(picker().value).toBe("MY");
		expect(phoneInput().value).toBe("+12-345 6789");
	});

	it("SG digits under MY offer the switch; pressing it moves the picker, clears the error and returns focus to the number", () => {
		renderCheckout();
		changePhone("9123 4567");
		// The checkout's error shows from the first change (TanStack marks the
		// field touched), and the one-tap fix shows with it.
		expect(screen.getByText(SG_UNDER_MY)).toBeTruthy();
		const switchButton = screen.getByRole("button", {
			name: "Switch to Singapore (+65)",
		});
		switchButton.focus();
		fireEvent.click(switchButton);

		expect(picker().value).toBe("SG");
		expect(phoneInput().value).toBe("9123 4567");
		expect(screen.queryByText(SG_UNDER_MY)).toBeNull();
		expect(screen.queryByRole("button", { name: /^Switch to/ })).toBeNull();
		expect(
			screen.getByText(/^We'll send your confirmation to .*9123.*4567/),
		).toBeTruthy();
		// The button unmounted under the buyer's finger; focus goes back to
		// the field, not to the top of the page.
		expect(document.activeElement).toBe(phoneInput());
	});
});

describe("CheckoutPage — overseas courier note", () => {
	it("a courier-booking store, delivery, a GB number: the rider-calls-the-store note shows", () => {
		renderCheckout({ booksCouriers: true });
		fireEvent.change(picker(), { target: { value: "GB" } });
		expect(screen.getByText(OVERSEAS_NOTE)).toBeTruthy();
	});

	it("the same store with a Malaysian number shows nothing — the local happy path is unchanged", () => {
		renderCheckout({ booksCouriers: true });
		expect(picker().value).toBe("MY");
		expect(screen.queryByText(/is from outside Malaysia/)).toBeNull();
	});

	it("a store that books no couriers never shows it, whatever the number", () => {
		renderCheckout({ booksCouriers: false });
		fireEvent.change(picker(), { target: { value: "GB" } });
		expect(picker().value).toBe("GB");
		expect(screen.queryByText(/is from outside Malaysia/)).toBeNull();
	});
});

describe("CheckoutPage — submit", () => {
	it("sends the picked dial country with the number as typed", async () => {
		renderCheckout({ method: "pickup" });
		fireEvent.change(screen.getByRole("textbox", { name: /^Your name/ }), {
			target: { value: "Aisyah Rahman" },
		});
		changePhone("+44 7911 123456");
		expect(picker().value).toBe("GB");

		fireEvent.click(screen.getAllByRole("button", { name: "Place order" })[0]);

		await waitFor(() => expect(state.createOrder).toHaveBeenCalledTimes(1));
		const [args] = state.createOrder.mock.calls[0];
		expect(args.customer).toEqual({
			name: "Aisyah Rahman",
			waPhone: "7911 123456",
			waDialCountry: "GB",
		});
		expect(args.deliveryMethod).toBe("self_collect");
		expect(args.pickupLocationId).toBe("pl_1");
	});

	it("a buyer who never touches the picker sends the store's country", async () => {
		renderCheckout({ method: "pickup" });
		fireEvent.change(screen.getByRole("textbox", { name: /^Your name/ }), {
			target: { value: "Aisyah Rahman" },
		});
		changePhone("012-345 6789");

		fireEvent.click(screen.getAllByRole("button", { name: "Place order" })[0]);

		await waitFor(() => expect(state.createOrder).toHaveBeenCalledTimes(1));
		const [args] = state.createOrder.mock.calls[0];
		expect(args.customer.waDialCountry).toBe("MY");
		expect(args.customer.waPhone).toBe("012-345 6789");
	});
});
