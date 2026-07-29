import { describe, expect, it } from "vitest";
import type { ProductFormDraft } from "./product-form";
import {
	buildWizardSubmitValues,
	emptyWizardState,
	formDraftToWizardState,
	skuConflictTarget,
	type WizardState,
	wizardHandoff,
	wizardInitialStep,
	wizardPriceLabel,
	wizardStepIssues,
} from "./product-wizard";
import { rebuildRows, type VariantRow } from "./variant-editor";

function row(partial: Partial<VariantRow> = {}): VariantRow {
	return {
		optionValues: [],
		sku: "",
		price: "",
		stock: "",
		active: true,
		blockWhenOutOfStock: true,
		requiresProof: false,
		imageStorageIds: [],
		...partial,
	};
}

/** A fully answered "brownies, S/M/L, made to order" wizard — the ICP case. */
function browniesState(): WizardState {
	return {
		...emptyWizardState(),
		name: "Chocolate fudge brownies",
		hasChoices: true,
		fulfilmentAnswered: true,
		editor: {
			options: [{ name: "Size", values: ["Small", "Medium", "Large"] }],
			rows: [
				row({
					optionValues: ["Small"],
					price: "12",
					blockWhenOutOfStock: false,
				}),
				row({
					optionValues: ["Medium"],
					price: "18.00",
					blockWhenOutOfStock: false,
				}),
				row({
					optionValues: ["Large"],
					price: "28.5",
					blockWhenOutOfStock: false,
				}),
			],
			customLine: null,
		},
	};
}

/** One fixed item sold from stock. */
function singleFromStock(): WizardState {
	return {
		...emptyWizardState(),
		name: "Nasi lemak bungkus",
		hasChoices: false,
		fulfilmentAnswered: true,
		editor: {
			options: [],
			rows: [row({ price: "5.50", stock: "20" })],
			customLine: null,
		},
	};
}

describe("wizardStepIssues", () => {
	it("step 1 requires a name", () => {
		expect(wizardStepIssues(emptyWizardState(), 1)).toHaveLength(1);
		expect(wizardStepIssues(browniesState(), 1)).toHaveLength(0);
	});

	it("step 2 requires the question answered, then a named axis with values", () => {
		expect(wizardStepIssues(emptyWizardState(), 2).map((i) => i.field)).toEqual(
			["hasChoices"],
		);
		const s = browniesState();
		const broken: WizardState = {
			...s,
			editor: {
				...s.editor,
				options: [{ name: " ", values: [] }],
				rows: [],
			},
		};
		expect(
			wizardStepIssues(broken, 2)
				.map((i) => i.field)
				.sort(),
		).toEqual(["axisName", "axisValues"]);
		// "Just one item" skips choice setup entirely.
		expect(wizardStepIssues({ ...singleFromStock() }, 2)).toHaveLength(0);
	});

	it("step 2 addresses second-axis problems to the axis-2 fields", () => {
		const s = browniesState();
		const withEmptySecond: WizardState = {
			...s,
			editor: {
				...s.editor,
				options: [...s.editor.options, { name: "", values: [] }],
			},
		};
		expect(
			wizardStepIssues(withEmptySecond, 2)
				.map((i) => i.field)
				.sort(),
		).toEqual(["axis2Name", "axis2Values"]);
	});

	it("step 2 caps the combinations at the shared 50-variant limit", () => {
		const s = browniesState();
		const big: WizardState = {
			...s,
			editor: {
				...s.editor,
				options: [
					{
						name: "Size",
						values: Array.from({ length: 8 }, (_, i) => `s${i}`),
					},
					{
						name: "Flavour",
						values: Array.from({ length: 7 }, (_, i) => `f${i}`),
					},
				],
			},
		};
		expect(wizardStepIssues(big, 2).some((i) => i.field === "axisValues")).toBe(
			true,
		);
	});

	it("step 3 validates every active choice's price via the shared validator", () => {
		const s = browniesState();
		const broken: WizardState = {
			...s,
			editor: {
				...s.editor,
				rows: [
					{ ...s.editor.rows[0] },
					{ ...s.editor.rows[1], price: "" },
					{ ...s.editor.rows[2], price: "abc" },
				],
			},
		};
		expect(
			wizardStepIssues(broken, 3)
				.map((i) => i.field)
				.sort(),
		).toEqual(["price:Large", "price:Medium"]);
		// A deactivated choice never blocks (same rule as the full form).
		const offRow: WizardState = {
			...s,
			editor: {
				...s.editor,
				rows: [
					{ ...s.editor.rows[0] },
					{ ...s.editor.rows[1], price: "", active: false },
					{ ...s.editor.rows[2] },
				],
			},
		};
		expect(wizardStepIssues(offRow, 3)).toHaveLength(0);
	});

	it("step 4 requires stock only for tracking rows", () => {
		// Made to order → no stock questions at all.
		expect(wizardStepIssues(browniesState(), 4)).toHaveLength(0);
		const s = browniesState();
		const mixed: WizardState = {
			...s,
			editor: {
				...s.editor,
				rows: s.editor.rows.map((r, i) => ({
					...r,
					blockWhenOutOfStock: i === 0, // only Small tracks stock
					stock: "",
				})),
			},
		};
		expect(wizardStepIssues(mixed, 4).map((i) => i.field)).toEqual([
			"stock:Small",
		]);
		// Unanswered structural question surfaces as its own issue.
		expect(
			wizardStepIssues({ ...s, fulfilmentAnswered: false }, 4).map(
				(i) => i.field,
			),
		).toEqual(["fulfilment"]);
	});

	it("step 5 validates custom price and order rules, allowing blanks", () => {
		const base = browniesState();
		expect(wizardStepIssues(base, 5)).toHaveLength(0);
		const withBadCustom: WizardState = {
			...base,
			editor: {
				...base.editor,
				customLine: {
					label: "",
					price: "abc",
					prompt: "",
					imageStorageIds: [],
				},
			},
		};
		expect(wizardStepIssues(withBadCustom, 5).map((i) => i.field)).toEqual([
			"customPrice",
		]);
		expect(
			wizardStepIssues({ ...base, minQuantity: "1" }, 5).map((i) => i.field),
		).toEqual(["minQuantity"]);
		expect(
			wizardStepIssues({ ...base, minNoticeDays: "31" }, 5).map((i) => i.field),
		).toEqual(["minNoticeDays"]);
		expect(
			wizardStepIssues({ ...base, minQuantity: "20", minNoticeDays: "0" }, 5),
		).toHaveLength(0);
	});
});

