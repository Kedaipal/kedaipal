import { describe, expect, it } from "vitest";
import { BOOKING_PERIOD_CHIPS } from "../../convex/lib/bookingPeriod";
import { BUCKET_LEAVES, INBOX_LEAF_KEYS } from "../../convex/lib/orderBuckets";
import {
	statusChipSelected,
	statusChipState,
	toggleBucketChip,
	wholeBucketSelected,
} from "./inbox-status-chips";

const NONE: never[] = [];
/** Every period chip a booking store offers — the row's full period set. */
const ALL_PERIODS = [...BOOKING_PERIOD_CHIPS];

describe("status chips — one set, two grains", () => {
	it('"All statuses" is the select-all over THE ROW — nothing picked, or everything', () => {
		expect(statusChipState("all", [], NONE, NONE)).toBe("all");
		expect(statusChipState("all", ["packed"], NONE, NONE)).toBe("none");
		// A store with NO booking listings offers buckets only, so all eight
		// leaves IS the whole row.
		expect(statusChipState("all", [...INBOX_LEAF_KEYS], NONE, NONE)).toBe(
			"all",
		);
		expect(statusChipState("all", [], ["active"], ALL_PERIODS)).toBe("none");

		// THE owner report (2 Sep): every bucket chip lit and ONE booking chip
		// lit, with two booking chips visibly dark — "All statuses" must not
		// claim everything while the seller can see unlit chips beside it.
		expect(
			statusChipState("all", [...INBOX_LEAF_KEYS], ["upcoming"], ALL_PERIODS),
		).toBe("none");
		// Nor with the buckets alone, while three booking chips sit unlit.
		expect(
			statusChipState("all", [...INBOX_LEAF_KEYS], NONE, ALL_PERIODS),
		).toBe("none");
		// It lights once the row really is fully picked — which is what the
		// panel's Status select-all produces on a booking store, the case that
		// prompted the earlier, over-broad rule (PR #243 review).
		expect(
			statusChipState("all", [...INBOX_LEAF_KEYS], ALL_PERIODS, ALL_PERIODS),
		).toBe("all");
	});

	it("a bucket chip is tri-state over its own leaves", () => {
		expect(statusChipState("in_progress", [], NONE, NONE)).toBe("none");
		expect(statusChipState("in_progress", ["packed"], NONE, NONE)).toBe("some");
		expect(
			statusChipState(
				"in_progress",
				[...BUCKET_LEAVES.in_progress],
				NONE,
				NONE,
			),
		).toBe("all");
	});

	// THE bug the seller reported: ticking every row under a heading in the panel
	// left that heading's chip dark, because the two wrote different fields.
	it("ticking every leaf of a group in the panel LIGHTS that group's chip", () => {
		for (const [bucket, leaves] of Object.entries(BUCKET_LEAVES)) {
			expect(statusChipSelected(bucket as "new", [...leaves], NONE, NONE)).toBe(
				true,
			);
			// …and one short of the set is a dash, never off and never on.
			if (leaves.length > 1) {
				expect(
					statusChipSelected(bucket as "new", leaves.slice(1), NONE, NONE),
				).toBe("mixed");
			}
		}
	});

	it("selecting any status unlights All, and All clears the row", () => {
		const afterTap = toggleBucketChip("new", []);
		expect(statusChipState("all", afterTap, NONE, NONE)).toBe("none");
		expect(statusChipState("new", afterTap, NONE, NONE)).toBe("all");
	});

	it("a partly-filled chip FILLS; a full one clears", () => {
		expect(toggleBucketChip("in_progress", ["packed"]).sort()).toEqual(
			[...BUCKET_LEAVES.in_progress].sort(),
		);
		expect(
			toggleBucketChip("in_progress", [...BUCKET_LEAVES.in_progress]),
		).toEqual([]);
	});

	it("tapping one group never disturbs another group's leaves", () => {
		const mixed = [...BUCKET_LEAVES.completed, "packed"];
		const next = toggleBucketChip("in_progress", mixed);
		// Completed survives untouched; In progress is completed to its full set.
		for (const leaf of BUCKET_LEAVES.completed) expect(next).toContain(leaf);
		for (const leaf of BUCKET_LEAVES.in_progress) expect(next).toContain(leaf);
		// And no duplicates — `packed` was already in there.
		expect(new Set(next).size).toBe(next.length);
	});

	it("booking periods are members of the row but have no leaves", () => {
		expect(statusChipState("active", [], ["active"], ALL_PERIODS)).toBe("all");
		expect(statusChipState("active", [], NONE, ALL_PERIODS)).toBe("none");
		// Never "some" — there is nothing to be partial about.
		expect(statusChipState("ending_soon", [], ["active"], ALL_PERIODS)).toBe(
			"none",
		);
	});
});

describe("wholeBucketSelected — what the empty state may claim", () => {
	it("names the bucket only for an exact, period-free match", () => {
		expect(wholeBucketSelected([...BUCKET_LEAVES.new], NONE)).toBe("new");
		expect(wholeBucketSelected([], NONE)).toBeNull();
		// A partial group must not claim "No new orders".
		expect(wholeBucketSelected(["pending"], NONE)).toBeNull();
		// Nor a mix across groups.
		expect(
			wholeBucketSelected([...BUCKET_LEAVES.new, "delivered"], NONE),
		).toBeNull();
		// Nor a whole bucket with a booking chip also on.
		expect(wholeBucketSelected([...BUCKET_LEAVES.new], ["active"])).toBeNull();
	});
});
