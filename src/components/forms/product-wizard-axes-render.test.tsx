// @vitest-environment jsdom
/**
 * Regression cover for the PR #156 review finding (86eyex5vk).
 *
 * Validation reads the EDITOR ("validate whenever axes exist"), so the render
 * must too. While the axis block was still gated on the step-2 answer, the
 * divergent state this PR exists to survive — flag says "just one item" while
 * `editor.options` holds an axis — made step 2 raise an `axisName`/`axisValues`
 * issue against an input that was never mounted. The wizard has no generic
 * issue banner, so Continue silently did nothing, forever. That's the same
 * dead-end class the PR removes, moved one step earlier.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("convex/react", () => ({
	useQuery: () => undefined,
	useMutation: () => vi.fn(),
}));

import {
	ProductWizard,
	type WizardState,
	wizardStepIssues,
} from "./product-wizard";
import { emptyRow } from "./variant-editor";

afterEach(cleanup);

/** Flag and editor disagree — the state the reconcile exists to survive. */
function divergent(overrides: Partial<WizardState> = {}): WizardState {
	return {
		name: "Kuih lapis",
		description: "",
		images: [],
		shape: "single",
		editor: {
			options: [{ name: "", values: ["S"] }],
			rows: [{ ...emptyRow(["S"]), price: "10", stock: "5" }],
			customLine: null,
		},
		fulfilmentAnswered: true,
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

describe("wizard step 2 — axes render whenever they exist", () => {
	it("raises an axis issue in the divergent state (the precondition)", () => {
		// If this ever stops firing, the render assertions below prove nothing.
		expect(wizardStepIssues(divergent(), 2).map((i) => i.field)).toContain(
			"axisName",
		);
	});

	it("mounts the axis input the issue is addressed to, despite a single-item answer", () => {
		renderWizard(divergent());
		// Opens on step 2 (first step with an issue).
		expect(screen.getByText("What kind of product is it?")).toBeTruthy();
		// The offending input exists, so the message has somewhere to land and
		// the seller has a way out.
		expect(screen.getByPlaceholderText("Add a choice")).toBeTruthy();
		expect(screen.getByText("What do they choose by?")).toBeTruthy();
	});

	it("shows the issue on screen after Continue instead of doing nothing", () => {
		renderWizard(divergent());
		fireEvent.click(screen.getByRole("button", { name: /continue/i }));
		// Still on step 2, but now WITH a visible, actionable message.
		expect(screen.getByText("What kind of product is it?")).toBeTruthy();
		expect(screen.getByText(/Give this option a name/i)).toBeTruthy();
	});

	it("does not claim 'Just one item' while a grid exists", () => {
		renderWizard(divergent());
		// The toggle must describe the editor, not the stale flag — otherwise the
		// screen contradicts the payload that would be submitted.
		const single = screen.getByRole("button", { name: /just one item/i });
		const choices = screen.getByRole("button", {
			name: /buyer picks a choice/i,
		});
		expect(single.getAttribute("aria-pressed")).toBe("false");
		expect(choices.getAttribute("aria-pressed")).toBe("true");
	});

	it("still asks the question when the editor genuinely has no axes", () => {
		const fresh = divergent({
			shape: null,
			editor: { options: [], rows: [emptyRow([])], customLine: null },
		});
		renderWizard(fresh);
		expect(wizardStepIssues(fresh, 2).map((i) => i.field)).toContain(
			"shape",
		);
		// No axis block until the seller answers — the normal first-run path.
		expect(screen.queryByPlaceholderText("Add a choice")).toBeNull();
	});
});
