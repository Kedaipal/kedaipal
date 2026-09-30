import { describe, expect, it } from "vitest";
import {
	type CsvOrder,
	METHOD_UNSPECIFIED_CELL,
	ORDER_COLUMNS_BY_KEY,
	orderColumnDisplay,
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

function filters(
	overrides: Partial<Parameters<typeof buildOrderColumnFilters>[0]> = {},
) {
	return buildOrderColumnFilters({
		state: {
			statuses: [],
			categories: [],
			categoriesUnspecified: false,
			sources: [],
			fulfilments: [],
			paymentStatuses: [],
			paymentMethods: [],
			attributionSources: [],
		},
		availableSources: [],
		availableCategories: [],
		country: "MY",
		statusLabel: (s) => s,
		onApply: () => {},
		...overrides,
	});
}

/** A facet tally holding every fulfilment kind, so the presence-driven picker
 * offers all of them. */
const ALL_FULFILMENTS = {
	statusLeaf: {},
	category: {},
	source: {},
	fulfilment: {
		delivery: 3,
		self_collect: 2,
		drop_off: 1,
		collection: 1,
		booking: 1,
		event: 1,
	},
	paymentStatus: {},
	paymentMethod: {},
	attribution: {},
};

/**
 * The bug this pins (86eyrtz74): the Order type header filter offered "Online"
 * while the column printed `storefront`, so a seller ticking a filter saw a
 * value that matched nothing on screen. It happened because the label lived in
 * the filter and the raw value in the column — two places, one idea.
 *
 * Rather than assert three hardcoded pairs, this drives the filter's OWN
 * options back through the column's OWN renderer: whatever either side is
 * changed to, they have to agree.
 *
 * It compares against `orderColumnDisplay`, not `column.value` — the stored
 * value is what the CSV writes, and a filter is part of the view.
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
		{
			// The inverse of `fulfilmentKey`: build the order that produces each
			// key, and check the column prints the word the filter offered. Drop-off
			// is the one that would have caught the old flattening — it comes from a
			// snapshot field, not from `deliveryMethod`.
			columnKey: "fulfilment",
			apply: (key) => {
				// An RSVP is STORED self_collect and known only by the marker — the
				// case that would silently read "Self-collect" in the column while
				// the filter offered "Event".
				if (key === "event")
					return {
						...ORDER,
						deliveryMethod: "self_collect",
						eventRsvp: true,
					};
				if (key === "collection")
					return {
						...ORDER,
						deliveryMethod: "delivery",
						deliveryDirection: "collection",
					};
				if (key === "drop_off")
					return {
						...ORDER,
						deliveryMethod: "self_collect",
						pickupSnapshot: {
							label: "Pasar",
							address: "Jalan 1",
							locationType: "drop_off" as const,
						},
					};
				return { ...ORDER, deliveryMethod: key };
			},
		},
	];

	for (const { columnKey, apply } of CASES) {
		it(`${columnKey}`, () => {
			const binding = filters({ facets: ALL_FULFILMENTS }).get(
				columnKey as never,
			);
			const column = ORDER_COLUMNS_BY_KEY.get(columnKey as never);
			if (!binding || !column) throw new Error(`missing ${columnKey}`);
			expect(binding.options.length).toBeGreaterThan(0);

			for (const option of binding.options) {
				if (option.value === METHOD_UNSPECIFIED) {
					// The one deliberate difference: the picker names the absence of a
					// method ("Unspecified") because an unlabelled row in a list is
					// unpickable, while the column leaves the cell blank because a
					// word there would read as a real payment rail.
					expect(orderColumnDisplay(column, apply(option.value))).toBe(
						METHOD_UNSPECIFIED_CELL,
					);
					continue;
				}
				expect(orderColumnDisplay(column, apply(option.value))).toBe(
					option.label,
				);
			}
		});
	}
});

/**
 * The fulfilment funnel is presence-driven (z8r3fdfau9): most stores only ever
 * do one or two kinds, and a picker whose rows can only ever read 0 teaches the
 * seller that the control is broken. The funnel icon itself is the signal, so
 * the binding has to be absent — not present-and-empty.
 */
describe("the Fulfilment header filter only exists when there's a choice to make", () => {
	const facetsWith = (fulfilment: Record<string, number>) => ({
		...ALL_FULFILMENTS,
		fulfilment,
	});

	it("is absent on a delivery-only store", () => {
		expect(
			filters({ facets: facetsWith({ delivery: 12 }) }).get("fulfilment"),
		).toBeUndefined();
	});

	it("is absent before the first result arrives", () => {
		// `facets` is undefined while the query is in flight — showing a funnel
		// that then disappears is worse than showing it a beat late.
		expect(filters({ facets: undefined }).get("fulfilment")).toBeUndefined();
	});

	it("appears the moment a second kind shows up, offering only what's there", () => {
		const binding = filters({
			facets: facetsWith({ delivery: 12, self_collect: 3 }),
		}).get("fulfilment");
		expect(binding?.options.map((o) => o.value)).toEqual([
			"delivery",
			"self_collect",
		]);
		// Registry order, never by count — a list that reshuffles as orders land
		// is a list the seller has to re-read every time.
		expect(binding?.options.map((o) => o.label)).toEqual([
			"Delivery",
			"Self-collect",
		]);
		expect(binding?.options.map((o) => o.count)).toEqual([12, 3]);
	});

	it("keeps a SELECTED kind pickable even when nothing matches it any more", () => {
		// A lit filter with no visible row is a filter the seller cannot switch
		// off — the rule `methodChoicesFor` already follows for payment rails.
		const binding = filters({
			facets: facetsWith({ delivery: 12 }),
			state: {
				statuses: [],
				categories: [],
				categoriesUnspecified: false,
				sources: [],
				fulfilments: ["booking"],
				paymentStatuses: [],
				paymentMethods: [],
				attributionSources: [],
			},
		}).get("fulfilment");
		expect(binding?.options.map((o) => o.value)).toEqual([
			"delivery",
			"booking",
		]);
		expect(binding?.options.at(-1)?.count).toBe(0);
	});
});
