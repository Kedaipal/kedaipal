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

	it("applies a non-destructive status immediately (no confirm)", () => {
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
		fireEvent.click(screen.getByRole("button", { name: "Packed" }));
		expect(onApply).toHaveBeenCalledWith("packed");
	});

	it("gates the destructive action behind a confirm dialog", () => {
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
		// Does NOT apply yet — a confirm dialog opens.
		expect(onApply).not.toHaveBeenCalled();
		expect(screen.getByRole("dialog")).toBeTruthy();
		// Confirming applies; the confirm button is labelled with the count.
		fireEvent.click(screen.getByRole("button", { name: /cancel 2 orders/i }));
		expect(onApply).toHaveBeenCalledWith("cancelled");
	});

	it("does not apply when the destructive confirm is dismissed", () => {
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
		fireEvent.click(screen.getByRole("button", { name: /keep orders/i }));
		expect(onApply).not.toHaveBeenCalled();
	});
});
