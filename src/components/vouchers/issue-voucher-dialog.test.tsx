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
	it("says a shared word is not secret, and keeps saying it once the word is free", async () => {
		state.availability = { available: true, code: "SALE20" };
		renderDialog();
		fireEvent.click(screen.getByRole("button", { name: /everyone/i }));
		expect(screen.getByText(/It isn't secret/)).toBeTruthy();
		fireEvent.change(screen.getByLabelText("The code"), {
			target: { value: "SALE20" },
		});
		await waitFor(() =>
			expect(
				screen.getByText(
					(_, el) => el?.tagName === "P" && el.textContent === "SALE20 is free",
				),
			).toBeTruthy(),
		);
		expect(screen.getByText(/It isn't secret/)).toBeTruthy();
	});

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
			// v2 (`z8r3fdz0pw`): one per buyer unless the seller turns it off.
			startsAt: undefined,
			perBuyerLimit: 1,
			minSpend: undefined,
			maxDiscount: undefined,
			note: undefined,
		});
		await waitFor(() => expect(onIssued).toHaveBeenCalled());
	});
});

/**
 * Shared codes v2 (`z8r3fdz0pw`): the per-buyer limit, the minimum spend,
 * the per-order cap and the scheduled start. Each one states its consequence
 * where it is set, and the disabled button names the reason.
 */
describe("v2 — who qualifies, the cap, the start", () => {
	function shareSetup() {
		state.availability = { available: true, code: "SALE20" };
		const out = renderDialog();
		fireEvent.click(screen.getByRole("button", { name: /everyone/i }));
		fireEvent.change(screen.getByLabelText("The code"), {
			target: { value: "SALE20" },
		});
		return out;
	}

	it("a shared code is one per buyer by default, and says what that means", () => {
		shareSetup();
		expect(screen.getByLabelText("Orders per buyer")).toHaveProperty(
			"value",
			"1",
		);
		expect(
			screen.getByText(/Checked against the buyer's WhatsApp number/),
		).toBeTruthy();
		expect(screen.getByText(/counts toward the total only/)).toBeTruthy();
	});

	it("turning the per-buyer limit off says what is now possible", () => {
		shareSetup();
		fireEvent.click(screen.getByRole("switch", { name: "Limit per buyer" }));
		expect(
			screen.getByText(/one buyer can use it again and again/),
		).toBeTruthy();
	});

	it("a single-use voucher offers the minimum spend but never the per-buyer limit", () => {
		renderDialog();
		expect(screen.getByRole("switch", { name: "Minimum spend" })).toBeTruthy();
		expect(
			screen.queryByRole("switch", { name: "Limit per buyer" }),
		).toBeNull();
	});

	it("the cap is offered on a percentage only, and its sentence does the maths", () => {
		renderDialog();
		expect(
			screen.queryByRole("switch", { name: "Cap the discount" }),
		).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /a percentage/i }));
		fireEvent.change(screen.getByLabelText("What it takes off"), {
			target: { value: "20" },
		});
		fireEvent.click(screen.getByRole("switch", { name: "Cap the discount" }));
		fireEvent.change(screen.getByLabelText("Most it takes off one order"), {
			target: { value: "15" },
		});
		expect(
			screen.getByText(/20% off, up to RM\s15\.00\. A basket over RM\s75\.00/),
		).toBeTruthy();
	});

	it("a big shared percentage gets a caution, never a refusal", () => {
		shareSetup();
		fireEvent.click(screen.getByRole("button", { name: /a percentage/i }));
		fireEvent.change(screen.getByLabelText("What it takes off"), {
			target: { value: "60" },
		});
		expect(screen.getByText(/60% off for anyone with the word/)).toBeTruthy();
		expect(createButton()).toHaveProperty("disabled", false);
	});

	it("a minimum spend left empty blocks Create with the reason", () => {
		shareSetup();
		fireEvent.click(screen.getByRole("switch", { name: "Minimum spend" }));
		expect(createButton()).toHaveProperty("disabled", true);
		expect(
			screen.getAllByText(/Enter the least a buyer has to spend/).length,
		).toBeGreaterThan(0);
	});

	it("Later… asks for a start and states what buyers are told", () => {
		shareSetup();
		fireEvent.click(screen.getByRole("button", { name: /later/i }));
		expect(screen.getByText(/shows as Scheduled/)).toBeTruthy();
	});

	it("a single-use payload carries the minimum spend", async () => {
		createVoucher.mockResolvedValue({
			vouchers: [{ code: "KP-AAAA-BBBB", id: "v1", status: "active" }],
		});
		renderDialog();
		fireEvent.change(screen.getByLabelText("What it takes off"), {
			target: { value: "10" },
		});
		fireEvent.click(screen.getByRole("switch", { name: "Minimum spend" }));
		fireEvent.change(screen.getByLabelText("Least a buyer spends on items"), {
			target: { value: "50" },
		});
		fireEvent.click(createButton());
		await waitFor(() => expect(createVoucher).toHaveBeenCalledTimes(1));
		expect(createVoucher.mock.calls[0][0]).toMatchObject({
			kind: "fixed",
			value: 1000,
			minSpend: 5000,
			maxDiscount: undefined,
		});
	});
});
