// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The tip dialog (86eye9xd4): fixed steps, the trip's new total on each, the
 * cost and the limit stated before the tap, and nothing past the cap.
 */

const addPriorityFee = vi.fn();
vi.mock("convex/react", () => ({ useAction: () => addPriorityFee }));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
	toast: {
		success: (...a: unknown[]) => toastSuccess(...a),
		error: (...a: unknown[]) => toastError(...a),
	},
}));

import { AddTipDialog, canTipMore } from "./add-tip-dialog";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function renderDialog(tipped = 0, currency = "MYR") {
	const onOpenChange = vi.fn();
	render(
		<AddTipDialog
			open
			onOpenChange={onOpenChange}
			shortId="ORD-1042"
			currency={currency}
			fare={920 + tipped}
			tipped={tipped}
		/>,
	);
	return onOpenChange;
}

const confirm = () =>
	screen
		.getAllByRole("button")
		.find((b) =>
			/Pick an amount|tip$/.test(b.textContent ?? ""),
		) as HTMLButtonElement;

describe("AddTipDialog", () => {
	it("says what it costs before the tap, and needs an amount picked", () => {
		renderDialog();
		expect(screen.getByText(/own Lalamove wallet/)).toBeTruthy();
		expect(screen.getByText(/Can't be taken back/)).toBeTruthy();
		expect(confirm().disabled).toBe(true);
		// Each step shows the trip's new total.
		expect(screen.getByText(/Trip RM\s?14\.20/)).toBeTruthy();
	});

	it("adds the picked tip and closes", async () => {
		addPriorityFee.mockResolvedValue({ ok: true, tipped: 500 });
		const onOpenChange = renderDialog();
		fireEvent.click(screen.getByRole("button", { name: /RM\s?5\.00/ }));
		expect(confirm().textContent).toMatch(/Add RM\s?5\.00 tip/);
		fireEvent.click(confirm());
		await waitFor(() =>
			expect(addPriorityFee).toHaveBeenCalledWith({
				shortId: "ORD-1042",
				amount: 500,
			}),
		);
		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(toastSuccess).toHaveBeenCalled();
	});

	it("a refusal stays open and says why", async () => {
		addPriorityFee.mockResolvedValue({ ok: false, message: "No rider needed" });
		const onOpenChange = renderDialog();
		fireEvent.click(screen.getByRole("button", { name: /RM\s?2\.00/ }));
		fireEvent.click(confirm());
		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith("No rider needed"),
		);
		expect(onOpenChange).not.toHaveBeenCalledWith(false);
	});

	it("steps past the cap are disabled, and the limit counts what's added", () => {
		renderDialog(1500);
		expect(
			(screen.getByRole("button", { name: /RM\s?10\.00/ }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		expect(
			(screen.getByRole("button", { name: /RM\s?5\.00/ }) as HTMLButtonElement)
				.disabled,
		).toBe(false);
		expect(screen.getByText(/RM\s?15\.00 added so far/)).toBeTruthy();
	});

	it("an SGD store tips in Singapore steps", () => {
		renderDialog(0, "SGD");
		expect(screen.getByRole("button", { name: /S\$\s?1\.00/ })).toBeTruthy();
		expect(canTipMore("SGD", 1000)).toBe(false);
		expect(canTipMore("MYR", 1000)).toBe(true);
	});
});
