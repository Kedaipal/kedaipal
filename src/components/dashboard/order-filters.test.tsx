// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	activeFilterCount,
	methodChoicesFor,
	OrderFilters,
	type OrderFilterValue,
} from "./order-filters";

afterEach(cleanup);

const EMPTY: Pick<
	OrderFilterValue,
	| "payment"
	| "method"
	| "methodUnspecified"
	| "attributionSources"
	| "sources"
	| "statuses"
	| "categories"
> = {
	payment: [],
	method: [],
	methodUnspecified: false,
	attributionSources: [],
	sources: [],
	statuses: [],
	categories: [],
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
				from: 1,
				to: 2,
				mockup: true,
				sources: ["counter"],
				attributionSources: ["tiktok", "direct"],
				statuses: [],
				categories: [],
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
		fireEvent.click(screen.getByRole("button", { name: "Counter" }));
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
		fireEvent.click(screen.getByRole("button", { name: "Claim link" }));
		expect(onChange).toHaveBeenCalledWith({
			...EMPTY,
			mockup: false,
			sources: ["storefront", "claim"],
		});
	});

	it("toggling a payment chip reports the new selection", () => {
		const { onChange } = renderFilters();
		openFilters();
		fireEvent.click(screen.getByRole("button", { name: "Unpaid" }));
		expect(onChange).toHaveBeenCalledWith({
			...EMPTY,
			payment: ["unpaid"],
			mockup: false,
		});
	});

	it("toggling a method chip reports the new selection", () => {
		const { onChange } = renderFilters();
		openFilters();
		fireEvent.click(screen.getByRole("button", { name: "DuitNow" }));
		expect(onChange).toHaveBeenCalledWith({
			...EMPTY,
			method: ["duitnow"],
			mockup: false,
		});
	});

	it("toggling the Unspecified chip reports it (for online/legacy orders)", () => {
		const { onChange } = renderFilters();
		openFilters();
		fireEvent.click(screen.getByRole("button", { name: "Unspecified" }));
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
			expect(screen.getByRole("button", { name: label })).toBeTruthy();
		}
		for (const label of ["PayNow", "PayLah!", "NETS", "GrabPay"]) {
			expect(screen.queryByRole("button", { name: label })).toBeNull();
		}
	});

	it("an SG store offers the SG rails and none of the MY-only ones", () => {
		renderFilters({ country: "SG" });
		openFilters();
		for (const label of ["PayNow", "PayLah!", "NETS", "GrabPay"]) {
			expect(screen.getByRole("button", { name: label })).toBeTruthy();
		}
		for (const label of ["DuitNow", "Touch 'n Go", "FPX"]) {
			expect(screen.queryByRole("button", { name: label })).toBeNull();
		}
		// Shared rails survive on both sides.
		for (const label of ["Cash", "Bank transfer", "Card", "Other"]) {
			expect(screen.getByRole("button", { name: label })).toBeTruthy();
		}
	});

	it("toggling an SG rail reports it", () => {
		const { onChange } = renderFilters({ country: "SG" });
		openFilters();
		fireEvent.click(screen.getByRole("button", { name: "PayNow" }));
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
		const chips = screen.getAllByRole("button", { name: "GrabPay" });
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
		fireEvent.click(screen.getByRole("button", { name: "Ready for Pickup" }));
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
