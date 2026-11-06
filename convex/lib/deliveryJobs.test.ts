import { describe, expect, test } from "vitest";
import {
	ACTIVE_JOB_STATUSES,
	type DeliveryJobStatus,
	isActiveJobStatus,
	isCollectedJobStatus,
	isCourierLinkPending,
	LINK_LANDS_AT_COLLECTION,
	TERMINAL_JOB_STATUSES,
} from "./deliveryJobs";

// Every status the union knows. A new member must be added here AND to
// exactly one of the two sets, or the index-walking reads
// (`lalamoveRiderOutBlock`) silently stop seeing it.
const ALL_STATUSES: readonly DeliveryJobStatus[] = [
	"assigning",
	"ongoing",
	"picked_up",
	"completed",
	"canceled",
	"expired",
	"rejected",
];

describe("deliveryJobs status sets", () => {
	test("every status is active or terminal, never both, never neither", () => {
		for (const status of ALL_STATUSES) {
			const active = ACTIVE_JOB_STATUSES.includes(
				status as (typeof ACTIVE_JOB_STATUSES)[number],
			);
			const terminal = TERMINAL_JOB_STATUSES.has(status);
			expect(active !== terminal, status).toBe(true);
			expect(isActiveJobStatus(status)).toBe(active);
		}
		expect(ACTIVE_JOB_STATUSES.length + TERMINAL_JOB_STATUSES.size).toBe(
			ALL_STATUSES.length,
		);
	});
});

describe("isCourierLinkPending — number on the order, link at collection (z8r3fe0t4e)", () => {
	const booked = {
		provider: "delyva" as const,
		status: "assigning" as const,
		awb: "632195694574",
	};
	const mirrored = { trackingNo: "632195694574" };

	test("pending while a booked job's own number is on the order with no link", () => {
		expect(isCourierLinkPending(booked, mirrored)).toBe(true);
		expect(isCourierLinkPending({ ...booked, status: "ongoing" }, mirrored)).toBe(
			true,
		);
	});

	test("not pending once the courier has the parcel — the link is there or never will be", () => {
		expect(isCourierLinkPending({ ...booked, status: "picked_up" }, mirrored)).toBe(
			false,
		);
		expect(isCourierLinkPending({ ...booked, status: "completed" }, mirrored)).toBe(
			false,
		);
		expect(isCourierLinkPending({ ...booked, status: "rejected" }, mirrored)).toBe(
			false,
		);
	});

	test("a seller's own manual number is never promised a link", () => {
		expect(isCourierLinkPending(booked, { trackingNo: "MANUAL-1" })).toBe(false);
		// Name-only cold-chain courier recorded by hand, no job at all.
		expect(isCourierLinkPending(null, { trackingNo: "MANUAL-1" })).toBe(false);
	});

	test("only a provider that guarantees the link at collection may promise it", () => {
		// Same shape as a Delyva booking, but EasyParcel writes whatever link
		// it has at booking and may still have none at pickup — a number
		// without a link is its honest state, not a dated promise.
		expect(isCourierLinkPending({ ...booked, provider: "easyparcel" }, mirrored)).toBe(
			false,
		);
		expect(isCourierLinkPending({ ...booked, provider: "lalamove" }, mirrored)).toBe(
			false,
		);
		expect(LINK_LANDS_AT_COLLECTION.has("delyva")).toBe(true);
	});

	test("a booking that already carries a link, or no number yet, is not pending", () => {
		expect(
			isCourierLinkPending(booked, {
				...mirrored,
				carrierTrackingUrl: "https://www.jtexpress.my/tracking/632195694574",
			}),
		).toBe(false);
		expect(
			isCourierLinkPending({ provider: "delyva", status: "assigning" }, {}),
		).toBe(false);
	});

	test("isCollectedJobStatus is exactly picked_up and completed", () => {
		for (const status of ALL_STATUSES) {
			expect(isCollectedJobStatus(status), status).toBe(
				status === "picked_up" || status === "completed",
			);
		}
	});
});
