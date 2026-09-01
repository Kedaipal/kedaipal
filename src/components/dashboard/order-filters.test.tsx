// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	INBOX_BUCKETS,
	statusToBucket,
} from "../../../convex/lib/orderBuckets";
import {
	BUCKET_LEAVES,
	INBOX_LEAF_KEYS,
	leafBucket,
} from "../../../convex/lib/orderBuckets";
import {
	activeFilterCount,
	methodChoicesFor,
	OrderFilters,
	type OrderFilterValue,
} from "./order-filters";

afterEach(cleanup);

/**
 * Filter options name themselves "<Label>, N orders" (86eyrtz74) so a screen
 * reader hears the count — the label and count spans are adjacent, so the
 * computed name would otherwise run together as "Unpaid7". Match the stem.
 */
function optionNamed(label: string): RegExp {
	return new RegExp(
		`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(,|$)`,
		"i",
	);
}

const EMPTY: Pick<
	OrderFilterValue,
	| "payment"
	| "method"
	| "methodUnspecified"
	| "attributionSources"
	| "sources"
	| "statuses"
	| "bookingPeriods"
	| "categories"
	| "categoriesUnspecified"
> = {
	payment: [],
	method: [],
	methodUnspecified: false,
	attributionSources: [],
	sources: [],
	statuses: [],
	bookingPeriods: [],
	categories: [],
	categoriesUnspecified: false,
};

/** Defaults to MY so every pre-SG assertion below stays exactly what it was. */
function renderFilters(
	props: Partial<Parameters<typeof OrderFilters>[0]> = {},
): ReturnType<typeof render> & { onChange: ReturnType<typeof vi.fn> } {
	const onChange = props.onChange ?? vi.fn();
	const rendered = render(
		<OrderFilters
			value={{ ...EMPTY, mockup: false }}
			onChange={onChange}
			country="MY"
			{...props}
		/>,
	);
	return Object.assign(rendered, {
		onChange: onChange as ReturnType<typeof vi.fn>,
	});
}

function openFilters() {
	fireEvent.click(screen.getByRole("button", { name: /^filters/i }));
}

describe("OrderFilters", () => {
	it("counts payment + method + unspecified + date range + mockup + source + came-from", () => {
		expect(activeFilterCount({ ...EMPTY, mockup: false })).toBe(0);
		// 2 payment + 1 method + 1 unspecified + 1 date range + 1 mockup + 1 source
		// + 2 came-from = 9 (each selected origin counts on its own, like payment).
		expect(
			activeFilterCount({
				payment: ["unpaid", "received"],
				method: ["cash"],
				methodUnspecified: true,
				bookingPeriods: [],
				from: 1,
				to: 2,
				mockup: true,
				sources: ["counter"],
				attributionSources: ["tiktok", "direct"],
				statuses: [],
				categories: [],
				categoriesUnspecified: false,
			}),
		).toBe(9);
		expect(activeFilterCount({ ...EMPTY, from: 1, mockup: false })).toBe(1);
		// Each selected surface counts on its own, like payment (86eyrtz74).
		expect(
			activeFilterCount({
				...EMPTY,
				mockup: false,
				sources: ["storefront", "claim"],
			}),
		).toBe(2);
	});

	it("toggling an order-type chip reports the surface", () => {
		const { onChange } = renderFilters();
		openFilters();
		fireEvent.click(
			screen.getByRole("button", { name: optionNamed("Counter") }),
		);
		expect(onChange).toHaveBeenCalledWith({
			...EMPTY,
			mockup: false,
			sources: ["counter"],
		});
	});

	it("order type is MULTI-select — surfaces add up rather than replace", () => {
		// "Online or claim link, but not counter" is a real question; the
		// single-value version could never ask it (86eyrtz74).
		const { onChange } = renderFilters({
			value: { ...EMPTY, mockup: false, sources: ["storefront"] },
		});
		openFilters();
		fireEvent.click(
			screen.getByRole("button", { name: optionNamed("Claim link") }),
		);
		expect(onChange).toHaveBeenCalledWith({
			...EMPTY,
			mockup: false,
			sources: ["storefront", "claim"],
		});
	});

	it("toggling a payment chip reports the new selection", () => {
		const { onChange } = renderFilters();
		openFilters();
		fireEvent.click(
			screen.getByRole("button", { name: optionNamed("Unpaid") }),
		);
		expect(onChange).toHaveBeenCalledWith({
			...EMPTY,
			payment: ["unpaid"],
			mockup: false,
		});
	});

	it("toggling a method chip reports the new selection", () => {
		const { onChange } = renderFilters();
		openFilters();
		fireEvent.click(
			screen.getByRole("button", { name: optionNamed("DuitNow") }),
		);
		expect(onChange).toHaveBeenCalledWith({
			...EMPTY,
			method: ["duitnow"],
			mockup: false,
		});
	});

	it("toggling the Unspecified chip reports it (for online/legacy orders)", () => {
		const { onChange } = renderFilters();
		openFilters();
		fireEvent.click(
			screen.getByRole("button", { name: optionNamed("Unspecified") }),
		);
		expect(onChange).toHaveBeenCalledWith({
			...EMPTY,
			methodUnspecified: true,
			mockup: false,
		});
	});

	it("shows the mockup toggle (with count) only when relevant, and toggles it", () => {
		const onChange = vi.fn();
		const { rerender } = renderFilters({ onChange, mockupCount: 0 });
		expect(screen.queryByRole("button", { name: /needs mockup/i })).toBeNull();

		rerender(
			<OrderFilters
				value={{ ...EMPTY, mockup: false }}
				onChange={onChange}
				country="MY"
				mockupCount={3}
			/>,
		);
		openFilters();
		const toggle = screen.getByRole("button", { name: /needs mockup/i });
		expect(toggle.textContent).toContain("3");
		fireEvent.click(toggle);
		expect(onChange).toHaveBeenCalledWith({ ...EMPTY, mockup: true });
	});
});

