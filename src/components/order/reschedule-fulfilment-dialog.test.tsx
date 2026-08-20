// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Doc } from "../../../convex/_generated/dataModel";
import {
	hhmmFromMinutes,
	todayMytMidnight,
	ymdFromEpoch,
} from "../../../convex/lib/fulfilmentDate";
import { RescheduleFulfilmentDialog } from "./reschedule-fulfilment-dialog";

// Same harness as book-delivery-card.test.tsx: stub the adapter pair (the
// dialog reads getDeliveryJob via useQuery(convexQuery(...)).data) and
// convex/react's useMutation.
const state = vi.hoisted(() => ({
	dispatch: null as unknown,
	mutation: undefined as unknown,
	action: undefined as unknown,
}));
vi.mock("convex/react", () => ({
	useMutation: () => state.mutation ?? vi.fn(),
	// Backs prepareBooking (the Lalamove slot-price preview).
	useAction: () => state.action ?? vi.fn(),
}));
vi.mock("@convex-dev/react-query", () => ({
	convexQuery: (fn: unknown, args: unknown) => ({ fn, args }),
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: state.dispatch }),
}));

afterEach(() => {
	cleanup();
	state.dispatch = null;
	state.mutation = undefined;
	state.action = undefined;
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** The driver scenario: a confirmed delivery order 2 days out, 3:00 AM. */
function threeAmOrder(overrides: Record<string, unknown> = {}) {
	return {
		_id: "order1",
		shortId: "ORD-TEST",
		status: "confirmed",
		deliveryMethod: "delivery",
		currency: "MYR",
		source: undefined,
		collectedAt: undefined,
		fulfilmentDate: todayMytMidnight() + 2 * DAY_MS,
		fulfilmentTimeMinutes: 3 * 60,
		...overrides,
	} as unknown as Doc<"orders">;
}

describe("RescheduleFulfilmentDialog — trigger window", () => {
	it("renders Reschedule inside the window (pre-shipped, non-counter)", () => {
		render(<RescheduleFulfilmentDialog order={threeAmOrder()} />);
		expect(screen.getByText("Reschedule")).toBeTruthy();
	});

	it('offers "Set date" on a dateless legacy order instead of a dead control', () => {
		render(
			<RescheduleFulfilmentDialog
				order={threeAmOrder({
					fulfilmentDate: undefined,
					fulfilmentTimeMinutes: undefined,
				})}
			/>,
		);
		expect(screen.getByText("Set date")).toBeTruthy();
	});

	it("renders nothing once shipped, on counter orders, and after collection", () => {
		for (const overrides of [
			{ status: "shipped" },
			{ status: "delivered" },
			{ status: "cancelled" },
			{ source: "counter" },
			{ collectedAt: Date.now() },
		]) {
			const { unmount } = render(
				<RescheduleFulfilmentDialog order={threeAmOrder(overrides)} />,
			);
			expect(screen.queryByText("Reschedule")).toBeNull();
			unmount();
		}
	});
});

describe("RescheduleFulfilmentDialog — form", () => {
	it("prefills the buyer's moment and submits the agreed new time", async () => {
		const mutate = vi.fn().mockResolvedValue(undefined);
		state.mutation = mutate;
		const order = threeAmOrder();
		render(<RescheduleFulfilmentDialog order={order} />);

		fireEvent.click(screen.getByText("Reschedule"));
		const dateInput = screen.getByLabelText(/Delivery date/) as HTMLInputElement;
		const timeInput = screen.getByLabelText(/Delivery time/) as HTMLInputElement;
		expect(dateInput.value).toBe(
			ymdFromEpoch(order.fulfilmentDate as number),
		);
		expect(timeInput.value).toBe(hhmmFromMinutes(3 * 60));

		fireEvent.change(timeInput, { target: { value: "10:00" } });
		fireEvent.click(screen.getByText("Save new date"));

		await waitFor(() =>
			expect(mutate).toHaveBeenCalledWith({
				orderId: order._id,
				fulfilmentDate: order.fulfilmentDate,
				fulfilmentTimeMinutes: 10 * 60,
			}),
		);
	});

	it("hides the time input on self-collect orders — they are date-only", () => {
		render(
			<RescheduleFulfilmentDialog
				order={threeAmOrder({
					deliveryMethod: "self_collect",
					fulfilmentTimeMinutes: undefined,
				})}
			/>,
		);
		fireEvent.click(screen.getByText("Reschedule"));
		expect(screen.getByLabelText(/Pickup date/)).toBeTruthy();
		expect(screen.queryByLabelText(/time/i)).toBeNull();
	});

	it("an ACTIVE rider booking opens onto the blocked explanation, not the form", () => {
		state.dispatch = {
			job: { status: "assigning" },
			blockReason: null,
			promptBookOnPacked: false,
		};
		render(<RescheduleFulfilmentDialog order={threeAmOrder()} />);
		fireEvent.click(screen.getByText("Reschedule"));

		expect(screen.getByText(/booking is active/i)).toBeTruthy();
		expect(screen.queryByText("Save new date")).toBeNull();
	});
});

describe("RescheduleFulfilmentDialog — Lalamove slot-price preview", () => {
	it("shows the rider price for the picked slot on a bookable Lalamove order", async () => {
		state.dispatch = {
			job: null,
			blockReason: null,
			bookingEnabled: true,
			promptBookOnPacked: false,
		};
		const prepare = vi.fn().mockResolvedValue({
			ok: true,
			quotationId: "q-preview",
			senderStopId: "s",
			recipientStopId: "r",
			fee: 1200,
			buyerPaidFee: 400,
			vehicleType: "MOTORCYCLE",
			buyerContactFallback: false,
			scheduledFor: Date.now() + 24 * 60 * 60 * 1000,
			buyerRequestedMoment: Date.now() + 24 * 60 * 60 * 1000,
		});
		state.action = prepare;
		render(<RescheduleFulfilmentDialog order={threeAmOrder()} />);

		fireEvent.click(screen.getByText("Reschedule"));
		// Debounced (500ms) live quote for the prefilled moment.
		expect(
			await screen.findByText("Lalamove for this slot", {}, { timeout: 2500 }),
		).toBeTruthy();
		expect(
			await screen.findByText(/RM\s?12\.00/, {}, { timeout: 2500 }),
		).toBeTruthy();
		// The buyer's frozen fee is named, never re-priced.
		expect(screen.getByText(/Buyer paid RM\s?4\.00/)).toBeTruthy();
		expect(prepare).toHaveBeenCalledWith(
			expect.objectContaining({ shortId: "ORD-TEST" }),
		);
	});

	it("never quotes on a store without Lalamove booking", async () => {
		state.dispatch = {
			job: null,
			blockReason: null,
			bookingEnabled: false,
			promptBookOnPacked: false,
		};
		const prepare = vi.fn();
		state.action = prepare;
		render(<RescheduleFulfilmentDialog order={threeAmOrder()} />);

		fireEvent.click(screen.getByText("Reschedule"));
		// Outwait the debounce window — nothing may fire or render.
		await new Promise((r) => setTimeout(r, 800));
		expect(screen.queryByText("Lalamove for this slot")).toBeNull();
		expect(prepare).not.toHaveBeenCalled();
	});
});

describe("RescheduleFulfilmentDialog — past moments are refused (86eyp63xn follow-up)", () => {
	it("an overdue order prefills TODAY, never its own passed date", () => {
		render(
			<RescheduleFulfilmentDialog
				order={threeAmOrder({
					fulfilmentDate: todayMytMidnight() - 2 * DAY_MS,
				})}
			/>,
		);
		fireEvent.click(screen.getByText("Reschedule"));
		const dateInput = screen.getByLabelText(/Delivery date/) as HTMLInputElement;
		expect(dateInput.value).toBe(ymdFromEpoch(todayMytMidnight()));
	});

	it("a typed past date disables Save with a visible reason", () => {
		render(<RescheduleFulfilmentDialog order={threeAmOrder()} />);
		fireEvent.click(screen.getByText("Reschedule"));
		fireEvent.change(screen.getByLabelText(/Delivery date/), {
			target: { value: ymdFromEpoch(todayMytMidnight() - DAY_MS) },
		});
		expect(screen.getByText(/That day has already passed/)).toBeTruthy();
		const save = screen.getByText("Save new date").closest("button");
		expect(save?.disabled).toBe(true);
	});

	it("a beyond-30-days date is refused the same way", () => {
		render(<RescheduleFulfilmentDialog order={threeAmOrder()} />);
		fireEvent.click(screen.getByText("Reschedule"));
		fireEvent.change(screen.getByLabelText(/Delivery date/), {
			target: { value: ymdFromEpoch(todayMytMidnight() + 31 * DAY_MS) },
		});
		expect(screen.getByText(/at most 30 days/)).toBeTruthy();
		expect(
			(screen.getByText("Save new date").closest("button") as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});

	it("a passed time TODAY is refused (fixed clock: 12:00 MYT)", () => {
		vi.useFakeTimers({ now: new Date("2026-08-20T04:00:00Z") }); // 12:00 MYT
		try {
			render(<RescheduleFulfilmentDialog order={threeAmOrder()} />);
			fireEvent.click(screen.getByText("Reschedule"));
			fireEvent.change(screen.getByLabelText(/Delivery date/), {
				target: { value: ymdFromEpoch(todayMytMidnight()) },
			});
			fireEvent.change(screen.getByLabelText(/Delivery time/), {
				target: { value: "09:00" },
			});
			expect(
				screen.getByText(/That time has already passed today/),
			).toBeTruthy();
			// A future time the same day clears it.
			fireEvent.change(screen.getByLabelText(/Delivery time/), {
				target: { value: "18:00" },
			});
			expect(
				screen.queryByText(/That time has already passed today/),
			).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});
});
