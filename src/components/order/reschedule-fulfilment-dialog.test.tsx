// @vitest-environment jsdom
import {
	act,
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
			// A booking's dates are its check-in and check-out (z8r3fdff97 adds
			// the server backstop).
			{ deliveryMethod: "booking" },
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
		const dateInput = screen.getByLabelText(
			/Delivery date/,
		) as HTMLInputElement;
		const timeInput = screen.getByLabelText(
			/Delivery time/,
		) as HTMLInputElement;
		expect(dateInput.value).toBe(ymdFromEpoch(order.fulfilmentDate as number));
		expect(timeInput.value).toBe(hhmmFromMinutes(3 * 60));

		fireEvent.change(timeInput, { target: { value: "10:00" } });
		fireEvent.click(screen.getByText("Save changes"));

		await waitFor(() =>
			expect(mutate).toHaveBeenCalledWith({
				orderId: order._id,
				fulfilmentDate: order.fulfilmentDate,
				fulfilmentTimeMinutes: 10 * 60,
			}),
		);
	});

	it("an emptied delivery time disables Save with a reason — the preview can't lie", () => {
		// It used to preview date-only while the save quietly kept 3:00 AM.
		render(<RescheduleFulfilmentDialog order={threeAmOrder()} />);
		fireEvent.click(screen.getByText("Reschedule"));
		fireEvent.change(screen.getByLabelText(/Delivery time/), {
			target: { value: "" },
		});
		expect(screen.getByText(/A delivery keeps a time/)).toBeTruthy();
		expect(
			(screen.getByText("Save changes").closest("button") as HTMLButtonElement)
				.disabled,
		).toBe(true);
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
		expect(screen.queryByText("Save changes")).toBeNull();
	});
});