/**
 * SG-lite (86eyph341). The Method filter offers the STORE'S country rails —
 * an SG seller filtering by "DuitNow" would be filtering for a rail that
 * cannot exist in their inbox, and before this they had no PayNow chip at all.
 */
describe("OrderFilters — country-scoped method chips", () => {
	it("an MY store offers the MY rails and none of the SG ones", () => {
		renderFilters({ country: "MY" });
		openFilters();
		for (const label of ["DuitNow", "Touch 'n Go", "FPX"]) {
			expect(
				screen.getByRole("button", { name: optionNamed(label) }),
			).toBeTruthy();
		}
		for (const label of ["PayNow", "PayLah!", "NETS", "GrabPay"]) {
			expect(
				screen.queryByRole("button", { name: optionNamed(label) }),
			).toBeNull();
		}
	});

	it("an SG store offers the SG rails and none of the MY-only ones", () => {
		renderFilters({ country: "SG" });
		openFilters();
		for (const label of ["PayNow", "PayLah!", "NETS", "GrabPay"]) {
			expect(
				screen.getByRole("button", { name: optionNamed(label) }),
			).toBeTruthy();
		}
		for (const label of ["DuitNow", "Touch 'n Go", "FPX"]) {
			expect(
				screen.queryByRole("button", { name: optionNamed(label) }),
			).toBeNull();
		}
		// Shared rails survive on both sides.
		for (const label of ["Cash", "Bank transfer", "Card", "Other"]) {
			expect(
				screen.getByRole("button", { name: optionNamed(label) }),
			).toBeTruthy();
		}
	});

	it("toggling an SG rail reports it", () => {
		const { onChange } = renderFilters({ country: "SG" });
		openFilters();
		fireEvent.click(
			screen.getByRole("button", { name: optionNamed("PayNow") }),
		);
		expect(onChange).toHaveBeenCalledWith({
			...EMPTY,
			method: ["paynow"],
			mockup: false,
		});
	});

	it("an already-selected rail the country doesn't offer stays switch-off-able", () => {
		// HitPay MY can settle a GrabPay order, and a deep link can carry any
		// value — a selected chip the seller can't see is a filter they're stuck
		// with. It renders (once) and reports removal.
		const { onChange } = renderFilters({
			country: "MY",
			value: { ...EMPTY, method: ["grabpay"], mockup: false },
		});
		openFilters();
		const chips = screen.getAllByRole("button", {
			name: optionNamed("GrabPay"),
		});
		expect(chips).toHaveLength(1);
		fireEvent.click(chips[0]);
		expect(onChange).toHaveBeenCalledWith({
			...EMPTY,
			method: [],
			mockup: false,
		});
	});

	it("methodChoicesFor appends only unoffered selections, never duplicates", () => {
		// "cash" IS offered in MY, so selecting it must not print two chips.
		expect(methodChoicesFor("MY", ["cash"])).toEqual(
			methodChoicesFor("MY", []),
		);
		expect(methodChoicesFor("MY", ["paynow"])).toEqual([
			...methodChoicesFor("MY", []),
			"paynow",
		]);
	});
});

