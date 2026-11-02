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
import { DAY_MS } from "../../../convex/lib/fulfilmentDate";
import {
	type ExtendableVoucher,
	ExtendSharedDialog,
	revivalSentence,
} from "./extend-shared-dialog";

const extend = vi.fn();
vi.mock("convex/react", () => ({ useMutation: () => extend }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(cleanup);
beforeEach(() => {
	extend.mockReset();
});

const live: ExtendableVoucher = {
	id: "v1" as Id<"vouchers">,
	code: "SALE345",
	status: "active",
	maxRedemptions: 50,
	redeemedCount: 12,
	endsAt: Date.now() + 3 * DAY_MS,
};

const save = () =>
	screen.getByRole("button", { name: /^(save|bring it back)$/i });

/**
 * Extending a live shared code (`z8r3fdz0pw`) — more room, never less, and
 * never a different value. The dialog has no field for the value at all.
 */
describe("ExtendSharedDialog", () => {
	it("opens on the code's own bounds, with nothing to save yet", () => {
		render(<ExtendSharedDialog voucher={live} onClose={vi.fn()} />);
		expect(screen.getByText("Extend SALE345")).toBeTruthy();
		expect(screen.getByLabelText("How many orders in total")).toHaveProperty(
			"value",
			"50",
		);
		expect(save()).toHaveProperty("disabled", true);
		expect(screen.getByText("Nothing has changed yet")).toBeTruthy();
		expect(screen.queryByLabelText(/what it takes off/i)).toBeNull();
	});

	it("refuses a LOWER cap with the reason beside the button", () => {
		render(<ExtendSharedDialog voucher={live} onClose={vi.fn()} />);
		fireEvent.change(screen.getByLabelText("How many orders in total"), {
			target: { value: "40" },
		});
		expect(save()).toHaveProperty("disabled", true);
		expect(screen.getByText(/only raise the total — it's 50 now/)).toBeTruthy();
	});

	it("saves a higher cap and keeps the end it had", async () => {
		extend.mockResolvedValue({ ...live, maxRedemptions: 80 });
		const onClose = vi.fn();
		render(<ExtendSharedDialog voucher={live} onClose={onClose} />);
		fireEvent.change(screen.getByLabelText("How many orders in total"), {
			target: { value: "80" },
		});
		fireEvent.click(save());
		await waitFor(() => expect(extend).toHaveBeenCalledTimes(1));
		expect(extend.mock.calls[0][0]).toMatchObject({
			voucherId: "v1",
			maxRedemptions: 80,
		});
		expect(extend.mock.calls[0][0].endsAt).toBeTypeOf("number");
		await waitFor(() => expect(onClose).toHaveBeenCalled());
	});

	it("a code that ran out is BROUGHT BACK, and says so", () => {
		render(
			<ExtendSharedDialog
				voucher={{ ...live, status: "redeemed", redeemedCount: 50 }}
				onClose={vi.fn()}
			/>,
		);
		expect(screen.getByText("Bring SALE345 back")).toBeTruthy();
		expect(screen.getByText(/It ran out with 50 of 50 used/)).toBeTruthy();
		expect(screen.getByRole("button", { name: "Bring it back" })).toBeTruthy();
	});

	it("never offers a later end to a code that RAN OUT — that can't revive it", () => {
		render(
			<ExtendSharedDialog
				voucher={{ ...live, status: "redeemed", redeemedCount: 50 }}
				onClose={vi.fn()}
			/>,
		);
		expect(
			screen.getByText(
				/It ran out with 50 of 50 used\. Raise the total to bring it back\./,
			),
		).toBeTruthy();
		expect(screen.queryByText(/later end/)).toBeNull();
	});

	it("says ONCE that a code needs a bound — not a helper line and a refusal", () => {
		render(<ExtendSharedDialog voucher={live} onClose={vi.fn()} />);
		fireEvent.click(screen.getByRole("switch", { name: "Total orders" }));
		fireEvent.click(screen.getByRole("switch", { name: "End time" }));
		expect(screen.getAllByText(/can't run forever/)).toHaveLength(1);
	});

	it("turning both bounds off is refused — a shared code can't run forever", () => {
		render(<ExtendSharedDialog voucher={live} onClose={vi.fn()} />);
		fireEvent.click(screen.getByRole("switch", { name: "Total orders" }));
		fireEvent.click(screen.getByRole("switch", { name: "End time" }));
		expect(save()).toHaveProperty("disabled", true);
		expect(screen.getAllByText(/can't run forever/).length).toBeGreaterThan(0);
	});
});

/**
 * The revival description names what STOPPED the code (`z8r3fdz0pw` hands-on
 * test): it said "more uses or a later end" to a sold-out code that a later
 * end can never bring back, and only "ran out" to one that had also ended.
 */
describe("revivalSentence", () => {
	const now = Date.parse("2026-10-31T04:00:00+08:00");
	const past = Date.parse("2026-10-31T03:30:00+08:00");
	const future = Date.parse("2026-10-31T06:00:00+08:00");

	it("ran out with its end still ahead: raise the total", () => {
		expect(
			revivalSentence(
				{ maxRedemptions: 1, redeemedCount: 1, endsAt: future },
				now,
			),
		).toBe("It ran out with 1 of 1 used. Raise the total to bring it back.");
	});

	it("ran out with no end at all: raise the total", () => {
		expect(revivalSentence({ maxRedemptions: 1, redeemedCount: 1 }, now)).toBe(
			"It ran out with 1 of 1 used. Raise the total to bring it back.",
		);
	});

	it("ended with uses left: move the end later", () => {
		expect(
			revivalSentence(
				{ maxRedemptions: 50, redeemedCount: 0, endsAt: past },
				now,
			),
		).toBe(
			"It ended 31 Oct 2026, 3:30 AM with 0 of 50 used. Move the end later to bring it back.",
		);
	});

	it("both: names both moves up front, not one after the other", () => {
		expect(
			revivalSentence(
				{ maxRedemptions: 1, redeemedCount: 1, endsAt: past },
				now,
			),
		).toBe(
			"It ran out with 1 of 1 used, and its end time has passed. Raise the total and move the end later to bring it back.",
		);
	});
});
