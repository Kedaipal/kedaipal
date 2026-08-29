import { describe, expect, it } from "vitest";
import {
	type CsvOrder,
	METHOD_UNSPECIFIED_CELL,
	ORDER_COLUMNS_BY_KEY,
} from "../../../convex/lib/orderCsv";
import {
	buildOrderColumnFilters,
	METHOD_UNSPECIFIED,
} from "./order-column-filters";

const ORDER: CsvOrder = {
	shortId: "ORD-1",
	createdAt: 0,
	status: "confirmed",
	customer: { name: "Aisha" },
	items: [{ name: "Cake", quantity: 1 }],
	subtotal: 1000,
	total: 1000,
	currency: "MYR",
};

function filters() {
	return buildOrderColumnFilters({
		state: {
			statuses: [],
			categories: [],
			sources: [],
			paymentStatuses: [],
			paymentMethods: [],
			attributionSources: [],
		},
		availableSources: [],
		availableCategories: [],
		country: "MY",
		statusLabel: (s) => s,
		onApply: () => {},
	});
}

/**
 * The bug this pins (86eyrtz74): the Order type header filter offered "Online"
 * while the column printed `storefront`, so a seller ticking a filter saw a
 * value that matched nothing on screen. It happened because the label lived in
 * the filter and the raw value in the column — two places, one idea.
 *
 * Rather than assert three hardcoded pairs, this drives the filter's OWN
 * options back through the column's OWN renderer: whatever either side is
 * changed to, they have to agree.
 */
describe("a header filter's options read exactly like the column it filters", () => {
	const CASES: {
		columnKey: string;
		/** Put the option's wire value onto an order the way the column reads it. */
		apply: (value: string) => CsvOrder;
	}[] = [
		{ columnKey: "orderType", apply: (source) => ({ ...ORDER, source }) },
		{
			columnKey: "paymentStatus",
			apply: (paymentStatus) => ({
				...ORDER,
				paymentStatus: paymentStatus as CsvOrder["paymentStatus"],
			}),
		},
		{
			columnKey: "paymentMethod",
			apply: (paymentMethod) => ({ ...ORDER, paymentMethod }),
		},
	];

	for (const { columnKey, apply } of CASES) {
		it(`${columnKey}`, () => {
			const binding = filters().get(columnKey as never);
			const column = ORDER_COLUMNS_BY_KEY.get(columnKey as never);
			if (!binding || !column) throw new Error(`missing ${columnKey}`);
			expect(binding.options.length).toBeGreaterThan(0);

			for (const option of binding.options) {
				if (option.value === METHOD_UNSPECIFIED) {
					// The one deliberate difference: the picker names the absence of a
					// method ("Unspecified") because an unlabelled row in a list is
					// unpickable, while the column leaves the cell blank because a
					// word there would read as a real payment rail.
					expect(column.value(apply(option.value))).toBe(
						METHOD_UNSPECIFIED_CELL,
					);
					continue;
				}
				expect(column.value(apply(option.value))).toBe(option.label);
			}
		});
	}
});
