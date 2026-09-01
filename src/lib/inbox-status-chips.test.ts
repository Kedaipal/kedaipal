import { describe, expect, it } from "vitest";
import {
	BUCKET_LEAVES,
	INBOX_LEAF_KEYS,
} from "../../convex/lib/orderBuckets";
import {
	statusChipSelected,
	statusChipState,
	toggleBucketChip,
	wholeBucketSelected,
} from "./inbox-status-chips";

const NONE: never[] = [];

describe("status chips — one set, two grains", () => {
	it('"All statuses" is on only while the axis is not narrowing', () => {
		expect(statusChipState("all", [], NONE)).toBe("all");
		expect(statusChipState("all", ["packed"], NONE)).toBe("none");
		// Every leaf ticked narrows nothing, so it reads as on — the same answer a
		// parent checkbox gives over fully-ticked children. This is reachable:
		// tap all four bucket chips, or use the panel's Status select-all.
		expect(statusChipState("all", [...INBOX_LEAF_KEYS], NONE)).toBe("all");
		// A booking period DOES narrow (it is not part of the leaf partition)…
		expect(statusChipState("all", [], ["active"])).toBe("none");
		// …UNLESS every leaf is also selected: then the union already matches
		// every order and the periods add nothing. The panel's Status select-all
		// on a booking store produces exactly this state, so getting it wrong
		// puts a dark "All statuses" above a list showing everything.
		expect(
			statusChipState("all", [...INBOX_LEAF_KEYS], ["active", "ending_soon"]),
		).toBe("all");
	});

	it("a bucket chip is tri-state over its own leaves", () => {
		expect(statusChipState("in_progress", [], NONE)).toBe("none");
		expect(statusChipState("in_progress", ["packed"], NONE)).toBe("some");
		expect(
			statusChipState("in_progress", [...BUCKET_LEAVES.in_progress], NONE),
		).toBe("all");
	});

	// THE bug the seller reported: ticking every row under a heading in the panel
	// left that heading's chip dark, because the two wrote different fields.
	it("ticking every leaf of a group in the panel LIGHTS that group's chip", () => {
		for (const [bucket, leaves] of Object.entries(BUCKET_LEAVES)) {
			expect(
				statusChipSelected(bucket as "new", [...leaves], NONE),
			).toBe(true);
			// …and one short of the set is a dash, never off and never on.
			if (leaves.length > 1) {
				expect(
					statusChipSelected(bucket as "new", leaves.slice(1), NONE),
				).toBe("mixed");
			}
		}
	});

	it("selecting any status unlights All, and All clears the row", () => {
		const afterTap = toggleBucketChip("new", [], NONE);
		expect(statusChipState("all", afterTap, NONE)).toBe("none");
		expect(statusChipState("new", afterTap, NONE)).toBe("all");
	});

	it("a partly-filled chip FILLS; a full one clears", () => {
		expect(toggleBucketChip("in_progress", ["packed"], NONE).sort()).toEqual(
			[...BUCKET_LEAVES.in_progress].sort(),
		);
		expect(
			toggleBucketChip("in_progress", [...BUCKET_LEAVES.in_progress], NONE),
		).toEqual([]);
	});

	it("tapping one group never disturbs another group's leaves", () => {
		const mixed = [...BUCKET_LEAVES.completed, "packed"];
		const next = toggleBucketChip("in_progress", mixed, NONE);
		// Completed survives untouched; In progress is completed to its full set.
		for (const leaf of BUCKET_LEAVES.completed) expect(next).toContain(leaf);
		for (const leaf of BUCKET_LEAVES.in_progress) expect(next).toContain(leaf);
		// And no duplicates — `packed` was already in there.
		expect(new Set(next).size).toBe(next.length);
	});

	it("booking periods are members of the row but have no leaves", () => {
		expect(statusChipState("active", [], ["active"])).toBe("all");
		expect(statusChipState("active", [], NONE)).toBe("none");
		// Never "some" — there is nothing to be partial about.
		expect(statusChipState("ending_soon", [], ["active"])).toBe("none");
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