describe("buildWizardSubmitValues", () => {
	it("maps the choices branch through the SHARED buildSubmitVariants", () => {
		const values = buildWizardSubmitValues(browniesState());
		expect(values.options).toEqual([
			{ name: "Size", values: ["Small", "Medium", "Large"] },
		]);
		expect(values.variants).toHaveLength(3);
		expect(values.variants[0]).toMatchObject({
			optionValues: ["Small"],
			price: 1200,
			onHand: 0,
			active: true,
			blockWhenOutOfStock: false,
			requiresProof: false,
		});
		expect(values.variants[2].price).toBe(2850);
		expect(values.hidden).toBe(false);
		expect(values.categoryIds).toEqual([]);
	});

	it("maps the one-item branch onto zero axes and a single implicit variant", () => {
		const values = buildWizardSubmitValues(singleFromStock());
		expect(values.options).toEqual([]);
		expect(values.variants).toEqual([
			{
				optionValues: [],
				sku: undefined,
				price: 550,
				onHand: 20,
				active: true,
				blockWhenOutOfStock: true,
				requiresProof: false,
				imageStorageIds: [],
			},
		]);
	});

	it("carries per-choice extras: SKU, photo, on/off, approval and the custom line", () => {
		const s = browniesState();
		const decked: WizardState = {
			...s,
			editor: {
				options: s.editor.options,
				rows: [
					{
						...s.editor.rows[0],
						sku: " BRN-S ",
						imageStorageIds: ["img1"],
						requiresProof: true,
					},
					{ ...s.editor.rows[1], active: false },
					{ ...s.editor.rows[2] },
				],
				customLine: {
					label: " Bespoke cake ",
					price: "150.5",
					prompt: "Theme?",
					imageStorageIds: ["img2"],
				},
			},
		};
		const values = buildWizardSubmitValues(decked);
		expect(values.variants).toHaveLength(4);
		expect(values.variants[0]).toMatchObject({
			sku: "BRN-S",
			imageStorageIds: ["img1"],
			requiresProof: true,
		});
		expect(values.variants[1].active).toBe(false);
		expect(values.variants[3]).toMatchObject({
			isCustom: true,
			customLabel: "Bespoke cake",
			customPrompt: "Theme?",
			price: 15050,
			imageStorageIds: ["img2"],
			blockWhenOutOfStock: false,
			requiresProof: true,
		});
	});

	it("carries the order rules, leaving blanks unset", () => {
		const withRules = buildWizardSubmitValues({
			...browniesState(),
			minQuantity: "20",
			minNoticeDays: "3",
		});
		expect(withRules.minQuantity).toBe(20);
		expect(withRules.minNoticeDays).toBe(3);
		const noRules = buildWizardSubmitValues(browniesState());
		expect(noRules.minQuantity).toBeUndefined();
		expect(noRules.minNoticeDays).toBeUndefined();
	});

	it("carries the review-step publish settings (hidden + categories)", () => {
		const values = buildWizardSubmitValues({
			...singleFromStock(),
			hidden: true,
			categoryIds: ["cat1", "cat2"] as never,
		});
		expect(values.hidden).toBe(true);
		expect(values.categoryIds).toEqual(["cat1", "cat2"]);
	});
});

