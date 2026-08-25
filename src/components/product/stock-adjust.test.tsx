// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const adjustStock = vi.fn(async () => []);
vi.mock("convex/react", () => ({ useMutation: () => adjustStock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import type { Id } from "../../../convex/_generated/dataModel";
import { StockAdjustDialog, type StockLine } from "./stock-adjust";

afterEach(() => {
	cleanup();
	adjustStock.mockClear();
});

const line = (onHand: number): StockLine => ({
	variantId: "v1" as Id<"productVariants">,
	label: "Original",
	onHand,
});

function open(onHand: number) {
	return render(
		<StockAdjustDialog
			open
			onOpenChange={() => {}}
			productName="Keropok Lekor"
			line={line(onHand)}
		/>,
	);
}

test("the shelf count, the result and the movement are three separate readings", () => {
	// The requirement behind picking this direction: a big number that CHANGES
	// as you tap can be misread as "how many I'm adding" unless the other two
	// numbers are on screen, labelled, at the same time.
	open(20);
	fireEvent.click(screen.getByRole("button", { name: "+10" }));

	expect(screen.getByText("In stock now")).toBeTruthy();
	expect(screen.getByText("New count")).toBeTruthy();
	expect(screen.getByText("Adding 10")).toBeTruthy();
	// 20 (shelf) and 30 (result) are both rendered — the result never replaces
	// the current count, it sits beside it.
	expect(screen.getByText("20")).toBeTruthy();
	expect(screen.getByText("30")).toBeTruthy();
});

test("the confirm button names the movement, never 'Save'", () => {
	open(20);
	fireEvent.click(screen.getByRole("button", { name: "+5" }));
	expect(screen.getByRole("button", { name: "Add 5" })).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "-10" }));
	expect(screen.getByRole("button", { name: "Remove 5" })).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Save" })).toBe(null);
});

test("confirming with no movement is impossible", () => {
	open(20);
	const confirm = screen.getByRole("button", { name: "No change" });
	expect(confirm.hasAttribute("disabled")).toBe(true);
});

test("a movement is sent as a delta, never as a total", () => {
	open(20);
	fireEvent.click(screen.getByRole("button", { name: "+10" }));
	fireEvent.click(screen.getByRole("button", { name: "Add 10" }));
	expect(adjustStock).toHaveBeenCalledWith({
		adjustments: [{ variantId: "v1", delta: 10 }],
	});
});

test("the minus controls stop at zero", () => {
	open(2);
	fireEvent.click(screen.getByRole("button", { name: "-10" }));
	expect(screen.getByText("Removing 2")).toBeTruthy();
	expect(
		screen.getByRole("button", { name: "One fewer" }).hasAttribute("disabled"),
	).toBe(true);
});

test("the exact count warns that it overwrites, and carries what was seen", () => {
	open(20);
	fireEvent.click(screen.getByRole("button", { name: /Counted your shelf/ }));
	fireEvent.change(screen.getByRole("textbox"), { target: { value: "17" } });

	expect(screen.getByText(/This replaces the count/)).toBeTruthy();
	expect(screen.getByText("3 fewer than the store holds")).toBeTruthy();

	fireEvent.click(screen.getByRole("button", { name: "Set to 17" }));
	expect(adjustStock).toHaveBeenCalledWith({
		adjustments: [{ variantId: "v1", setTo: 17, expectedOnHand: 20 }],
	});
});

test("a sale landing mid-dialog informs a movement and warns an exact count", () => {
	// Same race as the bug, compressed into seconds. The dialog reads its count
	// live, so this is a re-render with a smaller number, not a stale prop.
	const { rerender } = render(
		<StockAdjustDialog
			open
			onOpenChange={() => {}}
			productName="Keropok Lekor"
			line={line(20)}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "+10" }));
	rerender(
		<StockAdjustDialog
			open
			onOpenChange={() => {}}
			productName="Keropok Lekor"
			line={line(18)}
		/>,
	);

	expect(screen.getByText(/2 units sold while this was open/)).toBeTruthy();
	// The movement rebases on the new truth without the seller retyping it.
	expect(screen.getByRole("button", { name: "Add 10" })).toBeTruthy();
	expect(screen.getByText("28")).toBeTruthy();

	fireEvent.click(screen.getByRole("button", { name: /Counted your shelf/ }));
	fireEvent.change(screen.getByRole("textbox"), { target: { value: "17" } });
	expect(screen.getByText(/holds 18 now, not 20/)).toBeTruthy();
	// Offered, not applied — only the seller knows if they counted before or
	// after those two went out the door.
	fireEvent.click(screen.getByRole("button", { name: "Use 15 instead" }));
	expect(screen.getByRole("button", { name: "Set to 15" })).toBeTruthy();
});
