/**
 * Regression cover for ClickUp 86eyex5vk — "Expected 1 variants for these
 * options, got 2", a dead-end save with no field for the seller to fix.
 *
 * The invariant: whatever the client submits, `options` and `variants` describe
 * the SAME product — `rows.length === cartesian(options).length`. Every
 * in-editor path upheld it via `rebuildRows`; it was broken by state the editor
 * didn't derive (a seeded product, a wizard handoff) and by the wizard's
 * the step-2 answer acting as a second source of truth for "has axes".
 */
import { describe, expect, it } from "vitest";
import { normalizeOptions } from "../../../convex/lib/variant";
import { cartesian, type OptionAxis } from "../../lib/variant";
import { buildSubmitVariants } from "./product-form";
import {
	buildWizardSubmitValues,
	type WizardState,
	wizardStepIssues,
} from "./product-wizard";
import {
	emptyRow,
	reconcileForSubmit,
	sanitizeOptions,
	type VariantRow,
} from "./variant-editor";

function row(optionValues: string[], price = "12"): VariantRow {
	return { ...emptyRow(optionValues), price, stock: "5" };
}

/**
 * What `validateVariantSet` (convex/products.ts) does to a payload. Mirrored
 * here so a client-side regression fails in this file rather than at a seller's
 * save button.
 */
function serverRejects(
	options: OptionAxis[],
	variants: { optionValues: string[]; isCustom?: boolean }[],
): string | null {
	let normalized: OptionAxis[];
	try {
		normalized = normalizeOptions(options);
	} catch (err) {
		return (err as Error).message;
	}
	const matrix = variants.filter((v) => !v.isCustom);
	const expected = cartesian(normalized).length;
	return matrix.length === expected
		? null
		: `Expected ${expected} variants for these options, got ${matrix.length}`;
}

describe("sanitizeOptions", () => {
	it("drops blank values exactly like the server does", () => {
		// convex/lib/variant.ts filters `v.trim().length > 0`. Before this mirror
		// existed the client counted " " as a combination the server then dropped,
		// so `expected` shrank behind the grid's back.
		expect(
			sanitizeOptions([{ name: " Size ", values: ["S", "  ", " M "] }]),
		).toEqual([{ name: "Size", values: ["S", "M"] }]);
	});

	it("keeps a whitespace-only axis reportable rather than silently shrinking", () => {
		const sanitized = sanitizeOptions([{ name: "Size", values: ["   "] }]);
		// Empty values array → collectOptionIssues flags "add at least one value",
		// which is actionable, instead of the server throwing a count mismatch.
		expect(sanitized[0].values).toEqual([]);
	});
});

describe("reconcileForSubmit", () => {
	it("rebuilds a seeded grid whose stored options and variants disagree", () => {
		// The edit path seeds `options` and `rows` from storage with no
		// reconciliation between them. Such a product could never be saved again.
		const options = [{ name: "Size", values: ["S", "M"] }];
		const rows = [row([]), row([]), row([])]; // 3 rows describing no axes at all
		const out = reconcileForSubmit(options, rows);
		expect(out.rows).toHaveLength(cartesian(options).length);
		expect(out.rows.map((r) => r.optionValues)).toEqual([["S"], ["M"]]);
	});

	it("collapses a stale multi-row grid when the axes are gone", () => {
		const out = reconcileForSubmit([], [row(["S"]), row(["M"])]);
		expect(out.rows).toHaveLength(1);
		expect(out.rows[0].optionValues).toEqual([]);
	});

	it("surfaces a fixable price issue rather than saving a rebuilt blank row", () => {
		// Rebuilding can mint a combination the seller never priced. The seller
		// must get an inline, addressable issue — the whole point of the ticket is
		// that there is always a way to fix the form and save.
		const out = reconcileForSubmit([], [row(["S"]), row(["M"])]);
		const built = buildSubmitVariants(out.rows, null);
		expect("issues" in built).toBe(true);
		expect("issues" in built && built.issues[0]).toMatchObject({
			where: "row",
			field: "price",
		});
	});

	it("rebuilds when the row count matches but the combinations don't", () => {
		// Two rows, two expected combos — a bare length check passes here and the
		// server then throws "Missing variant for combination".
		const options = [{ name: "Size", values: ["S", "M"] }];
		const out = reconcileForSubmit(options, [row([]), row([])]);
		expect(out.rows.map((r) => r.optionValues)).toEqual([["S"], ["M"]]);
	});

	it("rebuilds a grid holding duplicate combinations", () => {
		const options = [{ name: "Size", values: ["S", "M"] }];
		const out = reconcileForSubmit(options, [row(["S"]), row(["S"])]);
		expect(out.rows.map((r) => r.optionValues)).toEqual([["S"], ["M"]]);
	});

	it("preserves typed prices for combinations that survive", () => {
		const out = reconcileForSubmit(
			[{ name: "Size", values: ["S", "M"] }],
			[row(["S"], "30"), row(["M"], "40"), row(["L"], "50")],
		);
		expect(out.rows.map((r) => r.price)).toEqual(["30", "40"]);
	});

	it("leaves rows alone while an axis is still incomplete", () => {
		// Zero combinations is a transient authoring moment, not an instruction to
		// discard work — collectOptionIssues reports the axis instead.
		const rows = [row(["S"]), row(["M"])];
		expect(reconcileForSubmit([{ name: "Size", values: [] }], rows).rows).toBe(
			rows,
		);
	});

	it("is a no-op for an already-consistent grid", () => {
		const rows = [row(["S"]), row(["M"])];
		const out = reconcileForSubmit(
			[{ name: "Size", values: ["S", "M"] }],
			rows,
		);
		expect(out.rows).toBe(rows);
	});
});

