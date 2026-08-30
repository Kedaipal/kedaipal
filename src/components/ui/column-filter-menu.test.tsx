// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColumnFilterMenu } from "./column-filter-menu";

afterEach(cleanup);

const OPTIONS = [
	{ value: "pending", label: "Incoming", count: 4 },
	{ value: "packed", label: "Packed", count: 12 },
	{ value: "delivered", label: "Delivered", count: 0 },
];

function renderMenu(
	props: Partial<Parameters<typeof ColumnFilterMenu>[0]> = {},
) {
	const onChange = props.onChange ?? vi.fn();
	render(
		<ColumnFilterMenu
			label="Status"
			options={OPTIONS}
			selected={[]}
			onChange={onChange}
			{...props}
		/>,
	);
	return { onChange };
}

function open() {
	// The trigger's name gains "— N selected" once a filter is on, so match on
	// the stem rather than the whole string.
	fireEvent.click(screen.getByRole("button", { name: /^filter status/i }));
}

describe("ColumnFilterMenu", () => {
	it("shows the funnel even with nothing selected — it is what says 'filterable'", () => {
		renderMenu();
		// Never hover-only: a control revealed by hover is undiscoverable on touch.
		expect(
			screen.getByRole("button", { name: /^filter status$/i }),
		).toBeTruthy();
	});

	it("names the selection count on the trigger, so an active filter is visible closed", () => {
		renderMenu({ selected: ["pending", "packed"] });
		expect(
			screen.getByRole("button", { name: /filter status — 2 selected/i }),
		).toBeTruthy();
	});

	it("adds to the selection rather than replacing it", () => {
		// The whole point of moving filters here: two statuses at once.
		const { onChange } = renderMenu({ selected: ["pending"] });
		open();
		fireEvent.click(screen.getByRole("button", { name: /packed/i }));
		expect(onChange).toHaveBeenCalledWith(["pending", "packed"]);
	});

	it("deselects a selected option", () => {
		const { onChange } = renderMenu({ selected: ["pending", "packed"] });
		open();
		fireEvent.click(screen.getByRole("button", { name: /incoming/i }));
		expect(onChange).toHaveBeenCalledWith(["packed"]);
	});

	it("single mode replaces, and re-picking clears", () => {
		// Overlapping presets (today is inside this week) can't be a set, so the
		// only way back to "no filter" is re-picking the active one.
		const { onChange } = renderMenu({ mode: "single", selected: ["packed"] });
		open();
		fireEvent.click(screen.getByRole("button", { name: /incoming/i }));
		expect(onChange).toHaveBeenLastCalledWith(["pending"]);
		cleanup();
		const second = renderMenu({ mode: "single", selected: ["packed"] });
		open();
		fireEvent.click(screen.getByRole("button", { name: /packed/i }));
		expect(second.onChange).toHaveBeenLastCalledWith([]);
	});

	it("shows a count beside every option, ZERO included", () => {
		// A zero is the answer to "why did my list go empty when I picked that?",
		// so hiding it would remove the most useful number in the panel.
		renderMenu();
		open();
		// Spelled out for screen readers too — the label and count spans are
		// adjacent, so the computed name would otherwise run together as
		// "Delivered0".
		expect(
			screen.getByRole("button", { name: "Delivered, 0 orders" }),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Packed, 12 orders" }),
		).toBeTruthy();
	});

	it("keeps every option visible as the selection grows", () => {
		// A picker that shrank under use would read as orders disappearing.
		renderMenu({ selected: ["pending"] });
		open();
		for (const o of OPTIONS) {
			expect(
				screen.getByRole("button", { name: new RegExp(o.label, "i") }),
			).toBeTruthy();
		}
	});

	it("offers Clear only when something is selected", () => {
		renderMenu();
		open();
		expect(screen.queryByRole("button", { name: /^clear$/i })).toBeNull();
		cleanup();
		const { onChange } = renderMenu({ selected: ["packed"] });
		open();
		fireEvent.click(screen.getByRole("button", { name: /^clear$/i }));
		expect(onChange).toHaveBeenCalledWith([]);
	});

	it("explains an empty list instead of showing a blank panel", () => {
		renderMenu({ options: [], emptyHint: "No categories on these orders yet" });
		open();
		expect(screen.getByText("No categories on these orders yet")).toBeTruthy();
	});

	it("shows a search box only once the list is long enough to need one", () => {
		renderMenu();
		open();
		expect(screen.queryByLabelText(/find in status/i)).toBeNull();
		cleanup();
		renderMenu({
			options: Array.from({ length: 12 }, (_, i) => ({
				value: `c${i}`,
				label: `Category ${i}`,
			})),
		});
		open();
		const box = screen.getByLabelText(/find in status/i);
		fireEvent.change(box, { target: { value: "category 1" } });
		// "Category 1", "Category 10" and "Category 11" — not all twelve.
		expect(screen.getAllByRole("button", { name: /^Category 1/ }).length).toBe(
			3,
		);
	});
});
