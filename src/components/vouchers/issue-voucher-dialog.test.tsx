// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { IssueVoucherDialog } from "./issue-voucher-dialog";

// The create mutation, and the live "is this word free?" read (the adapter
// pair, per docs/frontend-caching.md — never `convex/react`'s useQuery).
const createVoucher = vi.fn();
const state: {
	availability: { available: boolean; code: string | null } | undefined;
} = { availability: undefined };
vi.mock("convex/react", () => ({ useMutation: () => createVoucher }));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: state.availability }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const RETAILER = "r1" as Id<"retailers">;

afterEach(cleanup);
beforeEach(() => {
	createVoucher.mockReset();
	state.availability = undefined;
});

function renderDialog() {
	const onIssued = vi.fn();
	render(
		<IssueVoucherDialog
			open
			onClose={vi.fn()}
			retailerId={RETAILER}
			currency="MYR"
			onIssued={onIssued}
		/>,
	);
	return { onIssued };
}

const createButton = () =>
	screen.getByRole("button", { name: /^create (code|voucher|\d+ vouchers)$/i });

/**
 * The shared-code half of the issue form (`z8r3fducfm`). The single-use half
 * is unchanged and covered by the hands-on pass that shipped it; what matters
 * here is that picking "Everyone" reshapes the form, that every disabled state
 * names its reason, and that the payload the server gets is the shared one.
 */
describe("picking Everyone", () => {
	it("swaps the batch count and day-expiry for a word and its bounds", () => {
		renderDialog();
		expect(screen.getByLabelText("How many")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /everyone/i }));
		expect(screen.queryByLabelText("How many")).toBeNull();
		expect(screen.getByLabelText("The code")).toBeTruthy();
		expect(
			screen.getByRole("switch", { name: /limit how many/i }),
		).toBeTruthy();
		expect(
			screen.getByRole("switch", { name: /end at a set time/i }),
		).toBeTruthy();
		expect(createButton().textContent).toMatch(/create code/i);
	});

	it("offers suggestions that follow the value, and a tap fills the word", () => {
		renderDialog();
		fireEvent.click(screen.getByRole("button", { name: /everyone/i }));
		fireEvent.click(screen.getByRole("button", { name: /a percentage/i }));
		fireEvent.change(screen.getByLabelText("What it takes off"), {
			target: { value: "20" },
		});
		fireEvent.click(screen.getByRole("button", { name: "SAVE20" }));
		expect((screen.getByLabelText("The code") as HTMLInputElement).value).toBe(
			"SAVE20",
		);
	});
});

describe("the button is never off without a reason", () => {
	it("walks the seller through value → word → bound", () => {
		renderDialog();
		fireEvent.click(screen.getByRole("button", { name: /everyone/i }));
		expect(screen.getByText(/enter what the voucher is worth/i)).toBeTruthy();

		fireEvent.change(screen.getByLabelText("What it takes off"), {
			target: { value: "10" },
		});
		expect(screen.getByText(/name the code/i)).toBeTruthy();

		fireEvent.change(screen.getByLabelText("The code"), {
			target: { value: "SALE 20" },
		});
		// Said twice on purpose — under the field AND beside the disabled button.
		expect(screen.getAllByText(/letters and numbers only/i).length).toBe(2);

		fireEvent.change(screen.getByLabelText("The code"), {
			target: { value: "SALEDEAL" },
		});
		expect(screen.getAllByText(/single-use codes/i).length).toBeGreaterThan(0);

		fireEvent.change(screen.getByLabelText("The code"), {
			target: { value: "sale20" },
		});
		// Typing upper-cases in place — the word has one spelling.
		expect((screen.getByLabelText("The code") as HTMLInputElement).value).toBe(
			"SALE20",
		);

		// Both bounds off: the one business rule, said where the button is.
		fireEvent.click(screen.getByRole("switch", { name: /limit how many/i }));
		expect(screen.getByText(/can't run forever/i)).toBeTruthy();
		expect(createButton()).toHaveProperty("disabled", true);

		fireEvent.click(screen.getByRole("switch", { name: /limit how many/i }));
		expect(createButton()).toHaveProperty("disabled", false);
	});

	it("a word already running blocks with the server's own answer", () => {
		state.availability = { available: false, code: "SALE20" };
		renderDialog();
		fireEvent.click(screen.getByRole("button", { name: /everyone/i }));
		fireEvent.change(screen.getByLabelText("What it takes off"), {
			target: { value: "10" },
		});
		fireEvent.change(screen.getByLabelText("The code"), {
			target: { value: "SALE20" },
		});
		expect(screen.getAllByText(/already running/i).length).toBeGreaterThan(0);
		expect(createButton()).toHaveProperty("disabled", true);
	});

	it("a free word says so", async () => {
		state.availability = { available: true, code: "SALE20" };
		renderDialog();
		fireEvent.click(screen.getByRole("button", { name: /everyone/i }));
		fireEvent.change(screen.getByLabelText("The code"), {
			target: { value: "SALE20" },
		});
		// The word is debounced before it is asked about, so the line lands a
		// beat after the keystroke.
		await waitFor(() =>
			expect(
				screen.getByText(
					(_, el) => el?.tagName === "P" && el.textContent === "SALE20 is free",
				),
			).toBeTruthy(),
		);
	});
});

describe("what the server gets", () => {
	it("a shared payload — the word, the cap, no count, no day expiry", async () => {
		createVoucher.mockResolvedValue({
			vouchers: [{ code: "SALE20", id: "v1" }],
		});
		const { onIssued } = renderDialog();
		fireEvent.click(screen.getByRole("button", { name: /everyone/i }));
		fireEvent.change(screen.getByLabelText("What it takes off"), {
			target: { value: "10" },
		});
		fireEvent.change(screen.getByLabelText("The code"), {
			target: { value: "SALE20" },
		});
		fireEvent.change(screen.getByLabelText("How many orders"), {
			target: { value: "75" },
		});
		fireEvent.click(createButton());
		await waitFor(() => expect(createVoucher).toHaveBeenCalledTimes(1));
		expect(createVoucher.mock.calls[0][0]).toEqual({
			retailerId: RETAILER,
			usage: "shared",
			kind: "fixed",
			value: 1000,
			code: "SALE20",
			maxRedemptions: 75,
			endsAt: undefined,
			note: undefined,
		});
		await waitFor(() => expect(onIssued).toHaveBeenCalled());
	});
});