describe("wizard ⇄ full form (shared substrate)", () => {
	it("hands the editor substrate to the full form AS-IS — lossless", () => {
		const s = browniesState();
		const handoff = wizardHandoff({
			...s,
			images: [{ id: "st1", url: "blob:preview-1" }],
			minQuantity: "20",
		});
		// The editor is the SAME object — strings, flags, photos, everything.
		expect(handoff.initialEditor).toBe(s.editor);
		expect(handoff.initialValues.name).toBe("Chocolate fudge brownies");
		expect(handoff.initialValues.imageStorageIds).toEqual(["st1"]);
		expect(handoff.initialValues.minQuantity).toBe(20);
	});

	it("restores a form draft into the wizard AS-IS — no lost list, ever", () => {
		const draft: ProductFormDraft = {
			name: "Brownies",
			description: "Fudgy",
			hidden: true,
			categoryIds: [],
			images: [{ id: "st1", url: "blob:p1" }],
			editor: {
				options: [
					{ name: "Size", values: ["S", "M"] },
					{ name: "Flavour", values: ["Pandan"] },
				],
				rows: [
					row({
						optionValues: ["S", "Pandan"],
						price: "12",
						imageStorageIds: ["img1"],
						blockWhenOutOfStock: false,
					}),
					row({ optionValues: ["M", "Pandan"], price: "", active: false }),
				],
				customLine: {
					label: "Bespoke",
					price: "",
					prompt: "",
					imageStorageIds: ["img2"],
				},
			},
			minQuantity: "20",
			minNoticeDays: "3",
		};
		const state = formDraftToWizardState(draft);
		// Substrate passes straight through — second axis, photos, deactivated
		// rows, mixed fulfilment, custom photo all intact.
		expect(state.editor).toBe(draft.editor);
		expect(state.hasChoices).toBe(true);
		expect(state.fulfilmentAnswered).toBe(true);
		expect(state.hidden).toBe(true);
		expect(state.minQuantity).toBe("20");
	});

	it("round-trips wizard → form → wizard with identical state", () => {
		const s = browniesState();
		const handoff = wizardHandoff(s);
		const draft: ProductFormDraft = {
			name: handoff.initialValues.name ?? "",
			description: handoff.initialValues.description ?? "",
			hidden: handoff.initialValues.hidden ?? false,
			categoryIds: handoff.initialValues.categoryIds ?? [],
			images: [],
			editor: handoff.initialEditor,
			minQuantity: "",
			minNoticeDays: "",
		};
		const back = formDraftToWizardState(draft);
		expect(back.editor).toEqual(s.editor);
		expect(back.name).toBe(s.name);
		expect(back.hasChoices).toBe(true);
	});
});

