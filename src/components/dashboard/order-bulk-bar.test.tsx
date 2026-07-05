// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type BulkAction, OrderBulkBar } from "./order-bulk-bar";

afterEach(cleanup);

const actions: BulkAction[] = [
	{ status: "confirmed", label: "Confirm" },
	{ status: "packed", label: "Packed" },
	{ status: "cancelled", label: "Cancel orders", destructive: true },
];

function renderBar(
	overrides: Partial<Parameters<typeof OrderBulkBar>[0]> = {},
) {
	const props = {
		count: 2,
		actions,
		allSelected: false,
		onApply: vi.fn(),
		onToggleSelectAll: vi.fn(),
		onExit: vi.fn(),
		...overrides,
	};
	render(<OrderBulkBar {...props} />);
	return props;
}

describe("OrderBulkBar", () => {
	it("shows the selected count and exits on the X", () => {
		const { onExit } = renderBar({ count: 3 });
		expect(screen.getByText("3 selected")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /exit select mode/i }));
		expect(onExit).toHaveBeenCalled();
	});

	it("shows a hint and disables the status dropdown with nothing selected", () => {
		renderBar({ count: 0 });
		expect(screen.getByText("Select orders")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: /update status/i }),
		).toHaveProperty("disabled", true);
	});

	it("toggles select-all", () => {
		const { onToggleSelectAll } = renderBar({ allSelected: false });
		fireEvent.click(screen.getByRole("button", { name: /select all/i }));
		expect(onToggleSelectAll).toHaveBeenCalled();
	});

	it("applies a forward status from the dropdown (no confirm)", () => {
		const onApply = vi.fn();
		renderBar({ onApply });
		fireEvent.click(screen.getByRole("button", { name: /update status/i }));
		fireEvent.click(screen.getByRole("button", { name: "Packed" }));
		expect(onApply).toHaveBeenCalledWith("packed");
	});

	it("gates the destructive action behind a confirm dialog", () => {
		const onApply = vi.fn();
		renderBar({ onApply });
		fireEvent.click(screen.getByRole("button", { name: /update status/i }));
		fireEvent.click(screen.getByRole("button", { name: "Cancel orders" }));
		// Does NOT apply yet — a confirm dialog opens.
		expect(onApply).not.toHaveBeenCalled();
		expect(screen.getByRole("dialog")).toBeTruthy();
		// Confirming applies; the confirm button is labelled with the count.
		fireEvent.click(screen.getByRole("button", { name: /cancel 2 orders/i }));
		expect(onApply).toHaveBeenCalledWith("cancelled");
	});

	it("awaits a rejecting destructive apply and keeps the confirm open for retry", async () => {
		const onApply = vi.fn().mockRejectedValue(new Error("boom"));
		renderBar({ onApply });
		fireEvent.click(screen.getByRole("button", { name: /update status/i }));
		fireEvent.click(screen.getByRole("button", { name: "Cancel orders" }));
		fireEvent.click(screen.getByRole("button", { name: /cancel 2 orders/i }));

		await waitFor(() => expect(onApply).toHaveBeenCalledWith("cancelled"));
		// The apply rejected, so the dialog must stay open (not auto-close).
		expect(screen.getByRole("dialog")).toBeTruthy();
	});

	it("does not apply when the destructive confirm is dismissed", () => {
		const onApply = vi.fn();
		renderBar({ onApply });
		fireEvent.click(screen.getByRole("button", { name: /update status/i }));
		fireEvent.click(screen.getByRole("button", { name: "Cancel orders" }));
		fireEvent.click(screen.getByRole("button", { name: /keep orders/i }));
		expect(onApply).not.toHaveBeenCalled();
	});
});
