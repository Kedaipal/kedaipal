// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilterOptionRow } from "./filter-option-row";

afterEach(cleanup);

describe("FilterOptionRow", () => {
	it("names the count with the host list's own noun, not always 'orders'", () => {
		render(
			<FilterOptionRow
				label="Past due"
				count={3}
				countNoun="seller"
				selected={false}
				onToggle={vi.fn()}
			/>,
		);
		expect(
			screen.getByRole("button", { name: "Past due, 3 sellers" }),
		).toBeTruthy();
	});

	it("defaults the noun to orders, so the inbox filters read as before", () => {
		render(
			<FilterOptionRow
				label="Packed"
				count={1}
				selected={false}
				onToggle={vi.fn()}
			/>,
		);
		expect(
			screen.getByRole("button", { name: "Packed, 1 order" }),
		).toBeTruthy();
	});

	it("draws an attention count in amber only while it is non-zero", () => {
		const { rerender } = render(
			<FilterOptionRow
				label="Past due"
				count={3}
				countTone="attention"
				selected={false}
				onToggle={vi.fn()}
			/>,
		);
		expect(screen.getByText("3").className).toMatch(/amber/);
		rerender(
			<FilterOptionRow
				label="Past due"
				count={0}
				countTone="attention"
				selected={false}
				onToggle={vi.fn()}
			/>,
		);
		expect(screen.getByText("0").className).not.toMatch(/amber/);
	});

	it("a mixed row says so to assistive tech — a parent that summarises children is tri-state", () => {
		render(
			<FilterOptionRow
				label="All sellers"
				count={412}
				countNoun="seller"
				selected={false}
				mixed
				onToggle={vi.fn()}
			/>,
		);
		expect(
			screen
				.getByRole("button", { name: "All sellers, 412 sellers" })
				.getAttribute("aria-pressed"),
		).toBe("mixed");
	});
});