describe("OrderFilters — status + categories mirror the header filters (86eyrtz74)", () => {
	it("counts a status and a category like any other filter", () => {
		expect(
			activeFilterCount({
				...EMPTY,
				mockup: false,
				statuses: ["packed", "shipped"],
				categories: ["Cakes"],
			}),
		).toBe(3);
	});

	it("shows a header-set status as a removable token", () => {
		// The gap this closes: filter by Status from the table, then hide the
		// Status column or switch to cards — without a token the filter would be
		// invisible AND unclearable.
		const { onChange } = renderFilters({
			value: { ...EMPTY, mockup: false, statuses: ["packed"] },
			statusLabel: (st) => (st === "packed" ? "Ready for Pickup" : st),
		});
		fireEvent.click(
			screen.getByRole("button", { name: /remove filter: ready for pickup/i }),
		);
		expect(onChange).toHaveBeenCalledWith({
			...EMPTY,
			mockup: false,
			statuses: [],
		});
	});

	it("lets a cards-view seller set a status, which has no table header to click", () => {
		const { onChange } = renderFilters({
			statusLabel: (st) => (st === "packed" ? "Ready for Pickup" : st),
		});
		openFilters();
		fireEvent.click(
			screen.getByRole("button", { name: optionNamed("Ready for Pickup") }),
		);
		expect(onChange).toHaveBeenCalledWith({
			...EMPTY,
			mockup: false,
			statuses: ["packed"],
		});
	});

	it("hides the category section until there is a real choice to make", () => {
		renderFilters({ availableCategories: ["Cakes"] });
		openFilters();
		expect(screen.queryByText("Categories")).toBeNull();
		cleanup();
		renderFilters({ availableCategories: ["Cakes", "Drinks"] });
		openFilters();
		expect(screen.getByText("Categories")).toBeTruthy();
	});
});

describe("OrderFilters — the sheet (Direction A, 86eyrtz74)", () => {
	const FACETS = {
		statusLeaf: { packed: 6, delivered: 0 },
		category: { Cakes: 9 },
		source: { counter: 4 },
		paymentStatus: { unpaid: 7 },
		paymentMethod: { cash: 5, "": 4 },
		attribution: { tiktok: 3 },
	};

	it("puts a row count on every option, ZERO included", () => {
		// The count answers "is there anything in there?" before the seller
		// commits, and a 0 answers "why did my list go empty?".
		renderFilters({ facets: FACETS, statusLabel: (s) => s });
		openFilters();
		expect(
			screen.getByRole("button", { name: "packed, 6 orders" }),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "delivered, 0 orders" }),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Unpaid, 7 orders" }),
		).toBeTruthy();
		// "Unspecified" is the absence of a method, counted under the "" key.
		expect(
			screen.getByRole("button", { name: "Unspecified, 4 orders" }),
		).toBeTruthy();
	});

	it("shows 0 rather than nothing while the counts are still loading", () => {
		// A missing facet must not blank the panel — the options are still the
		// seller's to pick, they just don't know the sizes yet.
		renderFilters({ statusLabel: (s) => s });
		openFilters();
		expect(
			screen.getByRole("button", { name: "packed, 0 orders" }),
		).toBeTruthy();
	});

	it("Clear all says how much it clears, and is absent with nothing to clear", () => {
		renderFilters();
		openFilters();
		expect(screen.queryByRole("button", { name: /clear all/i })).toBeNull();
		cleanup();
		const { onChange } = renderFilters({
			value: {
				...EMPTY,
				mockup: false,
				statuses: ["packed"],
				payment: ["unpaid"],
			},
		});
		openFilters();
		fireEvent.click(screen.getByRole("button", { name: "Clear all (2)" }));
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({ statuses: [], payment: [] }),
		);
	});

	it("names the live result on the apply button", () => {
		renderFilters({ resultCount: 6 });
		openFilters();
		expect(screen.getByRole("button", { name: "Show 6 orders" })).toBeTruthy();
		cleanup();
		renderFilters({ resultCount: 1 });
		openFilters();
		expect(screen.getByRole("button", { name: "Show 1 order" })).toBeTruthy();
	});

	it("keeps active selections removable at the top of the sheet", () => {
		// A seller who opened the panel to undo ONE thing shouldn't have to hunt
		// nine sections for the lit option.
		const { onChange } = renderFilters({
			value: { ...EMPTY, mockup: false, payment: ["unpaid"] },
		});
		openFilters();
		fireEvent.click(
			screen.getAllByRole("button", { name: /remove filter: unpaid/i })[0],
		);
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({ payment: [] }),
		);
	});
});

