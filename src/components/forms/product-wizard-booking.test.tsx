// @vitest-environment jsdom
/**
 * Render cover for the BOOKING kind route (booking bundle S1, ClickUp
 * `86eyn4kap`; spec `86eyj70z1`) and the regrouped step 0 (z8r3fdxt99). The
 * kind-first step is the wizard's front door, and booking — through its two
 * cards, Plan and Stay — is the one kind that re-plans the walked route.
 * These assertions pin what the pure tests can't: which cards are on screen,
 * which steps a booking seller actually walks, and what the publish payload
 * carries at the end of them.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("convex/react", () => ({
	useMutation: () => vi.fn(),
}));
// The wizard reads categories via the adapter — stub it to "loading".
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: undefined, isPending: true }),
}));

import type { ProductFormSubmitValues } from "./product-form";
import { ProductWizard } from "./product-wizard";

afterEach(cleanup);

function renderWizard({
	onSubmit = vi.fn(),
}: {
	onSubmit?: (values: ProductFormSubmitValues) => Promise<void>;
} = {}) {
	return render(
		<ProductWizard
			retailerId={"r1" as never}
			categoriesLocked={false}
			eventsLocked={false}
			promoLocked={false}
			currency="MYR"
			onSubmit={onSubmit as never}
			onSkipToFullForm={vi.fn()}
			onOpenFullForm={vi.fn()}
			onExit={vi.fn()}
		/>,
	);
}

const continueBtn = () => screen.getByRole("button", { name: /continue/i });
const card = (title: string) =>
	screen.getByRole("button", { name: new RegExp(`^${title}`, "i") });
const pickStay = () => fireEvent.click(card("A stay or rental"));
const pickPlan = () => fireEvent.click(card("A plan or package"));
const STEP0_CARDS = [
	"Food",
	"Goods",
	"A service",
	"A plan or package",
	"A stay or rental",
	"An event on one date",
];

describe("wizard — kind-first step (step 0)", () => {
	it("opens on the kind question with all six cards and no silent default", () => {
		renderWizard();
		expect(screen.getByText("What are you selling?")).toBeTruthy();
		for (const title of STEP0_CARDS) {
			expect(card(title).getAttribute("aria-pressed")).toBe("false");
		}
		// The store type no longer pre-picks or badges anything (z8r3fdxt99).
		expect(screen.queryByText("Your store type")).toBeNull();
		// Unanswered = Continue disabled with the visible reason, never an error.
		expect(continueBtn().getAttribute("disabled")).not.toBeNull();
		expect(screen.getByText(/pick one to continue/i)).toBeTruthy();
	});

	it("groups the cards by how buyers buy, and names the meal plan where it lives", () => {
		renderWizard();
		const order = screen.getByRole("group", { name: "Buyers order it" });
		const time = screen.getByRole("group", {
			name: "Buyers book a date or a period",
		});
		for (const title of ["Food", "Goods", "A service"]) {
			expect(order.contains(card(title))).toBe(true);
		}
		for (const title of [
			"A plan or package",
			"A stay or rental",
			"An event on one date",
		]) {
			expect(time.contains(card(title))).toBe(true);
		}
		// The case that filed z8r3fdxt99: a meal plan is named under the time
		// group, never left for a food seller to infer.
		expect(time.textContent).toMatch(/meal plans/i);
		expect(card("A plan or package").textContent).toMatch(/meal plan/i);
	});

	it("says the type is fixed once published — the old 'change it any time' was false", () => {
		renderWizard();
		expect(screen.getByText(/you can switch until you publish/i)).toBeTruthy();
		expect(screen.queryByText(/change it any time/i)).toBeNull();
	});

	it("keeps the full-form link and the pick prompt OUT of the sticky Continue block", () => {
		renderWizard();
		// Inside it they had no background and floated over the cards on a
		// phone as the seller scrolled.
		const sticky = continueBtn().parentElement;
		if (!sticky) throw new Error("sticky block missing");
		expect(sticky.className).toMatch(/sticky/);
		// …and the block is opaque, so a DISABLED (50%) button never shows the
		// cards scrolling under it through its label.
		expect(sticky.className).toMatch(/\bbg-background\b/);
		expect(
			sticky.contains(
				screen.getByRole("button", { name: /know the full editor/i }),
			),
		).toBe(false);
		expect(sticky.contains(screen.getByText(/pick one to continue/i))).toBe(
			false,
		);
	});

	it("shows each card's next step UNDER that card", () => {
		renderWizard();
		pickPlan();
		const wrapper = card("A plan or package").parentElement;
		expect(wrapper?.textContent).toMatch(/start date/i);
		pickStay();
		expect(card("A stay or rental").parentElement?.textContent).toMatch(
			/request to book/i,
		);
		// Only the chosen card explains itself.
		expect(card("A plan or package").parentElement?.textContent).not.toMatch(
			/start date and the plan/i,
		);
	});

	it("explains the food follow-up before the seller meets it", () => {
		renderWizard();
		fireEvent.click(screen.getByRole("button", { name: /food/i }));
		expect(screen.getByText(/made fresh/i)).toBeTruthy();
		expect(screen.getByText(/ready stock/i)).toBeTruthy();
	});
});

describe("wizard — booking kind route", () => {
	it("walks Kind → Name → Price & capacity → Review, four steps", () => {
		renderWizard();
		pickStay();
		// The kind card says what booking means before anything else is asked.
		expect(screen.getByText(/request to book/i)).toBeTruthy();
		expect(screen.getByText("Step 1 of 4")).toBeTruthy();

		fireEvent.click(continueBtn());
		expect(screen.getByText("Name this listing")).toBeTruthy();
		fireEvent.change(screen.getByPlaceholderText(/riverside standard plot/i), {
			target: { value: "Riverside Plot" },
		});

		fireEvent.click(continueBtn());
		// Step 3 is the booking pricing card — never "What kind of product is
		// it?" (Choices) and never "How do you prepare orders?" (Preparation).
		expect(screen.getByText("Price and capacity")).toBeTruthy();
		expect(screen.getByText(/spots available each night/i)).toBeTruthy();
		expect(screen.queryByText(/does the buyer choose anything/i)).toBeNull();
		expect(screen.queryByText(/how do you prepare orders/i)).toBeNull();
	});

	it("publishes kind + capacity and never a min-quantity", async () => {
		const onSubmit = vi.fn<(values: ProductFormSubmitValues) => Promise<void>>(
			async () => {},
		);
		renderWizard({ onSubmit });
		pickStay();
		fireEvent.click(continueBtn());
		fireEvent.change(screen.getByPlaceholderText(/riverside standard plot/i), {
			target: { value: "Riverside Plot" },
		});
		fireEvent.click(continueBtn());
		// Price per night + capacity 5.
		const price = document.querySelector('input[inputmode="decimal"]');
		if (!price) throw new Error("price input missing");
		fireEvent.change(price, { target: { value: "80" } });
		// By NAME, not by ordinal: the step holds several numeric inputs
		// (package length, capacity, notice) and `querySelector` picked whichever
		// happened to come first, so reordering the fields silently retargeted
		// the test.
		const capacity = screen.getByLabelText("Spots available");
		fireEvent.change(capacity, { target: { value: "5" } });
		fireEvent.click(continueBtn());

		// Review — booking words, per-night price, capacity row.
		expect(screen.getByText("Ready to publish?")).toBeTruthy();
		expect(screen.getAllByText(/RM 80\/night/).length).toBeGreaterThan(0);
		expect(screen.getByText("5 per night")).toBeTruthy();
		expect(screen.getByText(/booking — request to book/i)).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: /publish product/i }));
		await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
		const values = onSubmit.mock.calls[0][0];
		expect(values.kind).toBe("booking");
		expect(values.booking).toEqual({
			capacityPerNight: 5,
			// Package + instant book are S7 knobs this listing doesn't use; a
			// blank weekend rate sends NEITHER key (S13).
			packageLength: undefined,
			packageUnit: undefined,
			autoAccept: undefined,
			securityDeposit: undefined,
		});
		expect(values.minQuantity).toBeUndefined();
		expect(values.options).toEqual([]);
		expect(values.variants).toHaveLength(1);
		expect(values.variants[0]).toMatchObject({
			price: 8000,
			blockWhenOutOfStock: false,
			requiresProof: false,
		});
	});

	it("the review preview follows Instant book — never 'request to book' beside 'Confirmed instantly'", () => {
		renderWizard({ onSubmit: vi.fn(async () => {}) });
		pickStay();
		fireEvent.click(continueBtn());
		fireEvent.change(screen.getByPlaceholderText(/riverside standard plot/i), {
			target: { value: "Riverside Plot" },
		});
		fireEvent.click(continueBtn());
		const price = document.querySelector('input[inputmode="decimal"]');
		if (!price) throw new Error("price input missing");
		fireEvent.change(price, { target: { value: "80" } });
		fireEvent.click(
			screen.getByRole("switch", { name: /confirm bookings instantly/i }),
		);
		fireEvent.click(continueBtn());

		expect(screen.getByText("Confirmed instantly")).toBeTruthy();
		expect(screen.getByText(/booking — book now/i)).toBeTruthy();
		expect(screen.queryByText(/booking — request to book/i)).toBeNull();
	});

	it("refuses a junk capacity at the step that owns the input", () => {
		renderWizard();
		pickStay();
		fireEvent.click(continueBtn());
		fireEvent.change(screen.getByPlaceholderText(/riverside standard plot/i), {
			target: { value: "Riverside Plot" },
		});
		fireEvent.click(continueBtn());
		const price = document.querySelector('input[inputmode="decimal"]');
		if (!price) throw new Error("price input missing");
		fireEvent.change(price, { target: { value: "80" } });
		// By NAME, not by ordinal: the step holds several numeric inputs
		// (package length, capacity, notice) and `querySelector` picked whichever
		// happened to come first, so reordering the fields silently retargeted
		// the test.
		const capacity = screen.getByLabelText("Spots available");
		fireEvent.change(capacity, { target: { value: "0" } });
		fireEvent.click(continueBtn());
		expect(
			screen.getByText(/enter a whole number between 1 and/i),
		).toBeTruthy();
		// Still on the pricing step — the issue is addressed to its input.
		expect(screen.getByText("Price and capacity")).toBeTruthy();
	});

	it("publishes a weekend rate on Fri + Sat by default, and the picker changes the nights (S13)", async () => {
		const onSubmit = vi.fn<(values: ProductFormSubmitValues) => Promise<void>>(
			async () => {},
		);
		renderWizard({ onSubmit });
		pickStay();
		fireEvent.click(continueBtn());
		fireEvent.change(screen.getByPlaceholderText(/riverside standard plot/i), {
			target: { value: "Riverside Plot" },
		});
		fireEvent.click(continueBtn());
		const [price, weekend] = Array.from(
			document.querySelectorAll('input[inputmode="decimal"]'),
		);
		if (!price || !weekend) throw new Error("price inputs missing");
		fireEvent.change(price, { target: { value: "80" } });
		// The picker only appears once there's a rate to apply it to.
		expect(screen.queryByText(/which nights charge this rate/i)).toBeNull();
		fireEvent.change(weekend, { target: { value: "120" } });
		expect(screen.getByText(/which nights charge this rate/i)).toBeTruthy();
		// The consequence line says what the seller just set up.
		expect(
			screen.getByText("Fri and Sat nights charge RM 120, other nights RM 80."),
		).toBeTruthy();
		// Add Sunday.
		fireEvent.click(screen.getByRole("button", { name: "Sunday" }));
		expect(
			screen.getByText(
				"Fri, Sat and Sun nights charge RM 120, other nights RM 80.",
			),
		).toBeTruthy();
		fireEvent.click(continueBtn());

		expect(screen.getByText("Weekend rate")).toBeTruthy();
		expect(screen.getByText("RM 120 on Fri, Sat & Sun nights")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /publish product/i }));
		await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
		const values = onSubmit.mock.calls[0][0];
		expect(values.booking).toMatchObject({
			weekendPrice: 12_000,
			weekendDays: [0, 5, 6],
		});
	});

	it("hides the weekend rate behind a package and drops it from the payload", async () => {
		const onSubmit = vi.fn<(values: ProductFormSubmitValues) => Promise<void>>(
			async () => {},
		);
		renderWizard({ onSubmit });
		pickStay();
		fireEvent.click(continueBtn());
		fireEvent.change(screen.getByPlaceholderText(/riverside standard plot/i), {
			target: { value: "Monthly Pass" },
		});
		fireEvent.click(continueBtn());
		const [price, weekend] = Array.from(
			document.querySelectorAll('input[inputmode="decimal"]'),
		);
		if (!price || !weekend) throw new Error("price inputs missing");
		fireEvent.change(price, { target: { value: "150" } });
		fireEvent.change(weekend, { target: { value: "120" } });
		// Now make it a package — the weekend field gives way to its reason.
		fireEvent.change(screen.getByPlaceholderText("e.g. 2"), {
			target: { value: "1" },
		});
		expect(screen.getByText(/a package has one flat price/i)).toBeTruthy();
		expect(document.querySelectorAll('input[inputmode="decimal"]').length).toBe(
			2,
		); // price + deposit; the weekend input is gone
		fireEvent.click(continueBtn());
		expect(screen.queryByText("Weekend rate")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /publish product/i }));
		await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
		const values = onSubmit.mock.calls[0][0];
		expect(values.booking?.packageLength).toBe(1);
		expect(values.booking).not.toHaveProperty("weekendPrice");
		expect(values.booking).not.toHaveProperty("weekendDays");
	});

	it("refuses a weekend rate with no nights at the step that owns it", () => {
		renderWizard();
		pickStay();
		fireEvent.click(continueBtn());
		fireEvent.change(screen.getByPlaceholderText(/riverside standard plot/i), {
			target: { value: "Riverside Plot" },
		});
		fireEvent.click(continueBtn());
		const [price, weekend] = Array.from(
			document.querySelectorAll('input[inputmode="decimal"]'),
		);
		if (!price || !weekend) throw new Error("price inputs missing");
		fireEvent.change(price, { target: { value: "80" } });
		fireEvent.change(weekend, { target: { value: "120" } });
		fireEvent.click(screen.getByRole("button", { name: "Friday" }));
		fireEvent.click(screen.getByRole("button", { name: "Saturday" }));
		fireEvent.click(continueBtn());
		expect(screen.getByText(/pick at least one night/i)).toBeTruthy();
		expect(screen.getByText("Price and capacity")).toBeTruthy();
	});

	it("leaving booking re-asks the questions the kind had answered", () => {
		renderWizard();
		pickStay();
		fireEvent.click(card("Goods"));
		// Back on the six-step route with Choices + Preparation restored.
		expect(screen.getByText("Step 1 of 6")).toBeTruthy();
	});
});

describe("wizard — plan route (z8r3fdxt99)", () => {
	function toPlanPricing() {
		pickPlan();
		expect(screen.getByText("Step 1 of 4")).toBeTruthy();
		fireEvent.click(continueBtn());
		expect(screen.getByText("Name this plan")).toBeTruthy();
		fireEvent.change(screen.getByPlaceholderText(/20-day lunch plan/i), {
			target: { value: "20-day lunch plan" },
		});
		fireEvent.click(continueBtn());
	}

	it("asks the length as the plan's first, required question", () => {
		renderWizard();
		toPlanPricing();
		expect(screen.getByText("Length and price")).toBeTruthy();
		expect(screen.getByText("How long does it run?")).toBeTruthy();
		// Never "(optional)" on a plan's length, and no nightly weekend rate.
		expect(screen.queryByText(/sell as a fixed package/i)).toBeNull();
		expect(screen.queryByText(/weekend rate/i)).toBeNull();
		// A plan counts in months or days — "nights" is a stay's word.
		const unit = screen.getByLabelText("Package length unit");
		expect(
			Array.from(unit.querySelectorAll("option")).map((o) => o.value),
		).toEqual(["month", "day"]);

		const price = document.querySelector('input[inputmode="decimal"]');
		if (!price) throw new Error("price input missing");
		fireEvent.change(price, { target: { value: "300" } });
		fireEvent.click(continueBtn());
		// Blank length = stopped on the step, with the reason.
		expect(screen.getByText(/enter how long the plan runs/i)).toBeTruthy();
		expect(screen.getByText("Length and price")).toBeTruthy();
	});

	it("publishes a month package and reviews it as a plan", async () => {
		const onSubmit = vi.fn<(values: ProductFormSubmitValues) => Promise<void>>(
			async () => {},
		);
		renderWizard({ onSubmit });
		toPlanPricing();
		fireEvent.change(screen.getByPlaceholderText("e.g. 1"), {
			target: { value: "1" },
		});
		const price = document.querySelector('input[inputmode="decimal"]');
		if (!price) throw new Error("price input missing");
		fireEvent.change(price, { target: { value: "300" } });
		fireEvent.click(continueBtn());

		expect(screen.getByText("Ready to publish?")).toBeTruthy();
		// The irreversible answer, in the card's own words, last chance.
		expect(screen.getByText("Selling")).toBeTruthy();
		expect(screen.getByText("A plan or package")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /publish product/i }));
		await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
		const values = onSubmit.mock.calls[0][0];
		expect(values.kind).toBe("booking");
		expect(values.booking).toMatchObject({
			packageLength: 1,
			packageUnit: "month",
		});
	});

	it("Plan ⇄ Stay is a free switch — no confirm, typed price kept", () => {
		renderWizard();
		toPlanPricing();
		const price = document.querySelector('input[inputmode="decimal"]');
		if (!price) throw new Error("price input missing");
		fireEvent.change(price, { target: { value: "300" } });
		// Back to step 0 through the header, then over to Stay.
		fireEvent.click(screen.getByRole("button", { name: /previous step/i }));
		fireEvent.click(screen.getByRole("button", { name: /previous step/i }));
		pickStay();
		expect(screen.queryByRole("alertdialog")).toBeNull();
		expect(card("A stay or rental").getAttribute("aria-pressed")).toBe("true");
		fireEvent.click(continueBtn());
		fireEvent.click(continueBtn());
		expect(screen.getByText("Price and capacity")).toBeTruthy();
		expect(
			(document.querySelector('input[inputmode="decimal"]') as HTMLInputElement)
				.value,
		).toBe("300");
	});
});
