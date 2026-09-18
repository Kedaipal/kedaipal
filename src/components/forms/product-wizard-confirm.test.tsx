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
