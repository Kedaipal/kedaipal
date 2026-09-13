import { describe, expect, it } from "vitest";
import type { BookingPeriod } from "../../convex/lib/bookingPeriod";
import { BUCKET_LEAVES } from "../../convex/lib/orderBuckets";
import { inboxEmptyCopy } from "./inbox-empty-copy";

const BASE = {
	searching: false,
	pinOnly: false,
	anyPinned: true,
	mockup: false,
	filtersActive: false,
	statuses: [] as string[],
	periods: [] as BookingPeriod[],
};

describe("inboxEmptyCopy — each arm is reachable and correctly ranked", () => {
	// THE regression this file exists for (PR #243 review): the route counted
	// the status axis as a "filter", so one chip tap always rendered the generic
	// filter line and these two arms were dead code.
	it("exactly one whole bucket gets that bucket's own copy", () => {
		expect(
			inboxEmptyCopy({ ...BASE, statuses: [...BUCKET_LEAVES.completed] }).title,
		).toBe("No completed orders yet");
		expect(
			inboxEmptyCopy({ ...BASE, statuses: [...BUCKET_LEAVES.new] }).title,
		).toBe("No new orders");
	});

	it("a partial group, a mix, or any period gets the chips copy, never the bucket's", () => {
		for (const statuses of [
			["packed"], // partial group
			[...BUCKET_LEAVES.new, "delivered"], // mix across groups
		]) {
			expect(inboxEmptyCopy({ ...BASE, statuses }).title).toBe(
				"Nothing in those statuses",
			);
		}
		// A period-only selection — a seller tapping "Upcoming 0" must not be
		// told they have no orders at all.
		expect(
			inboxEmptyCopy({ ...BASE, periods: ["upcoming"] as BookingPeriod[] })
				.title,
		).toBe("Nothing in those statuses");
		// A whole bucket PLUS a period is not "one whole bucket" either.
		expect(
			inboxEmptyCopy({
				...BASE,
				statuses: [...BUCKET_LEAVES.new],
				periods: ["active"] as BookingPeriod[],
			}).title,
		).toBe("Nothing in those statuses");
	});

	it("a non-status filter outranks the status arms — its copy carries the clear affordance", () => {
		// "No completed orders yet" would be a false claim when a payment filter
		// might be hiding completed orders.
		expect(
			inboxEmptyCopy({
				...BASE,
				filtersActive: true,
				statuses: [...BUCKET_LEAVES.completed],
			}).title,
		).toBe("No orders match your filters");
	});

	// The state the owner hit: "Pinned only" on + a 0-count status chip. The
	// list is empty, the pin chip reads "2", and nothing explained why — the pin
	// is the binding constraint, so it has to be the one named.
	it("pinned-only is named, and outranks mockup and every filter below it", () => {
		expect(
			inboxEmptyCopy({ ...BASE, pinOnly: true, periods: ["upcoming"] }).title,
		).toBe("No pinned orders match");
		// "No orders need a mockup" would be false when UNPINNED mockup orders
		// exist — the pin is what emptied the list, so it outranks that arm.
		expect(inboxEmptyCopy({ ...BASE, pinOnly: true, mockup: true }).title).toBe(
			"No pinned orders match",
		);
		expect(
			inboxEmptyCopy({ ...BASE, pinOnly: true, filtersActive: true }).title,
		).toBe("No pinned orders match");
		// …but the search term still explains itself best.
		expect(
			inboxEmptyCopy({ ...BASE, pinOnly: true, searching: true }).title,
		).toBe("No matches");
		// It names the way out, since "only" is the middle of a 3-way cycle and
		// easy to land on by accident.
		expect(inboxEmptyCopy({ ...BASE, pinOnly: true }).body).toContain(
			"Pinned only",
		);
	});

	// Reachable by unpinning the last row while in "only" mode: the list empties
	// under the seller, and the chip that is their way out now reads 0.
	it("with NO pins at all, pinned-only says so rather than blaming the filters", () => {
		const copy = inboxEmptyCopy({ ...BASE, pinOnly: true, anyPinned: false });
		expect(copy.title).toBe("No pinned orders");
		// "none of them is in the statuses you picked" would be a lie — there are
		// no pins to be anywhere.
		expect(copy.body).not.toContain("none of them");
		// Still names the escape, which is the only one left: with an empty list
		// there is no row to unpin.
		expect(copy.body).toContain("Pinned only");
	});

	it("search outranks everything; mockup outranks filters", () => {
		expect(
			inboxEmptyCopy({
				...BASE,
				searching: true,
				mockup: true,
				filtersActive: true,
				statuses: ["packed"],
			}).title,
		).toBe("No matches");
		expect(
			inboxEmptyCopy({ ...BASE, mockup: true, filtersActive: true }).title,
		).toBe("No orders need a mockup");
	});

	it("nothing on at all is the only state allowed to say 'No orders yet'", () => {
		expect(inboxEmptyCopy(BASE).title).toBe("No orders yet");
	});
});