describe("OrderFilters — per-section select all / clear (86eyrtz74)", () => {
	const section = (name: string) =>
		screen.getByRole("checkbox", { name: new RegExp(`^${name} —`, "i") });

	it("selects every option in a section in one click", () => {
		// "Everything except Cancelled" is tick-once-untick-once, not tick five
		// times — which is the whole reason this control exists.
		const { onChange } = renderFilters();
		openFilters();
		fireEvent.click(section("Status"));
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({ statuses: [...INBOX_LEAF_KEYS] }),
		);
	});

	it("clicking a FULL section clears it — the way back from select-all", () => {
		const { onChange } = renderFilters({
			value: { ...EMPTY, mockup: false, statuses: [...INBOX_LEAF_KEYS] },
		});
		openFilters();
		fireEvent.click(section("Status"));
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({ statuses: [] }),
		);
	});

	it("a partly-filled section FILLS rather than clears", () => {
		// Completing the set is the expected reading of a half-ticked box.
		const { onChange } = renderFilters({
			value: { ...EMPTY, mockup: false, statuses: ["packed"] },
		});
		openFilters();
		fireEvent.click(section("Status"));
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({ statuses: [...INBOX_LEAF_KEYS] }),
		);
	});

	it("the section box is tri-state over its own options", () => {
		renderFilters({
			value: { ...EMPTY, mockup: false, statuses: ["packed"] },
		});
		openFilters();
		const box = section("Status") as HTMLInputElement;
		expect(box.checked).toBe(false);
		expect(box.indeterminate).toBe(true);
	});

	it("says when a full section narrows nothing", () => {
		// Selecting every option is a legitimate stop on the way to "all except
		// X", but on its own it matches every order — so the panel says so
		// rather than leaving the seller wondering why the list didn't move.
		renderFilters({
			value: { ...EMPTY, mockup: false, statuses: [...INBOX_LEAF_KEYS] },
		});
		openFilters();
		expect(screen.getByText(/same as no status filter/i)).toBeTruthy();
	});

	it("stays quiet when the section is only partly selected", () => {
		renderFilters({
			value: { ...EMPTY, mockup: false, statuses: ["packed"] },
		});
		openFilters();
		expect(screen.queryByText(/same as no status filter/i)).toBeNull();
	});

	it("payment method counts Unspecified as one of its choices", () => {
		// It is a real answer a seller can filter on, so a section reading "all
		// selected" while it was off would be wrong.
		const { onChange } = renderFilters();
		openFilters();
		fireEvent.click(section("Payment method"));
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({ methodUnspecified: true }),
		);
	});

	it("single-select and range sections get NO bulk control", () => {
		// A select-all over overlapping due-date presets, or over a date range,
		// is meaningless — forcing the pattern everywhere is how a good idea
		// becomes clutter.
		renderFilters();
		openFilters();
		expect(screen.queryByRole("checkbox", { name: /^due date —/i })).toBeNull();
		expect(
			screen.queryByRole("checkbox", { name: /^order date —/i }),
		).toBeNull();
	});
});

