// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type BulkAction, OrderBulkBar } from "./order-bulk-bar";

afterEach(cleanup);

const actions: BulkAction[] = [
	{ status: "packed", label: "Packed" },
	{ status: "cancelled", label: "Cancel orders", destructive: true },
];

describe("OrderBulkBar", () => {
	it("shows the selected count and clears on the X", () => {
		const onClear = vi.fn();
		render(
			<OrderBulkBar
				count={3}
				actions={actions}
				onApply={vi.fn()}
				onClear={onClear}
			/>,
		);
		expect(screen.getByText("3 selected")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /clear selection/i }));
		expect(onClear).toHaveBeenCalled();
	});

	it("applies the chosen status from the menu", () => {
		const onApply = vi.fn();
		render(
			<OrderBulkBar
				count={2}
				actions={actions}
				onApply={onApply}
				onClear={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: /mark as/i }));
		fireEvent.click(screen.getByRole("button", { name: "Cancel orders" }));
		expect(onApply).toHaveBeenCalledWith("cancelled");
	});
});