describe("switching to choices keeps the seller's work (PR #108 review)", () => {
	it("preserves price + Made-to-order through the empty-axis moment", () => {
		// The seller's path in the wizard: step 3 price, step 4 "Made to order",
		// then back to step 2 and re-toggle "Buyer picks a choice" → preset.
		const typed: WizardState = {
			...emptyWizardState(),
			name: "Brownies",
			hasChoices: false,
			fulfilmentAnswered: true,
			editor: {
				options: [],
				rows: [row({ price: "12", blockWhenOutOfStock: false })],
				customLine: null,
			},
		};
		// Re-toggle → an axis with no values yet.
		const emptyAxis = rebuildRows(
			[{ name: "", values: [] }],
			typed.editor.rows,
		);
		expect(emptyAxis).toBe(typed.editor.rows);
		// Tap the "Size" preset → the grid inherits price AND fulfilment.
		const grid = rebuildRows(
			[{ name: "Size", values: ["Small", "Medium", "Large"] }],
			emptyAxis,
		);
		expect(grid.map((r) => r.price)).toEqual(["12", "12", "12"]);
		expect(grid.map((r) => r.blockWhenOutOfStock)).toEqual([
			false,
			false,
			false,
		]);
		// And the resulting product is made-to-order, not stock-tracked-at-zero.
		const values = buildWizardSubmitValues({
			...typed,
			hasChoices: true,
			editor: {
				options: [{ name: "Size", values: ["Small", "Medium", "Large"] }],
				rows: grid,
				customLine: null,
			},
		});
		expect(values.variants.every((v) => !v.blockWhenOutOfStock)).toBe(true);
		expect(values.variants.every((v) => v.price === 1200)).toBe(true);
	});

	it("holds row validation until the axis actually has values", () => {
		const midAuthoring: WizardState = {
			...browniesState(),
			editor: {
				...browniesState().editor,
				options: [{ name: "Size", values: [] }],
			},
		};
		// Step 2 reports the actionable problem…
		expect(wizardStepIssues(midAuthoring, 2).map((i) => i.field)).toEqual([
			"axisValues",
		]);
		// …and steps 3/4 stay quiet rather than flagging invisible rows.
		expect(wizardStepIssues(midAuthoring, 3)).toHaveLength(0);
		expect(wizardStepIssues(midAuthoring, 4)).toHaveLength(0);
	});
});

describe("skuConflictTarget", () => {
	const rows = [
		row({ optionValues: ["Small"], sku: "BRN-S" }),
		row({ optionValues: ["Medium"], sku: "BRN-M" }),
	];

	it("points a server SKU rejection at the row that owns the code", () => {
		expect(
			skuConflictTarget('SKU "BRN-M" is already used by another variant', rows),
		).toEqual({ key: "Medium", sku: "BRN-M" });
		expect(
			skuConflictTarget('Duplicate SKU "BRN-S" within this product', rows),
		).toEqual({ key: "Small", sku: "BRN-S" });
	});

	it("returns null when the message names no SKU or an unknown one", () => {
		expect(skuConflictTarget("Rate limit exceeded", rows)).toBeNull();
		expect(
			skuConflictTarget('SKU "OTHER" is already used by another variant', rows),
		).toBeNull();
	});
});

describe("wizardInitialStep", () => {
	it("opens a fully answered draft at review", () => {
		expect(wizardInitialStep(browniesState())).toBe(5);
	});

	it("opens at the first unanswered / invalid step", () => {
		expect(wizardInitialStep({ ...browniesState(), name: "" })).toBe(1);
		expect(wizardInitialStep({ ...browniesState(), hasChoices: null })).toBe(2);
		const s = browniesState();
		expect(
			wizardInitialStep({
				...s,
				editor: {
					...s.editor,
					rows: s.editor.rows.map((r) => ({ ...r, price: "" })),
				},
			}),
		).toBe(3);
		expect(wizardInitialStep({ ...s, fulfilmentAnswered: false })).toBe(4);
	});
});

describe("wizardPriceLabel", () => {
	it("shows a single price or a range, dropping trailing .00", () => {
		expect(wizardPriceLabel(singleFromStock(), "RM")).toBe("RM 5.50");
		expect(wizardPriceLabel(browniesState(), "RM")).toBe("RM 12–28.50");
		const s = browniesState();
		expect(
			wizardPriceLabel(
				{
					...s,
					editor: {
						...s.editor,
						rows: s.editor.rows.map((r) => ({ ...r, price: "18.00" })),
					},
				},
				"RM",
			),
		).toBe("RM 18");
	});

	it("ignores deactivated choices", () => {
		const s = browniesState();
		expect(
			wizardPriceLabel(
				{
					...s,
					editor: {
						...s.editor,
						rows: [
							{ ...s.editor.rows[0] },
							{ ...s.editor.rows[1], active: false, price: "99" },
							{ ...s.editor.rows[2] },
						],
					},
				},
				"RM",
			),
		).toBe("RM 12–28.50");
	});
});
