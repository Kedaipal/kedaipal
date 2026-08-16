// @vitest-environment jsdom
/**
 * Render cover for the BOOKING kind route (booking bundle S1, ClickUp
 * `86eyn4kap`; spec `86eyj70z1`). The kind-first step is the wizard's new
 * front door, and booking is the one kind that re-plans the walked route —
 * these assertions pin what the pure tests can't: which cards are on screen,
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
	defaultKind,
}: {
	onSubmit?: (values: ProductFormSubmitValues) => Promise<void>;
	defaultKind?: "physical" | "service" | "booking";
} = {}) {
	return render(
		<ProductWizard
			retailerId={"r1" as never}
			categoriesLocked={false}
			currency="RM"
			defaultKind={defaultKind}
			onSubmit={onSubmit as never}
			onSkipToFullForm={vi.fn()}
			onOpenFullForm={vi.fn()}
			onExit={vi.fn()}
		/>,
	);
}

const continueBtn = () => screen.getByRole("button", { name: /continue/i });
const pickBooking = () =>
	fireEvent.click(screen.getByRole("button", { name: /booking/i }));

describe("wizard — kind-first step (step 0)", () => {
	it("opens on the kind question with all four cards and no silent default", () => {
		renderWizard();
		expect(screen.getByText("What are you selling?")).toBeTruthy();
		for (const label of ["Food", "Physical goods", "Service", "Booking"]) {
			expect(
				screen
					.getByRole("button", { name: new RegExp(label, "i") })
					.getAttribute("aria-pressed"),
			).toBe("false");
		}
		// Unanswered = Continue disabled with the visible reason, never an error.
		expect(continueBtn().getAttribute("disabled")).not.toBeNull();
		expect(screen.getByText(/pick one to continue/i)).toBeTruthy();
	});

	it("pre-answers from the store type, badged so the seller knows why", () => {
		renderWizard({ defaultKind: "booking" });
		expect(
			screen
				.getByRole("button", { name: /booking/i })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(screen.getByText("Your store type")).toBeTruthy();
		// Pre-answered ⇒ Continue is live immediately.
		expect(continueBtn().getAttribute("disabled")).toBeNull();
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
		pickBooking();
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
		expect(screen.queryByText(/what kind of product is it/i)).toBeNull();
		expect(screen.queryByText(/how do you prepare orders/i)).toBeNull();
	});

	it("publishes kind + capacity and never a min-quantity", async () => {
		const onSubmit = vi.fn<(values: ProductFormSubmitValues) => Promise<void>>(
			async () => {},
		);
		renderWizard({ onSubmit });
		pickBooking();
		fireEvent.click(continueBtn());
		fireEvent.change(screen.getByPlaceholderText(/riverside standard plot/i), {
			target: { value: "Riverside Plot" },
		});
		fireEvent.click(continueBtn());
		// Price per night + capacity 5.
		const price = document.querySelector('input[inputmode="decimal"]');
		if (!price) throw new Error("price input missing");
		fireEvent.change(price, { target: { value: "80" } });
		const capacity = document.querySelector('input[inputmode="numeric"]');
		if (!capacity) throw new Error("capacity input missing");
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
		expect(values.booking).toEqual({ capacityPerNight: 5 });
		expect(values.minQuantity).toBeUndefined();
		expect(values.options).toEqual([]);
		expect(values.variants).toHaveLength(1);
		expect(values.variants[0]).toMatchObject({
			price: 8000,
			blockWhenOutOfStock: false,
			requiresProof: false,
		});
	});

	it("refuses a junk capacity at the step that owns the input", () => {
		renderWizard();
		pickBooking();
		fireEvent.click(continueBtn());
		fireEvent.change(screen.getByPlaceholderText(/riverside standard plot/i), {
			target: { value: "Riverside Plot" },
		});
		fireEvent.click(continueBtn());
		const price = document.querySelector('input[inputmode="decimal"]');
		if (!price) throw new Error("price input missing");
		fireEvent.change(price, { target: { value: "80" } });
		const capacity = document.querySelector('input[inputmode="numeric"]');
		if (!capacity) throw new Error("capacity input missing");
		fireEvent.change(capacity, { target: { value: "0" } });
		fireEvent.click(continueBtn());
		expect(
			screen.getByText(/enter a whole number between 1 and/i),
		).toBeTruthy();
		// Still on the pricing step — the issue is addressed to its input.
		expect(screen.getByText("Price and capacity")).toBeTruthy();
	});

	it("leaving booking re-asks the questions the kind had answered", () => {
		renderWizard();
		pickBooking();
		fireEvent.click(
			screen.getByRole("button", { name: /physical goods/i }),
		);
		// Back on the six-step route with Choices + Preparation restored.
		expect(screen.getByText("Step 1 of 6")).toBeTruthy();
	});
});
