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
}));
vi.mock("convex/react", () => ({
	useMutation: () => state.mutation ?? vi.fn(),
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
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** The driver scenario: a confirmed delivery order 2 days out, 3:00 AM. */
function threeAmOrder(overrides: Record<string, unknown> = {}) {
	return {
		_id: "order1",
		shortId: "ORD-TEST",
		status: "confirmed",
		deliveryMethod: "delivery",
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
