import { describe, expect, test } from "vitest";
import {
	buildScheduleRows,
	type ScheduleListing,
	type ScheduleOrder,
	scheduleBucket,
} from "./scheduleRows";

const DAY = 24 * 60 * 60 * 1000;
const D1 = Date.parse("2026-11-13T00:00:00+08:00");
const D2 = D1 + DAY;

const luncheon: ScheduleListing = {
	_id: "p_lunch",
	name: "Luncheon",
	kind: "event",
	event: { date: D1, timeMinutes: 12 * 60, seats: 30 },
};
const talk: ScheduleListing = {
	_id: "p_talk",
	name: "Evening talk",
	kind: "event",
	event: { date: D1, timeMinutes: 19 * 60 },
};
const seminar: ScheduleListing = {
	_id: "p_seminar",
	name: "RPJ 5.0",
	kind: "event",
	event: { date: D1, endDate: D2, seats: 50 },
};
const studio: ScheduleListing = { _id: "p_studio", name: "Studio", kind: "booking" };
const all = new Map(
	[luncheon, talk, seminar, studio].map((l) => [l._id, l] as const),
);

function rsvp(
	productId: string,
	over: Partial<ScheduleOrder> & { quantity?: number } = {},
): ScheduleOrder {
	const { quantity = 1, ...rest } = over;
	return {
		status: "confirmed",
		paymentStatus: "unpaid",
		fulfilmentDate: D1,
		deliveryMethod: "self_collect",
		free: false,
		items: [{ productId, quantity }],
		creditGated: false,
		...rest,
	};
}

function booking(over: Partial<ScheduleOrder> = {}): ScheduleOrder {
	return {
		status: "confirmed",
		paymentStatus: "received",
		fulfilmentDate: D1,
		deliveryMethod: "booking",
		bookingProductId: studio._id,
		free: false,
		// A two-night stay: quantity is NIGHTS, which is why a booking row
		// counts orders instead.
		items: [{ productId: studio._id, quantity: 2 }],
		creditGated: false,
		...over,
	};
}

const rows = (orders: ScheduleOrder[], seedEvents: ScheduleListing[] = []) =>
	buildScheduleRows({ orders, listings: all, seedEvents });

