// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
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
import { BookingCheckoutForm } from "./booking-checkout-form";

// Reads go via `useQuery(convexQuery(api.x, args)).data` — mock the adapter
// pair, not `convex/react` (docs/frontend-caching.md, send-claim.test.tsx),
// answering by function name: the listing, then its availability window.
const state = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	keepPreviousData: (previous: unknown) => previous,
	useQuery: ({ fn }: { fn: Parameters<typeof getFunctionName>[0] }) =>
		getFunctionName(fn) === "products:getPublicBySlug"
			? { data: PRODUCT }
			: { data: AVAILABILITY, isPlaceholderData: false },
}));
vi.mock("convex/react", () => ({ useMutation: () => state.request }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

const PRODUCT = {
	_id: "prod_1",
	name: "Riverside chalet",
	variants: [{ price: 25000 }],
	currency: "MYR",
	booking: { autoAccept: false },
};
const AVAILABILITY = {
	unavailable: [],
	noticeDays: 0,
	horizonDays: 180,
	maxNights: 30,
	packageLength: undefined,
	packageUnit: undefined,
	maxPackageQuantity: 1,
	weekendPrice: undefined,
	weekendDays: undefined,
};

beforeAll(() => {
	// The mobile CTA bar publishes its height; jsdom has no ResizeObserver.
	// Inert polyfill, same as cost-calculator.test.tsx.
	globalThis.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as never;
});

beforeEach(() => {
	// Only the clock is faked (timers stay real for waitFor): a fixed mid-month
	// "today" keeps the 15th and 17th bookable in the month on screen.
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-10T04:00:00Z"));
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.clearAllMocks();
});

/**
 * The booking checkout's WhatsApp field (S2 86eyn4kbw; any-country since
 * z8r3fdh274). It had no reason under the field at all — a bad number only
 * turned the CTA hint into "Enter your WhatsApp number" — and an SG store
 * showed an MY-shaped placeholder. These pin the picker's reach to the
 * mutation, the inline reason, and the masked echo.
 */
function renderForm(country: Country = "MY", locale?: "en" | "ms") {
	render(
		<BookingCheckoutForm
			retailerId={"ret_1" as Id<"retailers">}
			storeName="Lembah Riverside"
			storeSlug="lembah-riverside"
			productSlug="riverside-chalet"
			locale={locale}
			country={country}
		/>,
	);
}

const picker = () =>
	screen.getByRole("combobox", {
		name: "Country of your WhatsApp number",
	}) as HTMLSelectElement;
const phoneInput = () =>
	screen.getByRole("textbox", { name: "WhatsApp number" }) as HTMLInputElement;

function typePhone(value: string) {
	fireEvent.change(phoneInput(), { target: { value } });
}

/** Tap a day of the month on screen (September 2026). */
function tapDay(day: string) {
	const cell = screen
		.getAllByRole("gridcell")
		.find((c) => c.textContent === day);
	if (!cell) throw new Error(`no day ${day} on screen`);
	fireEvent.click(within(cell).getByRole("button"));
}

describe("BookingCheckoutForm — WhatsApp number", () => {
	it.each([
		["MY", "12-345 6789"],
		["SG", "9123 4567"],
	] as const)("opens on the store's country with its own example (%s)", (country, example) => {
		renderForm(country);
		expect(picker().value).toBe(country);
		expect(phoneInput().getAttribute("placeholder")).toBe(example);
	});

	it("a bad number says why under the field once the buyer leaves it", () => {
		renderForm();
		typePhone("123");
		const reason =
			"Enter a Malaysian mobile number (e.g. 012-345 6789), or tap +60 to change the country";
		expect(screen.queryByText(reason)).toBeNull();
		fireEvent.blur(phoneInput());
		expect(screen.getByText(reason)).toBeTruthy();
		expect(phoneInput().getAttribute("aria-invalid")).toBe("true");
	});

	it("the CTA hint points at the field — it doesn't ask to 'enter' a number that's there", () => {
		renderForm();
		tapDay("15");
		tapDay("17");
		fireEvent.change(screen.getByPlaceholderText("e.g. Aisyah"), {
			target: { value: "Aisyah Rahman" },
		});
		expect(
			screen.getAllByText("Enter your WhatsApp number").length,
		).toBeGreaterThan(0);
		typePhone("123");
		expect(
			screen.getAllByText("Check your WhatsApp number").length,
		).toBeGreaterThan(0);
	});

	it("digits that fit Singapore at an MY store get the one-tap switch", () => {
		renderForm("MY");
		typePhone("9123 4567");
		const switchButton = screen.getByRole("button", {
			name: "Switch to Singapore (+65)",
		});
		switchButton.focus();
		fireEvent.click(switchButton);
		expect(picker().value).toBe("SG");
		expect(
			screen.queryByRole("button", { name: "Switch to Singapore (+65)" }),
		).toBeNull();
		// The button unmounts with the fix — focus lands back in the number,
		// not at the top of the page.
		expect(document.activeElement).toBe(phoneInput());
	});

	it("the echo of the buyer's number is masked from session replay", () => {
		renderForm("SG");
		typePhone("9123 4567");
		const echo = screen.getByText(/We'll WhatsApp the decision to .*9123 4567/);
		expect(echo.getAttribute("data-clarity-mask")).toBe("true");
	});

	it("sends the picked country with the number", async () => {
		state.request.mockResolvedValue({ trackingToken: "tok_abc" });
		renderForm("MY");
		tapDay("15");
		tapDay("17");
		fireEvent.change(screen.getByPlaceholderText("e.g. Aisyah"), {
			target: { value: "Kenji Sato" },
		});
		fireEvent.change(picker(), { target: { value: "JP" } });
		typePhone("90-1234-5678");
		fireEvent.click(
			screen.getAllByRole("button", { name: "Request to book" })[0] as Element,
		);
		await waitFor(() => expect(state.request).toHaveBeenCalled());
		expect(state.request.mock.calls[0]?.[0].customer).toEqual({
			name: "Kenji Sato",
			waPhone: "90-1234-5678",
			waDialCountry: "JP",
		});
	});
});

/**
 * The stay/package summary is the third surface that carried the truncated
 * name (`z8r3fdhpaj`): same `min-w-0 truncate` label, same `flex-1` dotted
 * leader as the two Order Tickets.
 */
describe("stay summary — a long listing name wraps instead of truncating", () => {
	it("does not truncate the product name", () => {
		renderForm();
		// The name appears in the header too — take the summary's own label cell.
		const label = [
			...document.querySelectorAll<HTMLElement>("span.wrap-anywhere"),
		].find((s) => s.textContent === PRODUCT.name);
		expect(label).toBeTruthy();
		expect(label?.className).not.toContain("truncate");
	});
});
