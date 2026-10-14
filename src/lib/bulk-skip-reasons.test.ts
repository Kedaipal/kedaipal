import type { FunctionReturnType } from "convex/server";
import { describe, expect, test } from "vitest";
import type { api } from "../../convex/_generated/api";
import { bulkStatusToast, type SkipCounter } from "./bulk-skip-reasons";

type BulkResult = FunctionReturnType<typeof api.orders.bulkUpdateStatus>;

const NONE: BulkResult = {
	updated: 0,
	skipped: 0,
	skippedAwaitingCollection: 0,
	skippedRiderManaged: 0,
	skippedCancelled: 0,
	skippedNoSuchStage: 0,
	skippedCreditGated: 0,
};

function result(over: Partial<BulkResult>): BulkResult {
	return { ...NONE, ...over };
}

/**
 * Every counter the server reports, as a literal list. This is the OTHER half
 * of the completeness proof: `SKIP_PHRASES` being a `Record<SkipCounter, …>`
 * makes a missing phrase a compile error, and the `satisfies` below makes a
 * counter missing from THIS list one too — so adding `skippedWhatever` to
 * `convex/orders.ts` cannot leave either side un-updated.
 */
const ALL_COUNTERS = [
	"skippedCreditGated",
	"skippedAwaitingCollection",
	"skippedRiderManaged",
	"skippedCancelled",
	"skippedNoSuchStage",
] as const satisfies readonly SkipCounter[];
type Covered = (typeof ALL_COUNTERS)[number];
// Load-bearing: red when a counter exists that the list above doesn't name.
const _everyCounterIsCovered: Covered = null as unknown as SkipCounter;
void _everyCounterIsCovered;

describe("bulkStatusToast", () => {
	test("a clean run doesn't mention skipping at all", () => {
		expect(bulkStatusToast(result({ updated: 3 }))).toBe("Updated 3 orders");
		expect(bulkStatusToast(result({ updated: 1 }))).toBe("Updated 1 order");
	});

	// THE regression. The inbox named four of the five skip reasons and the
	// toast read "Updated 1 · skipped 1" with no reason — a silent skip, which
	// is the one thing the house rule forbids. It shipped green because the
	// server test asserted the counter was returned, not that anything read it.
	test("names a credit-gated skip", () => {
		expect(
			bulkStatusToast(
				result({ updated: 1, skipped: 1, skippedCreditGated: 1 }),
			),
		).toBe("Updated 1 · skipped 1 (1 waiting on credits)");
	});

	test("every counter the server reports has a phrase", () => {
		for (const counter of ALL_COUNTERS) {
			const line = bulkStatusToast(
				result({ updated: 0, skipped: 1, [counter]: 1 }),
			);
			expect(line).toMatch(/^Updated 0 · skipped 1 \(.+\)$/);
			// Not a bare count — the phrase has to say something.
			expect(line).not.toBe("Updated 0 · skipped 1 (1)");
		}
	});

	test("lists several reasons, credits first", () => {
		expect(
			bulkStatusToast(
				result({
					updated: 2,
					skipped: 4,
					skippedCancelled: 2,
					skippedCreditGated: 1,
					skippedNoSuchStage: 1,
				}),
			),
		).toBe(
			"Updated 2 · skipped 4 (1 waiting on credits, 2 already cancelled, 1 without that stage (bookings/RSVPs))",
		);
	});

	test("a skip with no counter set still reports the total honestly", () => {
		// The server can skip for a reason it doesn't break out (permissions).
		// Better a bare count than a toast claiming a reason that isn't the one.
		expect(bulkStatusToast(result({ updated: 0, skipped: 2 }))).toBe(
			"Updated 0 · skipped 2",
		);
	});
});
