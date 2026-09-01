import { describe, expect, it } from "vitest";
import type { BookingPeriod } from "../../convex/lib/bookingPeriod";
import { BUCKET_LEAVES } from "../../convex/lib/orderBuckets";
import { inboxEmptyCopy } from "./inbox-empty-copy";

const BASE = {
	searching: false,
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