describe("RescheduleFulfilmentDialog — self-collect pickup time (z8r3fdff97)", () => {
	const pickupOrder = (overrides: Record<string, unknown> = {}) =>
		threeAmOrder({
			deliveryMethod: "self_collect",
			fulfilmentTimeMinutes: 15 * 60,
			...overrides,
		});

	it("shows an optional Pickup time, prefilled, and saves a new one", async () => {
		const mutate = vi.fn().mockResolvedValue(undefined);
		state.mutation = mutate;
		const order = pickupOrder();
		render(<RescheduleFulfilmentDialog order={order} />);
		fireEvent.click(screen.getByText("Reschedule"));

		const time = screen.getByLabelText(/Pickup time/) as HTMLInputElement;
		expect(time.value).toBe("15:00");
		expect(screen.getByText(/Optional — leave blank/)).toBeTruthy();
		fireEvent.change(time, { target: { value: "17:00" } });
		fireEvent.click(screen.getByText("Save changes"));
		await waitFor(() =>
			expect(mutate).toHaveBeenCalledWith({
				orderId: order._id,
				fulfilmentDate: order.fulfilmentDate,
				fulfilmentTimeMinutes: 17 * 60,
			}),
		);
	});

	it("the save button doesn't promise a new DATE when only the time moved", async () => {
		// The dialog was date-only when it was built; z8r3fdff97 gave it a time,
		// so "Save new date" sat under a form whose only change was 3 PM → 5 PM.
		const mutate = vi.fn().mockResolvedValue(undefined);
		state.mutation = mutate;
		const order = pickupOrder();
		render(<RescheduleFulfilmentDialog order={order} />);
		fireEvent.click(screen.getByText("Reschedule"));

		fireEvent.change(screen.getByLabelText(/Pickup time/), {
			target: { value: "17:00" },
		});
		const save = screen.getByText("Save changes").closest("button");
		expect(save).toBeTruthy();
		expect(screen.queryByText("Save new date")).toBeNull();
		fireEvent.click(save as HTMLButtonElement);
		await waitFor(() =>
			expect(mutate).toHaveBeenCalledWith({
				orderId: order._id,
				fulfilmentDate: order.fulfilmentDate,
				fulfilmentTimeMinutes: 17 * 60,
			}),
		);
	});

	it("Clear time removes the pickup time and says what that means", async () => {
		const mutate = vi.fn().mockResolvedValue(undefined);
		state.mutation = mutate;
		const order = pickupOrder();
		render(<RescheduleFulfilmentDialog order={order} />);
		fireEvent.click(screen.getByText("Reschedule"));

		fireEvent.click(screen.getByRole("button", { name: "Clear time" }));
		expect(
			screen.getByText(
				"Removes the 3:00 PM pickup time — the buyer can come any time that day.",
			),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Clear time" })).toBeNull();
		fireEvent.click(screen.getByText("Save changes"));
		await waitFor(() =>
			expect(mutate).toHaveBeenCalledWith({
				orderId: order._id,
				fulfilmentDate: order.fulfilmentDate,
				fulfilmentTimeMinutes: null,
			}),
		);
	});

	it("a pickup with no time saves as 'keep' — never inventing one, never a clear", async () => {
		const mutate = vi.fn().mockResolvedValue(undefined);
		state.mutation = mutate;
		const order = pickupOrder({ fulfilmentTimeMinutes: undefined });
		render(<RescheduleFulfilmentDialog order={order} />);
		fireEvent.click(screen.getByText("Reschedule"));

		expect(
			(screen.getByLabelText(/Pickup time/) as HTMLInputElement).value,
		).toBe("");
		expect(screen.queryByRole("button", { name: "Clear time" })).toBeNull();
		expect(screen.queryByText(/Removes the/)).toBeNull();
		fireEvent.click(screen.getByText("Save changes"));
		await waitFor(() =>
			expect(mutate).toHaveBeenCalledWith({
				orderId: order._id,
				fulfilmentDate: order.fulfilmentDate,
				fulfilmentTimeMinutes: undefined,
			}),
		);
	});

	it("a passed pickup time today is refused (fixed clock: 12:00 MYT)", () => {
		vi.useFakeTimers({ now: new Date("2026-08-20T04:00:00Z") }); // 12:00 MYT
		try {
			render(<RescheduleFulfilmentDialog order={pickupOrder()} />);
			fireEvent.click(screen.getByText("Reschedule"));
			fireEvent.change(screen.getByLabelText(/Pickup date/), {
				target: { value: ymdFromEpoch(todayMytMidnight()) },
			});
			fireEvent.change(screen.getByLabelText(/Pickup time/), {
				target: { value: "09:00" },
			});
			expect(
				screen.getByText(/That time has already passed today/),
			).toBeTruthy();
		} finally {
			vi.useRealTimers();
		}
	});

	it("a drop-off meet-up stays date-only and shows the point's own schedule", () => {
		render(
			<RescheduleFulfilmentDialog
				order={pickupOrder({
					fulfilmentTimeMinutes: undefined,
					pickupSnapshot: {
						label: "Pasar Tani SS2",
						address: "SS2",
						locationType: "drop_off",
						scheduleNote: "Every Sat 3–5pm",
					},
				})}
			/>,
		);
		fireEvent.click(screen.getByText("Reschedule"));
		expect(screen.getByLabelText(/Meet-up date/)).toBeTruthy();
		expect(screen.queryByLabelText(/time/i)).toBeNull();
		expect(screen.getByText("Every Sat 3–5pm")).toBeTruthy();
		expect(
			screen.getByText(/meet the buyer at the drop-off point/),
		).toBeTruthy();
	});

	it("never asks Lalamove for a price", async () => {
		state.dispatch = {
			job: null,
			blockReason: null,
			bookingEnabled: true,
			riderOnlyStore: true,
			promptBookOnPacked: false,
		};
		const prepare = vi.fn();
		state.action = prepare;
		render(<RescheduleFulfilmentDialog order={pickupOrder()} />);
		fireEvent.click(screen.getByText("Reschedule"));
		await new Promise((r) => setTimeout(r, 800));
		expect(prepare).not.toHaveBeenCalled();
		expect(screen.queryByText("Lalamove for this slot")).toBeNull();
	});
});

describe("RescheduleFulfilmentDialog — Lalamove slot-price preview", () => {
	it("shows the rider price for the picked slot on a bookable Lalamove order", async () => {
		state.dispatch = {
			job: null,
			blockReason: null,
			bookingEnabled: true,
			riderOnlyStore: true,
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
			market: "MY",
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
			riderOnlyStore: false,
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
		const dateInput = screen.getByLabelText(
			/Delivery date/,
		) as HTMLInputElement;
		expect(dateInput.value).toBe(ymdFromEpoch(todayMytMidnight()));
	});

	it("a typed past date disables Save with a visible reason", () => {
		render(<RescheduleFulfilmentDialog order={threeAmOrder()} />);
		fireEvent.click(screen.getByText("Reschedule"));
		fireEvent.change(screen.getByLabelText(/Delivery date/), {
			target: { value: ymdFromEpoch(todayMytMidnight() - DAY_MS) },
		});
		expect(screen.getByText(/That day has already passed/)).toBeTruthy();
		const save = screen.getByText("Save changes").closest("button");
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
			(screen.getByText("Save changes").closest("button") as HTMLButtonElement)
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

describe("RescheduleFulfilmentDialog — PR #201 review regressions", () => {
	it("an in-flight quote for a superseded moment never paints under the error", async () => {
		state.dispatch = {
			job: null,
			blockReason: null,
			bookingEnabled: true,
			riderOnlyStore: true,
			promptBookOnPacked: false,
		};
		let resolveQuote: (v: unknown) => void = () => {};
		const prepare = vi.fn().mockImplementation(
			() =>
				new Promise((r) => {
					resolveQuote = r;
				}),
		);
		state.action = prepare;
		render(<RescheduleFulfilmentDialog order={threeAmOrder()} />);

		fireEvent.click(screen.getByText("Reschedule"));
		// Valid prefill → the debounced quote fires and hangs in flight.
		await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1), {
			timeout: 2500,
		});
		// Supersede it with an invalid pick BEFORE the quote resolves.
		fireEvent.change(screen.getByLabelText(/Delivery date/), {
			target: { value: ymdFromEpoch(todayMytMidnight() - DAY_MS) },
		});
		expect(screen.getByText(/That day has already passed/)).toBeTruthy();
		// The stale quote lands nowhere — no "ready" card under the error.
		await act(async () => {
			resolveQuote({
				ok: true,
				quotationId: "q",
				senderStopId: "s",
				recipientStopId: "r",
				fee: 1200,
				buyerPaidFee: 400,
				vehicleType: "MOTORCYCLE",
				buyerContactFallback: false,
				market: "MY",
				scheduledFor: Date.now() + 24 * 60 * 60 * 1000,
				buyerRequestedMoment: undefined,
			});
			await Promise.resolve();
		});
		expect(screen.queryByText("Lalamove for this slot")).toBeNull();
	});

	it("Save re-judges the clock — a moment that passed while the dialog sat open never fires the mutation", () => {
		vi.useFakeTimers({ now: new Date("2026-08-20T04:00:00Z") }); // 12:00 MYT
		try {
			const mutate = vi.fn();
			state.mutation = mutate;
			render(<RescheduleFulfilmentDialog order={threeAmOrder()} />);

			fireEvent.click(screen.getByText("Reschedule"));
			fireEvent.change(screen.getByLabelText(/Delivery date/), {
				target: { value: ymdFromEpoch(todayMytMidnight()) },
			});
			fireEvent.change(screen.getByLabelText(/Delivery time/), {
				target: { value: "13:00" }, // an hour ahead — valid, Save enabled
			});
			const save = screen
				.getByText("Save changes")
				.closest("button") as HTMLButtonElement;
			expect(save.disabled).toBe(false);

			// The seller walks away; the picked moment passes with no re-render.
			vi.setSystemTime(new Date("2026-08-20T06:00:00Z")); // 14:00 MYT
			fireEvent.click(save);
			expect(mutate).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});