// --- the wizard's second source of truth ------------------------------------

function wizard(partial: Partial<WizardState>): WizardState {
	return {
		name: "Kuih lapis",
		description: "",
		images: [],
		shape: null,
		editor: { options: [], rows: [row([])], customLine: null },
		fulfilmentAnswered: true,
		hidden: false,
		categoryIds: [],
		minQuantity: "",
		minNoticeDays: "",
		...partial,
	} as WizardState;
}

describe("wizard submit payload", () => {
	it("derives options from the editor, not from the step-2 answer", () => {
		// The reported dead end: the step-2 answer had fallen out of sync with the editor,
		// so the payload carried `options: []` beside a two-row grid and the server
		// threw "Expected 1 variants for these options, got 2".
		const state = wizard({
			shape: "single",
			editor: {
				options: [{ name: "Size", values: ["S", "M"] }],
				rows: [row(["S"]), row(["M"])],
				customLine: null,
			},
		});
		const values = buildWizardSubmitValues(state);
		expect(values.options).toEqual([{ name: "Size", values: ["S", "M"] }]);
		expect(
			serverRejects(values.options as OptionAxis[], values.variants),
		).toBeNull();
	});

	it("validates the axes whenever they exist, even if the answer says otherwise", () => {
		const state = wizard({
			shape: "single",
			editor: {
				options: [{ name: "", values: ["S"] }], // unnamed axis
				rows: [row(["S"])],
				customLine: null,
			},
		});
		// Previously skipped entirely when the answer said "single", so an unnamed axis
		// sailed through to a server throw.
		expect(wizardStepIssues(state, 2).map((i) => i.field)).toContain(
			"axisName",
		);
	});

	it("still publishes a plain single-item product", () => {
		const state = wizard({ shape: "single" });
		const values = buildWizardSubmitValues(state);
		expect(values.options).toEqual([]);
		expect(values.variants).toHaveLength(1);
		expect(
			serverRejects(values.options as OptionAxis[], values.variants),
		).toBeNull();
	});

	it("keeps the custom line out of the matrix on a no-axes product", () => {
		// Two variants, one expected combo — the shape that must NOT trip the
		// count check (ticket AC 4c).
		const state = wizard({
			shape: "single",
			editor: {
				options: [],
				rows: [row([])],
				customLine: {
					label: "Your design",
					price: "",
					prompt: "",
					imageStorageIds: [],
				},
			},
		});
		const values = buildWizardSubmitValues(state);
		expect(values.variants).toHaveLength(2);
		expect(values.variants.filter((v) => v.isCustom)).toHaveLength(1);
		expect(
			serverRejects(values.options as OptionAxis[], values.variants),
		).toBeNull();
	});

	it("blocks publish when a rebuilt row has no price instead of shipping zero variants", () => {
		// A reconcile can mint a combination the seller never priced. That must
		// surface as a step issue, not collapse `variants` to [] at submit.
		const state = wizard({
			shape: "choices",
			editor: {
				options: [{ name: "Size", values: ["S", "M"] }],
				rows: [row(["S"], "30")], // grid is short one row
				customLine: null,
			},
		});
		expect(wizardStepIssues(state, 3).length).toBeGreaterThan(0);
	});
});
