// @vitest-environment jsdom
/**
 * Component-level cover for ClickUp 86eyex5vk AC #3/#4b — the "Add value"
 * blur-commit landing in the SAME gesture as the tap that ends the choices
 * mode. On Android the blur path is load-bearing (soft keyboards don't fire a
 * reliable Enter keydown), which is the suspected trigger for the reported
 * `Expected 1 variants for these options, got 2`.
 *
 * The pure-reducer tests can't reach this: the ordering depends on real DOM
 * event dispatch and React's batching, so it has to be driven through the
 * actual component.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));

import { cartesian, type OptionAxis } from "../../lib/variant";
import { buildSubmitVariants } from "./product-form";
import {
	reconcileForSubmit,
	VariantEditor,
	type VariantEditorState,
} from "./variant-editor";

afterEach(cleanup);

// switchToSingle confirms before discarding a priced grid. jsdom has no
// confirm() — it logs "Not implemented" and returns undefined, so the handler
// would early-return and these tests would pass without switching anything.
beforeEach(() => {
	vi.stubGlobal(
		"confirm",
		vi.fn(() => true),
	);
});

function Harness({
	initial,
	onState,
}: {
	initial: VariantEditorState;
	onState: (s: VariantEditorState) => void;
}) {
	const [state, setState] = useState(initial);
	return (
		<VariantEditor
			value={state}
			onChange={(next) => {
				setState(next);
				onState(next);
			}}
			currency="RM"
		/>
	);
}

/** The server's check, mirrored — see convex/products.ts validateVariantSet. */
function serverAccepts(
	options: OptionAxis[],
	rows: VariantEditorState["rows"],
) {
	const reconciled = reconcileForSubmit(options, rows);
	const built = buildSubmitVariants(reconciled.rows, null);
	const variants = "variants" in built ? built.variants : [];
	const matrix = variants.filter((v) => !v.isCustom);
	// An unpriced rebuilt row yields issues instead of variants — that's the
	// seller-fixable path, not a dead end, so treat it as "not a server reject".
	if (!("variants" in built)) return true;
	return matrix.length === cartesian(reconciled.options).length;
}

const withOptions: VariantEditorState = {
	options: [{ name: "Size", values: ["S", "M"] }],
	rows: ["S", "M"].map((v) => ({
		optionValues: [v],
		sku: "",
		price: "10",
		stock: "3",
		active: true,
		blockWhenOutOfStock: true,
		requiresProof: false,
		imageStorageIds: [],
	})),
	customLine: null,
};

describe("Add-value blur committing in the same gesture as a mode switch", () => {
	it("never leaves a grid the server would reject", () => {
		let latest: VariantEditorState = withOptions;
		render(<Harness initial={withOptions} onState={(s) => (latest = s)} />);

		// Seller types a third value but never presses Enter…
		const draft = screen.getByPlaceholderText("Add value");
		fireEvent.change(draft, { target: { value: "L" } });

		// …then taps "Just one item". Blur fires first (real DOM ordering), so
		// addValue commits, and the click's handler reads the pre-blur closure.
		fireEvent.blur(draft);
		fireEvent.click(screen.getByRole("button", { name: /just one item/i }));

		// Guard: the switch must actually have happened, or this asserts nothing.
		expect(latest.options).toEqual([]);
		expect(serverAccepts(latest.options, latest.rows)).toBe(true);
	});

	it("survives the reverse order — click handled before the pending blur", () => {
		// Some mobile browsers dispatch the tap before focusout resolves.
		// NOTE: this file is regression cover, not proof of the fix — under
		// jsdom's event ordering React batches both writes into a consistent
		// state, so these pass with or without reconcileForSubmit. They exist to
		// fail if someone reintroduces a split write (options and rows updated
		// from different closures) in the mode-switch handlers.
		let latest: VariantEditorState = withOptions;
		render(<Harness initial={withOptions} onState={(s) => (latest = s)} />);

		const draft = screen.getByPlaceholderText("Add value");
		fireEvent.change(draft, { target: { value: "L" } });
		fireEvent.click(screen.getByRole("button", { name: /just one item/i }));
		fireEvent.blur(draft);

		expect(serverAccepts(latest.options, latest.rows)).toBe(true);
	});

	it("keeps the payload consistent when the blur lands after the switch", () => {
		// The state this ticket is about: the mode switch commits (options: []),
		// then the pending blur re-adds an axis from a stale closure. Whatever
		// the two writes leave behind, the submitted payload must still describe
		// ONE product — that's what reconcileForSubmit guarantees.
		let latest: VariantEditorState = withOptions;
		render(<Harness initial={withOptions} onState={(s) => (latest = s)} />);

		const draft = screen.getByPlaceholderText("Add value");
		fireEvent.change(draft, { target: { value: "L" } });
		fireEvent.click(screen.getByRole("button", { name: /just one item/i }));
		fireEvent.blur(draft);

		const reconciled = reconcileForSubmit(latest.options, latest.rows);
		expect(reconciled.rows).toHaveLength(
			cartesian(reconciled.options).length || reconciled.rows.length,
		);
		expect(serverAccepts(latest.options, latest.rows)).toBe(true);
	});

	it("commits a blurred draft value into a consistent grid", () => {
		// The happy path the blur handler exists for: Android soft keyboard, no
		// Enter keydown, value locked in by focus loss.
		let latest: VariantEditorState = withOptions;
		render(<Harness initial={withOptions} onState={(s) => (latest = s)} />);

		const draft = screen.getByPlaceholderText("Add value");
		fireEvent.change(draft, { target: { value: "L" } });
		fireEvent.blur(draft);

		expect(latest.options[0].values).toEqual(["S", "M", "L"]);
		expect(latest.rows).toHaveLength(3);
		expect(serverAccepts(latest.options, latest.rows)).toBe(true);
	});
});
