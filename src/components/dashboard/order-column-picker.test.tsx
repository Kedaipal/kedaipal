// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ORDER_COLUMNS,
	type OrderColumnKey,
} from "../../../convex/lib/orderCsv";
import { OrderColumnPicker } from "./order-column-picker";

afterEach(cleanup);

const ORDER_GROUP = ORDER_COLUMNS.filter((c) => c.group === "order");

function renderPicker(visible: OrderColumnKey[]) {
	const onSetMany = vi.fn();
	const onToggle = vi.fn();
	const shown = new Set<string>(visible);
	render(
		<OrderColumnPicker
			isVisible={(k) => shown.has(k)}
			onToggle={onToggle}
			onSetMany={onSetMany}
			onReset={vi.fn()}
			visibleCount={visible.length}
			isCustomised={false}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: /columns:/i }));
	return { onSetMany, onToggle };
}

const master = () => screen.getByRole("checkbox", { name: /^all columns/i });
const orderGroup = () => screen.getByRole("checkbox", { name: /^order —/i });

describe("OrderColumnPicker — bulk selection (86eyrtz74)", () => {
	it("the master box is TRI-STATE, not a lie about its children", () => {
		// A parent reading "unchecked" while 3 of 36 children are on tells the
		// seller something false. `indeterminate` is a DOM property, and it is
		// what a screen reader announces as "partially checked".
		renderPicker([ORDER_COLUMNS[0].key, ORDER_COLUMNS[1].key]);
		const box = master() as HTMLInputElement;
		expect(box.checked).toBe(false);
		expect(box.indeterminate).toBe(true);
	});

	it("reads fully checked only when every column is on", () => {
		renderPicker(ORDER_COLUMNS.map((c) => c.key));
		const box = master() as HTMLInputElement;
		expect(box.checked).toBe(true);
		expect(box.indeterminate).toBe(false);
	});

	it("selects every column in one click", () => {
		const { onSetMany } = renderPicker([ORDER_COLUMNS[0].key]);
		fireEvent.click(master());
		const [keys, visible] = onSetMany.mock.calls[0];
		expect(visible).toBe(true);
		expect(keys).toHaveLength(ORDER_COLUMNS.length);
	});

	it("clears every column in one click when all are on", () => {
		const { onSetMany } = renderPicker(ORDER_COLUMNS.map((c) => c.key));
		fireEvent.click(master());
		expect(onSetMany.mock.calls[0][1]).toBe(false);
	});

	it("a partly-filled master fills up rather than clearing", () => {
		// Clicking a half-ticked parent should complete the set — clearing what
		// is already chosen is the surprising reading.
		const { onSetMany } = renderPicker([ORDER_COLUMNS[0].key]);
		fireEvent.click(master());
		expect(onSetMany.mock.calls[0][1]).toBe(true);
	});

	it("each group toggles only its own columns", () => {
		const { onSetMany } = renderPicker([]);
		fireEvent.click(orderGroup());
		const [keys, visible] = onSetMany.mock.calls[0];
		expect(visible).toBe(true);
		expect([...keys].sort()).toEqual(ORDER_GROUP.map((c) => c.key).sort());
	});

	it("a group box is tri-state over its OWN columns", () => {
		renderPicker([ORDER_GROUP[0].key]);
		const box = orderGroup() as HTMLInputElement;
		expect(box.indeterminate).toBe(true);
		cleanup();
		renderPicker(ORDER_GROUP.map((c) => c.key));
		expect((orderGroup() as HTMLInputElement).checked).toBe(true);
	});

	it("every group carries its own count, so 'some' says how many", () => {
		renderPicker([ORDER_GROUP[0].key]);
		expect(
			screen.getByRole("checkbox", {
				name: new RegExp(`^order — 1 of ${ORDER_GROUP.length} columns`, "i"),
			}),
		).toBeTruthy();
	});

	it("names the last-column rule where the seller is clicking", () => {
		// A constraint that is enforced silently reads as a broken control.
		renderPicker([ORDER_COLUMNS[0].key]);
		expect(screen.getByText(/at least one column stays/i)).toBeTruthy();
		cleanup();
		renderPicker([ORDER_COLUMNS[0].key, ORDER_COLUMNS[1].key]);
		expect(screen.queryByText(/at least one column stays/i)).toBeNull();
	});
});
