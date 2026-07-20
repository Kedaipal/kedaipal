import { describe, expect, it } from "vitest";
import {
	buildWizardSubmitValues,
	emptyWizardState,
	type WizardState,
	wizardPriceLabel,
	wizardStepIssues,
	wizardToFormInitialValues,
} from "./product-wizard";

/** A fully answered "brownies, S/M/L, made to order" wizard — the ICP case. */
function browniesState(): WizardState {
	return {
		...emptyWizardState(),
		name: "Chocolate fudge brownies",
		hasChoices: true,
		axisName: "Size",
		axisValues: ["Small", "Medium", "Large"],
		prices: { Small: "12", Medium: "18.00", Large: "28.5" },
		madeToOrder: true,
	};
}

/** One fixed item sold from stock. */
function singleFromStock(): WizardState {
	return {
		...emptyWizardState(),
		name: "Nasi lemak bungkus",
		hasChoices: false,
		prices: { "": "5.50" },
		madeToOrder: false,
		stocks: { "": "20" },
	};
}

describe("wizardStepIssues", () => {
	it("step 1 requires a name", () => {
		expect(wizardStepIssues(emptyWizardState(), 1)).toHaveLength(1);
		expect(wizardStepIssues(browniesState(), 1)).toHaveLength(0);
	});

	it("step 2 requires an axis name and at least one choice when the buyer picks", () => {
		const s = { ...browniesState(), axisName: " ", axisValues: [] };
		const issues = wizardStepIssues(s, 2);
		expect(issues.map((i) => i.field).sort()).toEqual([
			"axisName",
			"axisValues",
		]);
		// "Just one item" skips choice setup entirely.
		expect(
			wizardStepIssues({ ...s, hasChoices: false }, 2),
		).toHaveLength(0);
	});

	it("step 2 caps the wizard at 50 choices (server variant cap, one axis)", () => {
		const s = {
			...browniesState(),
			axisValues: Array.from({ length: 51 }, (_, i) => `v${i}`),
		};
		expect(wizardStepIssues(s, 2).some((i) => i.field === "axisValues")).toBe(
			true,
		);
	});

	it("step 3 validates every choice's price and addresses the exact field", () => {
		const s = {
			...browniesState(),
			prices: { Small: "12", Medium: "", Large: "abc" },
		};
		const issues = wizardStepIssues(s, 3);
		expect(issues.map((i) => i.field).sort()).toEqual([
			"price:Large",
			"price:Medium",
		]);
	});

	it("step 4 requires stock counts only for From stock", () => {
		// Made to order → no stock questions at all.
		expect(wizardStepIssues(browniesState(), 4)).toHaveLength(0);
		const fromStock: WizardState = {
			...browniesState(),
			madeToOrder: false,
			stocks: { Small: "3" },
		};
		const issues = wizardStepIssues(fromStock, 4);
		expect(issues.map((i) => i.field).sort()).toEqual([
			"stock:Large",
			"stock:Medium",
		]);
		// 0 is a valid answer ("sold out right now").
		expect(
			wizardStepIssues(
				{ ...fromStock, stocks: { Small: "3", Medium: "0", Large: "0" } },
				4,
			),
		).toHaveLength(0);
	});
});

