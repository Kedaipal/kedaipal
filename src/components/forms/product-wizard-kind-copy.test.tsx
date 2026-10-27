// @vitest-environment jsdom
/**
 * The words follow the step-0 card (z8r3fdxt99). Food, Goods and a Service
 * share one flow and one set of flags — `productKind.ts` forbids a behaviour
 * fork — so the only thing the card changes on steps 2 and 4 is what the
 * seller reads. These pin that a tent wash is never asked whether it's "made
 * fresh", and that step 2's examples speak the seller's own trade.
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

import type { KindCard } from "../../lib/kind-card";
import {
	emptyWizardState,
	ProductWizard,
	type WizardState,
} from "./product-wizard";
import { emptyRow } from "./variant-editor";

afterEach(cleanup);

function renderAt(state: WizardState) {
	return render(
		<ProductWizard
			retailerId={"r1" as never}
			categoriesLocked={false}
			eventsLocked={false}
			promoLocked={false}
			currency="MYR"
			onSubmit={vi.fn()}
			onSkipToFullForm={vi.fn()}
			onOpenFullForm={vi.fn()}
			onExit={vi.fn()}
			initialState={state}
		/>,
	);
}

/** Named, nothing else answered — the wizard reopens on step 2. */
const atChoices = (kindCard: KindCard): WizardState => ({
	...emptyWizardState(),
	kindCard,
	name: "Something",
});

/** Named, one priced item — the wizard reopens on step 4. */
const atPreparation = (kindCard: KindCard): WizardState => ({
	...atChoices(kindCard),
	shape: "single",
	editor: {
		options: [],
		rows: [{ ...emptyRow([]), price: "20" }],
		customLine: null,
	},
});

describe("step 2 — Choices speaks the trade picked on step 0", () => {
	it("asks whether the buyer chooses, not what 'kind of product' it is", () => {
		renderAt(atChoices("food"));
		expect(screen.getByText("Choices")).toBeTruthy();
		expect(screen.getByText("Does the buyer choose anything?")).toBeTruthy();
		expect(screen.queryByText(/what kind of product/i)).toBeNull();
	});

	it.each([
		["food", /nasi lemak bungkus/i, /custom birthday cake/i],
		["physical", /a camping chair/i, /custom-printed banner/i],
		["service", /car wash/i, /a repair you price after seeing it/i],
	] as const)("%s gets its own examples", (card, single, quote) => {
		renderAt(atChoices(card));
		expect(
			screen.getByRole("button", { name: /^no — one item, one price/i })
				.textContent,
		).toMatch(single);
		expect(
			screen.getByRole("button", { name: /^they describe it, you quote/i })
				.textContent,
		).toMatch(quote);
	});
});

describe("step 4 — the stock question in each trade's words", () => {
	it("a service is asked how many it can take — never 'made fresh'", () => {
		renderAt(atPreparation("service"));
		expect(screen.getByText("How many can you take?")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: /^take every order/i }),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: /^limit how many/i }),
		).toBeTruthy();
		expect(screen.queryByText(/made fresh/i)).toBeNull();
	});

	it("goods are 'made when ordered', food keeps 'made fresh'", () => {
		renderAt(atPreparation("physical"));
		expect(
			screen.getByRole("button", { name: /^made when ordered/i }),
		).toBeTruthy();
		expect(screen.queryByText(/^made fresh$/i)).toBeNull();
		cleanup();
		renderAt(atPreparation("food"));
		expect(screen.getByText("How do you prepare orders?")).toBeTruthy();
		expect(screen.getByRole("button", { name: /^made fresh/i })).toBeTruthy();
	});
});

describe("Review repeats step 4 in the same words (z8r3fdxt99 hands-on test)", () => {
	/** Every question answered — the wizard reopens on Review. */
	const answered = (kindCard: KindCard): WizardState => ({
		...atPreparation(kindCard),
		editor: {
			options: [],
			rows: [{ ...emptyRow([]), price: "20", blockWhenOutOfStock: false }],
			customLine: null,
		},
		fulfilmentAnswered: true,
	});

	it("a service reviews as 'Take every order' under 'Limits' — never 'Made fresh'", () => {
		renderAt(answered("service"));
		expect(screen.getByText("Ready to publish?")).toBeTruthy();
		expect(screen.getByText("Limits")).toBeTruthy();
		// The preview chip and the summary row both carry the step's answer.
		expect(screen.getAllByText("Take every order")).toHaveLength(2);
		expect(screen.queryByText("Made fresh")).toBeNull();
		expect(screen.queryByText("Preparing")).toBeNull();
	});

	it("goods review as 'Made when ordered'; food keeps 'Made fresh'", () => {
		renderAt(answered("physical"));
		expect(screen.getAllByText("Made when ordered")).toHaveLength(2);
		expect(screen.getByText("Preparing")).toBeTruthy();
		cleanup();
		renderAt(answered("food"));
		expect(screen.getAllByText("Made fresh")).toHaveLength(2);
	});

	it("a service's step 4 header says Limits, not Preparation", () => {
		renderAt(atPreparation("service"));
		expect(screen.getByRole("heading", { name: "Limits" })).toBeTruthy();
		expect(screen.queryByText("Preparation")).toBeNull();
	});

	it("a service's quote card asks for approval, not a mockup", () => {
		renderAt(atChoices("service"));
		const quote = screen.getByRole("button", {
			name: /^they describe it, you quote/i,
		});
		expect(quote.textContent).toMatch(/approve before you start/i);
		expect(quote.textContent).not.toMatch(/mockup/i);
	});

	it("the prep-time pointer uses the trade's verb", () => {
		renderAt(atPreparation("service"));
		fireEvent.click(screen.getByRole("button", { name: /^take every order/i }));
		expect(screen.getByText(/if each one takes time to do/i)).toBeTruthy();
		cleanup();
		renderAt(atPreparation("food"));
		fireEvent.click(screen.getByRole("button", { name: /^made fresh/i }));
		expect(screen.getByText(/if each one takes time to make/i)).toBeTruthy();
	});
});