describe("OrderFilters — select-all must not lie (PR #235 review)", () => {
	const section = (name: string) =>
		screen.getByRole("checkbox", { name: new RegExp(`^${name} —`, "i") });

	const FACETS = {
		statusLeaf: {},
		category: { Cakes: 9, "": 4 },
		source: {},
		paymentStatus: {},
		// An MY store whose HitPay settled a GrabPay order. GrabPay is not an MY
		// rail, so nothing in the country list would ever offer it.
		paymentMethod: { cash: 5, grabpay: 3 },
		attribution: {},
	};

	it("selecting all categories INCLUDES the uncategorized ones", () => {
		// The finding: uncategorized orders vanished while the panel claimed
		// nothing had been filtered. Categories are optional, so a partly
		// categorized catalogue is the common case, not an edge one.
		const { onChange } = renderFilters({
			availableCategories: ["Cakes", "Drinks"],
			facets: FACETS,
		});
		openFilters();
		fireEvent.click(section("Categories"));
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({
				categories: ["Cakes", "Drinks"],
				categoriesUnspecified: true,
			}),
		);
	});

	it("offers Uncategorized as a real, counted choice", () => {
		renderFilters({
			availableCategories: ["Cakes", "Drinks"],
			facets: FACETS,
		});
		openFilters();
		expect(
			screen.getByRole("button", { name: "Uncategorized, 4 orders" }),
		).toBeTruthy();
	});

	it("the category section only reads FULL once uncategorized is on too", () => {
		const withNames = {
			...EMPTY,
			mockup: false,
			categories: ["Cakes", "Drinks"],
		};
		renderFilters({
			value: withNames,
			availableCategories: ["Cakes", "Drinks"],
			facets: FACETS,
		});
		openFilters();
		expect((section("Categories") as HTMLInputElement).indeterminate).toBe(
			true,
		);
		cleanup();
		renderFilters({
			value: { ...withNames, categoriesUnspecified: true },
			availableCategories: ["Cakes", "Drinks"],
			facets: FACETS,
		});
		openFilters();
		expect((section("Categories") as HTMLInputElement).checked).toBe(true);
	});

	it("offers a rail the country doesn't sell but the orders actually used", () => {
		// paymentMethod.ts: never gate a label or a filter MATCH on the country
		// list — only the pickers. GrabPay had no option at all in an MY store.
		renderFilters({ country: "MY", facets: FACETS });
		openFilters();
		expect(
			screen.getByRole("button", { name: optionNamed("GrabPay") }),
		).toBeTruthy();
	});

	it("selecting all payment methods includes that off-list rail", () => {
		const { onChange } = renderFilters({ country: "MY", facets: FACETS });
		openFilters();
		fireEvent.click(section("Payment method"));
		const [call] = onChange.mock.calls;
		expect(call[0].method).toContain("grabpay");
		expect(call[0].methodUnspecified).toBe(true);
	});

	it("a rail with no orders and no selection stays out of the picker", () => {
		// The list is country + actually-present, not every rail that exists.
		renderFilters({ country: "MY", facets: FACETS });
		openFilters();
		expect(
			screen.queryByRole("button", { name: optionNamed("PayNow") }),
		).toBeNull();
	});
});

describe("STATUS is grouped by bucket, and nothing falls out", () => {
	/**
	 * The panel renders every LEAF under its bucket heading, so the chip row
	 * ("In progress") and the panel ("Ok go", "Packed", "Ready for Pickup")
	 * visibly describe the same axis — and since 1 Sep they write the same state,
	 * so a group ticked here lights its chip. Grouping introduces a way to LOSE a
	 * row: any leaf whose bucket isn't in `INBOX_BUCKETS` renders nowhere,
	 * silently. This pins the covering.
	 */
	it("every offered leaf lands in exactly one listed bucket", () => {
		const bucketKeys = INBOX_BUCKETS.map((b) => b.key);
		const seen = new Map<string, number>();
		for (const leaf of INBOX_LEAF_KEYS) {
			const bucket = leafBucket(leaf);
			expect(bucketKeys).toContain(bucket);
			expect(BUCKET_LEAVES[bucket]).toContain(leaf);
			seen.set(leaf, (seen.get(leaf) ?? 0) + 1);
		}
		// Rendering walks buckets × leaves, so a leaf matching two buckets would
		// appear twice. One each, no more.
		expect([...seen.values()].every((n) => n === 1)).toBe(true);
		expect(seen.size).toBe(INBOX_LEAF_KEYS.length);
	});

	it("reproduces the mapping the seller was confused by", () => {
		// Three buckets are 1:1 with a status, which is why they look like they
		// match; `in_progress` bundles three, which is why "Ok go" appeared to be
		// missing from the pills. It is not — it is inside In progress.
		expect(statusToBucket("pending")).toBe("new");
		expect(statusToBucket("delivered")).toBe("completed");
		expect(statusToBucket("cancelled")).toBe("cancelled");
		expect(
			(["confirmed", "packed", "shipped"] as const).map(statusToBucket),
		).toEqual(["in_progress", "in_progress", "in_progress"]);
	});
});
