// @vitest-environment jsdom
/**
 * The wizard asks its destructive questions in the HOUSE dialog.
 *
 * Both were `window.confirm`: unstyled, theme-blind, and blocking — driving the
 * wizard in a browser froze the page for as long as the native dialog stood
 * (found in the z8r3fdff97 test round). These pin that the question is a real
 * dialog, that answering No changes nothing, and that Yes still does the thing.
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

/** A draft with a typed name — enough to make the wizard dirty. */
function dirtyDraft(overrides: Partial<WizardState> = {}): WizardState {
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
		...overrides,
	};
}

function renderWizard(state: WizardState, onExit: () => void) {
	return render(
		<ProductWizard
			retailerId={"r1" as never}
			categoriesLocked={false}
			currency="RM"
			onSubmit={vi.fn()}
			onSkipToFullForm={vi.fn()}
			onOpenFullForm={vi.fn()}
			onExit={onExit}
			initialState={state}
		/>,
	);
}

const discard = () =>
	fireEvent.click(screen.getByRole("button", { name: /cancel and discard/i }));

/** A draft on the type step with choices AND typed prices — the state the
 * switch guard exists for. */
function draftWithPricedChoices(): WizardState {
	return {
		...dirtyDraft(),
		shape: "choices",
		editor: {
			options: [{ name: "Size", values: ["S", "M"] }],
			rows: [
				{ ...emptyRow(["S"]), price: "18" },
				{ ...emptyRow(["M"]), price: "18" },
			],
			customLine: null,
		},
	};
}

describe("wizard — switching product type away from priced choices", () => {
	/** An answered draft opens on Review — walk back to the Type question. */
	const goToTypeStep = () => {
		for (let i = 0; i < 8; i++) {
			if (screen.queryByText("What kind of product is it?")) return;
			fireEvent.click(screen.getByRole("button", { name: /previous step/i }));
		}
		throw new Error("never reached the type step");
	};
	const pickType = (re: RegExp) => {
		goToTypeStep();
		fireEvent.click(screen.getByRole("button", { name: re }));
	};

	it("asks before dropping them, and Cancel keeps the choices", () => {
		const nativeConfirm = vi.fn(() => true);
		vi.stubGlobal("confirm", nativeConfirm);
		renderWizard(draftWithPricedChoices(), vi.fn());

		pickType(/just one item/i);
		expect(screen.getByText("Change the product type?")).toBeTruthy();
		expect(
			screen.getByText("Your choices and their prices will be removed."),
		).toBeTruthy();
		expect(nativeConfirm).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(
			screen
				.getByRole("button", { name: /buyer picks a choice/i })
				.getAttribute("aria-pressed"),
		).toBe("true");
		vi.unstubAllGlobals();
	});

	it("Change type applies the switch it asked about", () => {
		renderWizard(draftWithPricedChoices(), vi.fn());

		pickType(/just one item/i);
		fireEvent.click(screen.getByRole("button", { name: "Change type" }));
		expect(
			screen
				.getByRole("button", { name: /just one item/i })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(screen.queryByText("Change the product type?")).toBeNull();
	});

	it("the same guard covers Made to order — the third switch", () => {
		// Each switch hands its body to `askBeforeLosingChoices`; this is the
		// one the browser round couldn't reach.
		renderWizard(draftWithPricedChoices(), vi.fn());

		pickType(/made to order/i);
		expect(screen.getByText("Change the product type?")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Change type" }));
		expect(
			screen
				.getByRole("button", { name: /made to order/i })
				.getAttribute("aria-pressed"),
		).toBe("true");
	});

	it("no question when there is nothing to lose", () => {
		// Choices, but no price typed into any of them.
		renderWizard(
			{
				...draftWithPricedChoices(),
				editor: {
					options: [{ name: "Size", values: ["S"] }],
					rows: [emptyRow(["S"])],
					customLine: null,
				},
			},
			vi.fn(),
		);

		pickType(/just one item/i);
		expect(screen.queryByText("Change the product type?")).toBeNull();
		expect(
			screen
				.getByRole("button", { name: /just one item/i })
				.getAttribute("aria-pressed"),
		).toBe("true");
	});
});

describe("wizard — discarding a draft", () => {
	it("asks in a dialog, and native confirm is never reached", () => {
		const nativeConfirm = vi.fn(() => true);
		vi.stubGlobal("confirm", nativeConfirm);
		const onExit = vi.fn();
		renderWizard(dirtyDraft(), onExit);

		discard();
		expect(screen.getByText("Discard this product?")).toBeTruthy();
		expect(
			screen.getByText(/Nothing has been saved — leaving loses the draft\./),
		).toBeTruthy();
		// The native dialog is what blocked the page; it must not be consulted.
		expect(nativeConfirm).not.toHaveBeenCalled();
		expect(onExit).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it("Cancel keeps the draft, Discard leaves", () => {
		const onExit = vi.fn();
		renderWizard(dirtyDraft(), onExit);

		discard();
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(screen.queryByText("Discard this product?")).toBeNull();
		expect(onExit).not.toHaveBeenCalled();

		discard();
		fireEvent.click(screen.getByRole("button", { name: "Discard" }));
		expect(onExit).toHaveBeenCalledTimes(1);
	});

	it("an untouched draft leaves without a question", () => {
		const onExit = vi.fn();
		renderWizard(dirtyDraft({ name: "" }), onExit);

		discard();
		expect(screen.queryByText("Discard this product?")).toBeNull();
		expect(onExit).toHaveBeenCalledTimes(1);
	});
});
