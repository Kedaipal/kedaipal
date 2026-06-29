// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./confirm-dialog";

afterEach(cleanup);

describe("ConfirmDialog", () => {
	it("shows the title + description only while open", () => {
		const { rerender } = render(
			<ConfirmDialog
				open={false}
				onOpenChange={() => {}}
				title="Cancel this checkout?"
				description="This can't be undone."
				confirmLabel="Cancel checkout"
				onConfirm={() => {}}
			/>,
		);
		expect(screen.queryByText("Cancel this checkout?")).toBeNull();

		rerender(
			<ConfirmDialog
				open={true}
				onOpenChange={() => {}}
				title="Cancel this checkout?"
				description="This can't be undone."
				confirmLabel="Cancel checkout"
				onConfirm={() => {}}
			/>,
		);
		expect(screen.getByText("Cancel this checkout?")).toBeTruthy();
		expect(screen.getByText("This can't be undone.")).toBeTruthy();
	});

	it("runs onConfirm then closes when confirmed", async () => {
		const onConfirm = vi.fn();
		const onOpenChange = vi.fn();
		render(
			<ConfirmDialog
				open={true}
				onOpenChange={onOpenChange}
				title="Cancel this checkout?"
				confirmLabel="Cancel checkout"
				onConfirm={onConfirm}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Cancel checkout" }));

		await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
	});

	it("closes without confirming when cancelled", () => {
		const onConfirm = vi.fn();
		const onOpenChange = vi.fn();
		render(
			<ConfirmDialog
				open={true}
				onOpenChange={onOpenChange}
				title="Cancel this checkout?"
				confirmLabel="Cancel checkout"
				cancelLabel="Keep it open"
				onConfirm={onConfirm}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Keep it open" }));

		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it("keeps the dialog open when onConfirm rejects, so the user can retry", async () => {
		const onConfirm = vi.fn().mockRejectedValue(new Error("network"));
		const onOpenChange = vi.fn();
		render(
			<ConfirmDialog
				open={true}
				onOpenChange={onOpenChange}
				title="Cancel order?"
				confirmLabel="Cancel order"
				destructive
				onConfirm={onConfirm}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));

		await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
		// A failed action must NOT auto-close — onOpenChange(false) is never fired.
		expect(onOpenChange).not.toHaveBeenCalledWith(false);
	});
});
