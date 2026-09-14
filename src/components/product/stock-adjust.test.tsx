// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const adjustStock = vi.fn(async () => []);
vi.mock("convex/react", () => ({ useMutation: () => adjustStock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import type { Id } from "../../../convex/_generated/dataModel";
import { StockAdjustDialog, type StockLine, StockSheet } from "./stock-adjust";

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

test("an exact count confirmed THROUGH the warning still sends the count the seller saw", () => {
	// The warning is advisory, so the guard has to hold for a seller who taps
	// straight past it. Sending the LIVE count as `expectedOnHand` would have the
	// server compare that value to itself, agree, and overwrite the sale that
	// just landed — this ticket's own bug on the one control built to stop it.
	// Asserting this needs live !== openedAt; where they are equal the assertion
	// cannot tell the two behaviours apart.
	const { rerender } = render(
		<StockAdjustDialog
			open
			onOpenChange={() => {}}
			productName="Keropok Lekor"
			line={line(20)}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: /Counted your shelf/ }));
	fireEvent.change(screen.getByRole("textbox"), { target: { value: "20" } });

	// Two sell while the seller is typing.
	rerender(
		<StockAdjustDialog
			open
			onOpenChange={() => {}}
			productName="Keropok Lekor"
			line={line(18)}
		/>,
	);
	// They tap through the amber notice without reading it.
	fireEvent.click(screen.getByRole("button", { name: "Set to 20" }));

	expect(adjustStock).toHaveBeenCalledWith({
		adjustments: [{ variantId: "v1", setTo: 20, expectedOnHand: 20 }],
	});
});

test("a refused exact count can be re-confirmed — it does not refuse forever", async () => {
	// The baseline has to advance to what is on screen after a refusal, or the
	// seller is stuck: the server keeps comparing against a number they have
	// already been shown and accepted, and Confirm never succeeds.
	adjustStock.mockRejectedValueOnce(
		new Error("Stock changed to 18 while you were counting"),
	);
	const { rerender } = render(
		<StockAdjustDialog
			open
			onOpenChange={() => {}}
			productName="Keropok Lekor"
			line={line(20)}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: /Counted your shelf/ }));
	fireEvent.change(screen.getByRole("textbox"), { target: { value: "20" } });
	rerender(
		<StockAdjustDialog
			open
			onOpenChange={() => {}}
			productName="Keropok Lekor"
			line={line(18)}
		/>,
	);

	fireEvent.click(screen.getByRole("button", { name: "Set to 20" }));
	await waitFor(() => expect(adjustStock).toHaveBeenCalledTimes(1));
	adjustStock.mockClear();

	// Second tap: now confirming against the 18 they have been shown.
	fireEvent.click(screen.getByRole("button", { name: "Set to 20" }));
	await waitFor(() =>
		expect(adjustStock).toHaveBeenCalledWith({
			adjustments: [{ variantId: "v1", setTo: 20, expectedOnHand: 18 }],
		}),
	);
});

// ---------------------------------------------------------------------------
// StockSheet
// ---------------------------------------------------------------------------

const LINES = (a: number, b: number): StockLine[] => [
	{ variantId: "v1" as Id<"productVariants">, label: "Original", onHand: a },
	{ variantId: "v2" as Id<"productVariants">, label: "Pedas", onHand: b },
];

function sheet(lines: StockLine[]) {
	return render(
		<StockSheet
			open
			onOpenChange={() => {}}
			productName="Keropok Lekor"
			lines={lines}
		/>,
	);
}

test("the sheet sends one batched mutation, deltas only for touched rows", () => {
	sheet(LINES(20, 8));
	// One row moved; the untouched row must not appear in the batch at all.
	fireEvent.click(screen.getByRole("button", { name: "One more Original" }));
	fireEvent.click(screen.getByRole("button", { name: /^Apply/ }));
	expect(adjustStock).toHaveBeenCalledWith({
		adjustments: [{ variantId: "v1", delta: 1 }],
	});
});

test("tapping the mode you are already in does not wipe typed counts", () => {
	// The two segments look identical, so this read as the control breaking.
	sheet(LINES(20, 8));
	fireEvent.click(screen.getByRole("button", { name: "Set exact counts" }));
	const field = screen.getByLabelText("Exact count for Original");
	fireEvent.change(field, { target: { value: "17" } });
	expect(screen.getByRole("button", { name: /^Apply/ })).toBeTruthy();

	fireEvent.click(screen.getByRole("button", { name: "Set exact counts" }));
	expect((screen.getByLabelText("Exact count for Original") as HTMLInputElement).value).toBe("17");
});

test("the mode toggle reports which mode is active", () => {
	sheet(LINES(20, 8));
	expect(
		screen.getByRole("button", { name: "Adjust by" }).getAttribute("aria-pressed"),
	).toBe("true");
	expect(
		screen.getByRole("button", { name: "Set exact counts" }).getAttribute("aria-pressed"),
	).toBe("false");
});

test("a sale landing while the sheet is open warns an exact count and carries the seen number", () => {
	// The sheet had NO live-change notice at all: every row reads live, so an
	// exact count silently overwrote whatever sold while the seller was counting,
	// and `expectedOnHand` refreshed itself on the way out so the server's
	// stale-overwrite guard could never fire from here.
	const { rerender } = sheet(LINES(20, 8));
	fireEvent.click(screen.getByRole("button", { name: "Set exact counts" }));
	fireEvent.change(screen.getByLabelText("Exact count for Original"), {
		target: { value: "17" },
	});

	rerender(
		<StockSheet
			open
			onOpenChange={() => {}}
			productName="Keropok Lekor"
			lines={LINES(18, 8)}
		/>,
	);
	expect(screen.getByText(/2 units sold while you were counting/)).toBeTruthy();

	fireEvent.click(screen.getByRole("button", { name: /^Apply/ }));
	expect(adjustStock).toHaveBeenCalledWith({
		adjustments: [{ variantId: "v1", setTo: 17, expectedOnHand: 20 }],
	});
});
