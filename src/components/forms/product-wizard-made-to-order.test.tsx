// @vitest-environment jsdom
/**
 * Render cover for the third product type (ClickUp `86eyfq04j`).
 *
 * The bespoke seller — the ICP's cake decorator — had no way through the
 * wizard: every path demanded a price, and the only bespoke affordance was a
 * checkbox under the full form's Advanced disclosure. These assertions pin the
 * route that fixes that, at the level the pure tests can't reach: what is on
 * screen, and which steps the seller is actually walked through.
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

import { ProductWizard, type WizardState } from "./product-wizard";
import { emptyRow } from "./variant-editor";

afterEach(cleanup);

/** A named draft sitting on the unanswered type question (step 2). */
function atTypeStep(overrides: Partial<WizardState> = {}): WizardState {
	return {
		name: "Custom cake",
		description: "",
		images: [],
		kindCard: "physical",
		capacityPerNight: "1",
		shape: null,
		editor: { options: [], rows: [emptyRow([])], customLine: null },
		fulfilmentAnswered: false,
		hidden: false,
		categoryIds: [],
		minQuantity: "",
		minNoticeDays: "",
		...overrides,
	} as WizardState;
}

function renderWizard(state: WizardState) {
	return render(
		<ProductWizard
			retailerId={"r1" as never}
			categoriesLocked={false}
			currency="RM"
			onSubmit={vi.fn()}
			onSkipToFullForm={vi.fn()}
			onOpenFullForm={vi.fn()}
			onExit={vi.fn()}
			initialState={state}
		/>,
	);
}

const pickMadeToOrder = () =>
	fireEvent.click(screen.getByRole("button", { name: /made to order/i }));

describe("wizard — the Made to order type is reachable and self-explaining", () => {
	it("offers it as a third answer, with what it means", () => {
		renderWizard(atTypeStep());
		expect(screen.getByText("What kind of product is it?")).toBeTruthy();
		const card = screen.getByRole("button", { name: /made to order/i });
		expect(card.getAttribute("aria-pressed")).toBe("false");
		expect(
			screen.getByText(/you quote a price and get a mockup approved/i),
		).toBeTruthy();

		pickMadeToOrder();
		expect(
			screen
				.getByRole("button", { name: /made to order/i })
				.getAttribute("aria-pressed"),
		).toBe("true");
		// Discoverability rule: say up front what this type skips and what a
		// blank price will mean, before the seller reaches either.
		expect(screen.getByText(/no choices and no stock to set up/i)).toBeTruthy();
	});

	it("drops Preparation from the walked count", () => {
		// Kind-first (86eyj70z1) put step 0 ahead of everything: the default
		// route is six steps, made-to-order five.
		renderWizard(atTypeStep());
		expect(screen.getByText("Step 3 of 6")).toBeTruthy();
		pickMadeToOrder();
		expect(screen.getByText("Step 3 of 5")).toBeTruthy();
	});

	it("releases the type when the seller changes their mind", () => {
		// Regression: `madeToOrder` is DERIVED from the row's flags, and the
		// switch used to carry the donor row through untouched — so leaving the
		// type kept `requiresProof`, the target card never lit up, and the
		// "no choices, no stock" note stayed on screen under it.
		renderWizard(atTypeStep());
		pickMadeToOrder();
		fireEvent.click(screen.getByRole("button", { name: /just one item/i }));

		expect(
			screen
				.getByRole("button", { name: /just one item/i })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			screen
				.getByRole("button", { name: /made to order/i })
				.getAttribute("aria-pressed"),
		).toBe("false");
		// The type's explainer belongs to the type, not the step.
		expect(screen.queryByText(/no choices and no stock to set up/i)).toBeNull();
		// …and the full route is back, Preparation included.
		expect(screen.getByText("Step 3 of 6")).toBeTruthy();
	});

	it("goes straight from Price to Review, and never demands an amount", () => {
		renderWizard(atTypeStep());
		pickMadeToOrder();
		fireEvent.click(screen.getByRole("button", { name: /continue/i }));

		// Step 3 — the price, framed as optional with the buyer-facing outcome.
		expect(screen.getByText("Do you have a starting price?")).toBeTruthy();
		expect(screen.getByText(/leave it blank and buyers see/i)).toBeTruthy();

		// A blank price must not block Continue the way it does for every other
		// type — this is the whole point of the ticket item.
		fireEvent.click(screen.getByRole("button", { name: /continue/i }));
		expect(screen.getByText("Step 5 of 5")).toBeTruthy();
		// …and step 4 is REVIEW, not "How do you prepare orders?".
		expect(screen.queryByText(/how do you prepare orders/i)).toBeNull();
		expect(
			screen.getByRole("button", { name: /publish product/i }),
		).toBeTruthy();
		// The review reads it as a quote, never as a missing price.
		expect(screen.getAllByText(/price on quote/i).length).toBeGreaterThan(0);
	});
});
