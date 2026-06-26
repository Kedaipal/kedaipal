// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activeFilterCount, OrderFilters } from "./order-filters";

afterEach(cleanup);

describe("OrderFilters", () => {
	it("counts payment + method + date range + mockup", () => {
		expect(activeFilterCount({ payment: [], method: [], mockup: false })).toBe(
			0,
		);
		// 2 payment + 1 method + 1 date range (both bounds) + 1 mockup = 5.
		expect(
			activeFilterCount({
				payment: ["unpaid", "received"],
				method: ["cash"],
				from: 1,
				to: 2,
				mockup: true,
			}),
		).toBe(5);
		// A single date bound still counts as one.
		expect(
			activeFilterCount({ payment: [], method: [], from: 1, mockup: false }),
		).toBe(1);
	});

	it("toggling a payment chip reports the new selection", () => {
		const onChange = vi.fn();
		render(
			<OrderFilters
				value={{ payment: [], method: [], mockup: false }}
				onChange={onChange}
			/>,
		);
		// The mobile sheet is closed, so only the desktop controls render the chip.
		fireEvent.click(screen.getByRole("button", { name: "Unpaid" }));
		expect(onChange).toHaveBeenCalledWith({
			payment: ["unpaid"],
			method: [],
			mockup: false,
		});
	});

	it("toggling a method chip reports the new selection", () => {
		const onChange = vi.fn();
		render(
			<OrderFilters
				value={{ payment: [], method: [], mockup: false }}
				onChange={onChange}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "DuitNow" }));
		expect(onChange).toHaveBeenCalledWith({
			payment: [],
			method: ["duitnow"],
			mockup: false,
		});
	});

	it("shows the mockup toggle (with count) only when relevant, and toggles it", () => {
		const onChange = vi.fn();
		const { rerender } = render(
			<OrderFilters
				value={{ payment: [], method: [], mockup: false }}
				onChange={onChange}
				mockupCount={0}
			/>,
		);
		// No mockup-pending orders + not active → toggle hidden.
		expect(screen.queryByRole("button", { name: /needs mockup/i })).toBeNull();

		rerender(
			<OrderFilters
				value={{ payment: [], method: [], mockup: false }}
				onChange={onChange}
				mockupCount={3}
			/>,
		);
		const toggle = screen.getByRole("button", { name: /needs mockup/i });
		expect(toggle.textContent).toContain("3");
		fireEvent.click(toggle);
		expect(onChange).toHaveBeenCalledWith({
			payment: [],
			method: [],
			mockup: true,
		});
	});
});
