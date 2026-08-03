import { describe, expect, it } from "vitest";
import { describeProduct, type SummaryInput } from "./product-summary";

function row(
	partial: Partial<SummaryInput["rows"][number]> = {},
): SummaryInput["rows"][number] {
	return {
		optionValues: [],
		price: "10",
		active: true,
		blockWhenOutOfStock: true,
		requiresProof: false,
		...partial,
	};
}

describe("describeProduct", () => {
	it("describes a single tracked item with one price", () => {
		expect(
			describeProduct(
				{ options: [], rows: [row({ price: "18.00" })], hasCustomLine: false },
				"RM",
			),
		).toBe("One item · From stock · RM 18");
	});

	it("describes the ICP case: choices by Size, made fresh, price range", () => {
		expect(
			describeProduct(
				{
					options: [{ name: "Size", values: ["S", "M", "L"] }],
					rows: [
						row({
							optionValues: ["S"],
							price: "12",
							blockWhenOutOfStock: false,
						}),
						row({
							optionValues: ["M"],
							price: "18",
							blockWhenOutOfStock: false,
						}),
						row({
							optionValues: ["L"],
							price: "28.50",
							blockWhenOutOfStock: false,
						}),
					],
					hasCustomLine: false,
				},
				"RM",
			),
		).toBe("3 choices by Size · Made fresh · RM 12–28.50");
	});

	it("joins two axes with × and flags mixed fulfilment", () => {
		expect(
			describeProduct(
				{
					options: [
						{ name: "Size", values: ["S", "M"] },
						{ name: "Flavour", values: ["Pandan"] },
					],
					rows: [
						row({ optionValues: ["S", "Pandan"] }),
						row({
							optionValues: ["M", "Pandan"],
							blockWhenOutOfStock: false,
						}),
					],
					hasCustomLine: false,
				},
				"RM",
			),
		).toBe("2 choices by Size × Flavour · Mixed fulfilment · RM 10");
	});

	it("ignores deactivated rows for fulfilment and price", () => {
		expect(
			describeProduct(
				{
					options: [{ name: "Size", values: ["S", "M"] }],
					rows: [
						row({ optionValues: ["S"], price: "12" }),
						row({
							optionValues: ["M"],
							price: "99",
							active: false,
							blockWhenOutOfStock: false,
						}),
					],
					hasCustomLine: false,
				},
				"RM",
			),
		).toBe("2 choices by Size · From stock · RM 12");
	});

	it("notes a missing price and a custom line", () => {
		expect(
			describeProduct(
				{ options: [], rows: [row({ price: "" })], hasCustomLine: true },
				"RM",
			),
		).toBe("One item · From stock · No price yet · + custom option");
	});
});

describe("describeProduct — made-to-order products (86eyfq04j)", () => {
	// One never-out-of-stock, approval-gated row and no axes: the product IS the
	// custom order, so "One item · Made fresh · No price yet" would frame all
	// three as unfinished setup rather than the deliberate shape it is.
	const madeToOrder = {
		options: [],
		rows: [row({ price: "", blockWhenOutOfStock: false, requiresProof: true })],
		hasCustomLine: false,
	};

	it("reads as a quote, not as a missing price", () => {
		expect(describeProduct(madeToOrder, "RM")).toBe(
			"Made to order · Price on quote",
		);
	});

	it("shows a typed price as the price, not a floor", () => {
		expect(
			describeProduct(
				{ ...madeToOrder, rows: [{ ...madeToOrder.rows[0], price: "120" }] },
				"RM",
			),
		).toBe("Made to order · RM 120");
	});

	it("leaves an ordinary made-fresh item alone", () => {
		expect(
			describeProduct(
				{
					options: [],
					rows: [row({ price: "12", blockWhenOutOfStock: false })],
					hasCustomLine: false,
				},
				"RM",
			),
		).toBe("One item · Made fresh · RM 12");
	});
});