describe("buildScheduleRows", () => {
	test("two listings on one date are two rows, ordered by time", () => {
		const out = rows([rsvp(talk._id), rsvp(luncheon._id), rsvp(luncheon._id)]);
		expect(out.map((r) => [r.name, r.registered])).toEqual([
			["Luncheon", 2],
			["Evening talk", 1],
		]);
		expect(out.every((r) => r.date === D1)).toBe(true);
	});

	test("an event counts SEATS, the RSVP panel's unit — a party of three is three", () => {
		const [row] = rows([rsvp(luncheon._id, { quantity: 3 }), rsvp(luncheon._id)]);
		expect(row.registered).toBe(4);
		expect(row.unpaid).toBe(4);
		// …held by two orders, which is what the inbox will list.
		expect(row.orders).toBe(2);
	});

	test("an order with two options of one event is one order on its row", () => {
		const [row] = rows([
			rsvp(luncheon._id, {
				items: [
					{ productId: luncheon._id, quantity: 1 },
					{ productId: luncheon._id, quantity: 2 },
				],
			}),
		]);
		expect(row).toMatchObject({ registered: 3, orders: 1 });
	});

	test("an order waiting on credits holds a seat but isn't an order the seller can open", () => {
		const [row] = rows([rsvp(luncheon._id), rsvp(luncheon._id, { creditGated: true })]);
		expect(row).toMatchObject({ registered: 2, orders: 1, waitingOnCredits: 1 });
	});

	test("a listing with no cap reports no cap, never zero", () => {
		const [row] = rows([rsvp(talk._id)]);
		expect(row.seats).toBeUndefined();
		const [capped] = rows([rsvp(luncheon._id)]);
		expect(capped.seats).toBe(30);
	});

	test("a cancelled order is excluded everywhere", () => {
		const [row] = rows([
			rsvp(luncheon._id),
			rsvp(luncheon._id, { status: "cancelled", quantity: 5 }),
		]);
		expect(row.registered).toBe(1);
		expect(row.unpaid).toBe(1);
	});

	test("a multi-day event is one row on its START date, carrying its span", () => {
		const out = rows([rsvp(seminar._id), rsvp(seminar._id)]);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ date: D1, endDate: D2, registered: 2 });
	});

	test("a booking is one unit per order, whatever its nights", () => {
		const [row] = rows([booking(), booking({ paymentStatus: "unpaid" })]);
		expect(row).toMatchObject({
			kind: "booking",
			name: "Studio",
			registered: 2,
			paid: 1,
			unpaid: 1,
		});
		expect(row.seats).toBeUndefined();
	});

	test("an event nobody has registered for still gets its row", () => {
		const out = rows([], [luncheon]);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ name: "Luncheon", registered: 0, seats: 30 });
	});

	test("the same listing on two dates is two rows, never merged", () => {
		// The event was moved after these two RSVP'd; the buyers were told
		// different days, so each day keeps its own count.
		const out = rows([rsvp(luncheon._id), rsvp(luncheon._id, { fulfilmentDate: D2 })]);
		expect(out.map((r) => [r.date, r.registered])).toEqual([
			[D1, 1],
			[D2, 1],
		]);
		// Only the event's own day claims its cap and time.
		expect(out[1].seats).toBeUndefined();
		expect(out[1].timeMinutes).toBeUndefined();
	});

	test("a plain product on a dated order is not a programme", () => {
		const cake = rsvp("p_cake");
		expect(rows([cake])).toEqual([]);
	});

	test("a booking whose listing is unknown is skipped, not crashed on", () => {
		expect(rows([booking({ bookingProductId: "p_gone", items: [] })])).toEqual([]);
	});

	test("every registered unit lands in exactly one bucket", () => {
		const [row] = rows([
			rsvp(luncheon._id, { paymentStatus: "received", quantity: 2 }),
			rsvp(luncheon._id, { paymentStatus: "claimed" }),
			rsvp(luncheon._id),
			rsvp(luncheon._id, { status: "booking_requested" }),
			rsvp(luncheon._id, { free: true, paymentStatus: undefined }),
			rsvp(luncheon._id, { creditGated: true, paymentStatus: "received" }),
		]);
		expect(row).toMatchObject({
			registered: 7,
			paid: 2,
			claimed: 1,
			unpaid: 1,
			awaitingApproval: 1,
			free: 1,
			waitingOnCredits: 1,
		});
		expect(
			row.paid +
				row.claimed +
				row.unpaid +
				row.awaitingApproval +
				row.free +
				row.waitingOnCredits,
		).toBe(row.registered);
	});
});

describe("scheduleBucket", () => {
	const base = { status: "confirmed" as const, free: false, creditGated: false };

	test("claimed is its own bucket — not paid, not owing", () => {
		expect(scheduleBucket({ ...base, paymentStatus: "claimed" })).toBe("claimed");
		expect(scheduleBucket({ ...base, paymentStatus: "received" })).toBe("paid");
		expect(scheduleBucket({ ...base, paymentStatus: "unpaid" })).toBe("unpaid");
	});

	test("no payment status on a priced order reads as unpaid (legacy rows)", () => {
		expect(scheduleBucket({ ...base, paymentStatus: undefined })).toBe("unpaid");
	});

	test("an unapproved request has had no payment asked for", () => {
		expect(scheduleBucket({ ...base, status: "booking_requested" })).toBe(
			"awaitingApproval",
		);
	});

	test("a free order is never owing, but a paid free order is still paid", () => {
		expect(scheduleBucket({ ...base, free: true })).toBe("free");
		expect(scheduleBucket({ ...base, free: true, paymentStatus: "received" })).toBe(
			"paid",
		);
	});

	test("a gated order is reported as waiting, whatever else is true of it", () => {
		expect(
			scheduleBucket({
				...base,
				status: "booking_requested",
				paymentStatus: "received",
				creditGated: true,
			}),
		).toBe("waitingOnCredits");
	});
});
