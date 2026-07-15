// @vitest-environment jsdom
import {
	cleanup,
	createEvent,
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

describe("ConfirmDialog — type-to-confirm gate", () => {
	function deleteBtn() {
		return screen.getByRole("button", {
			name: "Delete permanently",
		}) as HTMLButtonElement;
	}
	function phraseInput() {
		return screen.getByLabelText("Type DELETE to confirm") as HTMLInputElement;
	}

	it("disables confirm until the phrase is typed, auto-uppercasing input", () => {
		const onConfirm = vi.fn();
		render(
			<ConfirmDialog
				open={true}
				onOpenChange={() => {}}
				title="Delete order permanently?"
				confirmLabel="Delete permanently"
				destructive
				confirmPhrase="DELETE"
				onConfirm={onConfirm}
			/>,
		);

		expect(deleteBtn().disabled).toBe(true);

		// Partial phrase stays disabled.
		fireEvent.change(phraseInput(), { target: { value: "del" } });
		expect(deleteBtn().disabled).toBe(true);

		// Full phrase typed lowercase is uppercased on screen and arms the button.
		fireEvent.change(phraseInput(), { target: { value: "delete" } });
		expect(phraseInput().value).toBe("DELETE");
		expect(deleteBtn().disabled).toBe(false);

		fireEvent.click(deleteBtn());
		expect(onConfirm).toHaveBeenCalledTimes(1);
	});

	it("trims surrounding whitespace before matching", () => {
		render(
			<ConfirmDialog
				open={true}
				onOpenChange={() => {}}
				title="Delete order permanently?"
				confirmLabel="Delete permanently"
				destructive
				confirmPhrase="DELETE"
				onConfirm={() => {}}
			/>,
		);
		fireEvent.change(phraseInput(), { target: { value: "  delete  " } });
		expect(deleteBtn().disabled).toBe(false);
	});

	it("blocks paste, drop, and dragover so only real keystrokes count", () => {
		render(
			<ConfirmDialog
				open={true}
				onOpenChange={() => {}}
				title="Delete order permanently?"
				confirmLabel="Delete permanently"
				destructive
				confirmPhrase="DELETE"
				onConfirm={() => {}}
			/>,
		);
		const input = phraseInput();
		for (const kind of ["paste", "drop", "dragOver"] as const) {
			const evt = createEvent[kind](input);
			fireEvent(input, evt);
			expect(evt.defaultPrevented).toBe(true);
		}
	});

	it("Enter submits only once the phrase matches", () => {
		const onConfirm = vi.fn();
		render(
			<ConfirmDialog
				open={true}
				onOpenChange={() => {}}
				title="Delete order permanently?"
				confirmLabel="Delete permanently"
				destructive
				confirmPhrase="DELETE"
				onConfirm={onConfirm}
			/>,
		);

		fireEvent.keyDown(phraseInput(), { key: "Enter" });
		expect(onConfirm).not.toHaveBeenCalled();

		fireEvent.change(phraseInput(), { target: { value: "delete" } });
		fireEvent.keyDown(phraseInput(), { key: "Enter" });
		expect(onConfirm).toHaveBeenCalledTimes(1);
	});

	it("clears the typed phrase on reopen so it can't pre-arm the button", () => {
		const shared = {
			onOpenChange: () => {},
			title: "Delete order permanently?",
			confirmLabel: "Delete permanently",
			destructive: true,
			confirmPhrase: "DELETE",
			onConfirm: () => {},
		} as const;
		const { rerender } = render(<ConfirmDialog open={true} {...shared} />);
		fireEvent.change(phraseInput(), { target: { value: "delete" } });
		expect(deleteBtn().disabled).toBe(false);

		rerender(<ConfirmDialog open={false} {...shared} />);
		rerender(<ConfirmDialog open={true} {...shared} />);

		expect(phraseInput().value).toBe("");
		expect(deleteBtn().disabled).toBe(true);
	});
});
