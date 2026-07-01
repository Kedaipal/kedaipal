// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	activeFilterCount,
	OrderFilters,
	type OrderFilterValue,
} from "./order-filters";

afterEach(cleanup);

const EMPTY: Pick<
	OrderFilterValue,
	"payment" | "method" | "methodUnspecified"
> = {
	payment: [],
	method: [],
	methodUnspecified: false,
};

function openFilters() {
	fireEvent.click(screen.getByRole("button", { name: /^filters/i }));
}

describe("OrderFilters", () => {
	it("counts payment + method + unspecified + date range + mockup", () => {
		expect(activeFilterCount({ ...EMPTY, mockup: false })).toBe(0);
		// 2 payment + 1 method + 1 unspecified + 1 date range + 1 mockup = 6.
		expect(
			activeFilterCount({
				payment: ["unpaid", "received"],
				method: ["cash"],
				methodUnspecified: true,
				from: 1,
				to: 2,
				mockup: true,
			}),
		).toBe(6);
		expect(activeFilterCount({ ...EMPTY, from: 1, mockup: false })).toBe(1);
	});

	it("toggling a payment chip reports the new selection", () => {
		const onChange = vi.fn();
		render(
			<OrderFilters value={{ ...EMPTY, mockup: false }} onChange={onChange} />,
		);
		openFilters();
		fireEvent.click(screen.getByRole("button", { name: "Unpaid" }));
		expect(onChange).toHaveBeenCalledWith({
			...EMPTY,
			payment: ["unpaid"],
			mockup: false,
		});
	});

	it("toggling a method chip reports the new selection", () => {
		const onChange = vi.fn();
		render(
			<OrderFilters value={{ ...EMPTY, mockup: false }} onChange={onChange} />,
		);
		openFilters();
		fireEvent.click(screen.getByRole("button", { name: "DuitNow" }));
		expect(onChange).toHaveBeenCalledWith({
			...EMPTY,
			method: ["duitnow"],
			mockup: false,
		});
	});

	it("toggling the Unspecified chip reports it (for online/legacy orders)", () => {
		const onChange = vi.fn();
		render(
			<OrderFilters value={{ ...EMPTY, mockup: false }} onChange={onChange} />,
		);
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
		const { rerender } = render(
			<OrderFilters
				value={{ ...EMPTY, mockup: false }}
				onChange={onChange}
				mockupCount={0}
			/>,
		);
		expect(screen.queryByRole("button", { name: /needs mockup/i })).toBeNull();

		rerender(
			<OrderFilters
				value={{ ...EMPTY, mockup: false }}
				onChange={onChange}
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
