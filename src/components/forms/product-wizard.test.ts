import { describe, expect, it } from "vitest";
import {
	buildWizardSubmitValues,
	emptyWizardState,
	type WizardState,
	wizardPriceLabel,
	wizardStepIssues,
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
		// Wizard never sets the advanced dimensions.
		expect(values.hidden).toBe(false);
		expect(values.categoryIds).toEqual([]);
	});

	it("maps the one-item branch onto zero axes and a single implicit variant", () => {
		const values = buildWizardSubmitValues(singleFromStock());
		expect(values.options).toEqual([]);
		expect(values.variants).toEqual([
			{
				optionValues: [],
				price: 550,
				onHand: 20,
				active: true,
				blockWhenOutOfStock: true, // from stock
				requiresProof: false,
				imageStorageIds: [],
			},
		]);
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