describe("buildWizardSubmitValues", () => {
	it("maps the choices branch onto one option axis with per-value variants", () => {
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
			blockWhenOutOfStock: false, // made to order
			requiresProof: false,
		});
		// Prices round to integer sen.
		expect(values.variants[2].price).toBe(2850);
		// Untouched publish settings keep their defaults.
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
				blockWhenOutOfStock: true, // from stock
				requiresProof: false,
				imageStorageIds: [],
			},
		]);
	});

	it("carries optional SKUs per choice, trimming and dropping blanks", () => {
		const values = buildWizardSubmitValues({
			...browniesState(),
			skus: { Small: " BRN-S ", Medium: "", Large: "  " },
		});
		expect(values.variants.map((v) => v.sku)).toEqual([
			"BRN-S",
			undefined,
			undefined,
		]);
	});

	it("carries the review-step publish settings (hidden + categories)", () => {
		const values = buildWizardSubmitValues({
			...singleFromStock(),
			hidden: true,
			categoryIds: ["cat1", "cat2"] as never,
		});
		// Counter-only products are created hidden directly — no create-then-edit
		// round trip (docs/hidden-products.md).
		expect(values.hidden).toBe(true);
		expect(values.categoryIds).toEqual(["cat1", "cat2"]);
	});

	it("applies mockup approval only when the product is made to order", () => {
		const mto = buildWizardSubmitValues({
			...browniesState(),
			requiresProof: true,
		});
		expect(mto.variants.every((v) => v.requiresProof)).toBe(true);
		// Flipping back to From stock at review quietly drops the flag.
		const fromStock = buildWizardSubmitValues({
			...singleFromStock(),
			requiresProof: true,
		});
		expect(fromStock.variants.every((v) => !v.requiresProof)).toBe(true);
	});

	it("appends the custom line as a flagged made-to-order variant", () => {
		const values = buildWizardSubmitValues({
			...browniesState(),
			customLine: { label: " Bespoke cake ", price: "", prompt: "Theme?" },
		});
		expect(values.variants).toHaveLength(4);
		const custom = values.variants[3];
		expect(custom).toMatchObject({
			isCustom: true,
			customLabel: "Bespoke cake",
			customPrompt: "Theme?",
			price: 0, // blank = "Price on quote"
			blockWhenOutOfStock: false,
			requiresProof: true,
		});
		// A typed price rounds to sen like the full form.
		const priced = buildWizardSubmitValues({
			...browniesState(),
			customLine: { label: "", price: "150.5", prompt: "" },
		});
		expect(priced.variants[3].price).toBe(15050);
		expect(priced.variants[3].customLabel).toBeUndefined();
	});

	it("step 5 validates only a non-blank invalid custom price", () => {
		const base = browniesState();
		expect(wizardStepIssues(base, 5)).toHaveLength(0);
		expect(
			wizardStepIssues(
				{ ...base, customLine: { label: "", price: "", prompt: "" } },
				5,
			),
		).toHaveLength(0);
		expect(
			wizardStepIssues(
				{ ...base, customLine: { label: "", price: "abc", prompt: "" } },
				5,
			).map((i) => i.field),
		).toEqual(["customPrice"]);
	});

	it("trims the name and drops a blank description", () => {
		const values = buildWizardSubmitValues({
			...singleFromStock(),
			name: "  Nasi lemak  ",
			description: "   ",
		});
		expect(values.name).toBe("Nasi lemak");
		expect(values.description).toBeUndefined();
	});
});

describe("wizardToFormInitialValues (open-in-full-editor handoff)", () => {
	it("prefills the full form with the wizard draft, image previews included", () => {
		const state: WizardState = {
			...browniesState(),
			images: [{ id: "st1", url: "blob:preview-1" }],
		};
		const initial = wizardToFormInitialValues(state);
		expect(initial.name).toBe("Chocolate fudge brownies");
		expect(initial.options).toEqual([
			{ name: "Size", values: ["Small", "Medium", "Large"] },
		]);
		// Prices arrive in sen — the form's initialEditorState divides by 100.
		expect(initial.variants?.map((v) => v.price)).toEqual([1200, 1800, 2850]);
		expect(initial.imageStorageIds).toEqual(["st1"]);
		expect(initial.imageUrls).toEqual(["blob:preview-1"]);
	});
});

describe("wizardPriceLabel", () => {
	it("shows a single price or a range, dropping trailing .00", () => {
		expect(wizardPriceLabel(singleFromStock(), "RM")).toBe("RM 5.50");
		expect(wizardPriceLabel(browniesState(), "RM")).toBe("RM 12–28.50");
		expect(
			wizardPriceLabel(
				{ ...browniesState(), prices: { Small: "18", Medium: "18", Large: "18.00" } },
				"RM",
			),
		).toBe("RM 18");
	});
});
