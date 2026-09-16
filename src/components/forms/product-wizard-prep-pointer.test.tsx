// @vitest-environment jsdom
/**
 * The wizard's Preparation step points at prep time (ClickUp `z8r3fdff97`).
 *
 * Found by walking the wizard: step 5 asks "How do you prepare orders?" and
 * only means stock policy, while the prep window — the thing a made-fresh
 * seller most needs — lives two screens later under a "More options"
 * disclosure on Review. A seller who answers "Made fresh" is exactly the one
 * who needs it, so that answer now says where it is.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("convex/react", () => ({
	useMutation: () => vi.fn(),
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: undefined, isPending: true }),
}));

import {
	emptyWizardState,
	ProductWizard,
	type WizardState,
} from "./product-wizard";
import { emptyRow } from "./variant-editor";

afterEach(cleanup);

/** A named draft sitting on the unanswered type question, food store. */
function atTypeStep(): WizardState {
	return {
		...emptyWizardState(),
		name: "Ice Cream Puff",
		description: "",
		images: [],
		kindCard: "food",
		shape: null,
		editor: { options: [], rows: [emptyRow([])], customLine: null },
		fulfilmentAnswered: false,
		hidden: false,
		categoryIds: [],
		minQuantity: "",
		minNoticeDays: "",
	};
}

function renderWizard(state: WizardState) {
	return render(
		<ProductWizard
			retailerId={"r1" as never}
			categoriesLocked={false}
			eventsLocked={false}
			currency="RM"
			onSubmit={vi.fn()}
			onSkipToFullForm={vi.fn()}
			onOpenFullForm={vi.fn()}
			onExit={vi.fn()}
			initialState={state}
		/>,
	);
}

describe("wizard — the Preparation step says where prep TIME lives", () => {
	it("answering 'Made fresh' names prep time and the step that holds it", () => {
		renderWizard(atTypeStep());
		// Type → Price → Preparation, the route a food seller actually walks.
		fireEvent.click(screen.getByRole("button", { name: /just one item/i }));
		fireEvent.click(screen.getByRole("button", { name: /continue/i }));
		const price = document.querySelector(
			'input[inputmode="decimal"], input[type="number"]',
		) as HTMLInputElement;
		fireEvent.change(price, { target: { value: "12" } });
		fireEvent.click(screen.getByRole("button", { name: /continue/i }));
		expect(screen.getByText(/How do you prepare orders\?/i)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /Made fresh/i }));
		const explainer = screen.getByText(/buyers can always order/i);
		expect(explainer.textContent).toMatch(/prep time/i);
		expect(explainer.textContent).toMatch(/More options/i);
	});
});
