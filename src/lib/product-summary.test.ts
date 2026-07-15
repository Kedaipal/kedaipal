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

	it("describes the ICP case: choices by Size, made to order, price range", () => {
		expect(
			describeProduct(
				{
					options: [{ name: "Size", values: ["S", "M", "L"] }],
					rows: [
						row({ optionValues: ["S"], price: "12", blockWhenOutOfStock: false }),
						row({ optionValues: ["M"], price: "18", blockWhenOutOfStock: false }),
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
		).toBe("3 choices by Size · Made to order · RM 12–28.50");
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
