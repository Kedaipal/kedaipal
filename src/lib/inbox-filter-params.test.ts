import { describe, expect, it } from "vitest";
import {
	anyInboxFilterActive,
	clearedInboxFilters,
	INBOX_CLEARED_PARAMS,
	INBOX_FILTER_PARAMS,
} from "./inbox-filter-params";

describe("the inbox's filter vocabulary", () => {
	/**
	 * THE invariant, and the one that shipped broken: "Clear filters" appears
	 * because something is counted as a filter, so everything counted must be
	 * something the button actually clears. Home's due span was counted and not
	 * cleared, which turned the empty state into a dead end — tap "Clear
	 * filters" on an empty Thursday, get the same empty Thursday.
	 */
	it("clears everything it counts", () => {
		for (const key of INBOX_FILTER_PARAMS)
			expect(INBOX_CLEARED_PARAMS).toContain(key);
	});

	it("clears the status axis too, which it deliberately does NOT count", () => {
		// A chip tap must not flip the empty state to "No orders match your
		// filters" (PR #243 review) — but "start over" has to let go of it.
		for (const key of ["st", "period"] as const) {
			expect(INBOX_FILTER_PARAMS).not.toContain(key);
			expect(INBOX_CLEARED_PARAMS).toContain(key);
		}
	});

	it("hands back every clearable key PRESENT and undefined", () => {
		const cleared = clearedInboxFilters();
		for (const key of INBOX_CLEARED_PARAMS) {
			// `in`, not `=== undefined`: the route spreads this over the current
			// search, and a missing key leaves the old value in the URL.
			expect(key in cleared).toBe(true);
			expect(cleared[key]).toBeUndefined();
		}
	});

	it("counts the due span, both halves and either alone", () => {
		expect(anyInboxFilterActive({})).toBe(false);
		expect(anyInboxFilterActive({ ffrom: 1, fto: 2 })).toBe(true);
		expect(anyInboxFilterActive({ ffrom: 1 })).toBe(true);
		expect(anyInboxFilterActive({ fto: 2 })).toBe(true);
	});

	it("an empty array and an explicit false are not filters", () => {
		// The same rule the server's `narrowsTheInbox` applies: the predicate
		// treats both as "no filter", so the empty state must agree or the two
		// disagree about whether the seller is filtering at all.
		expect(anyInboxFilterActive({ pay: [], sources: [], ful: [] })).toBe(false);
		expect(anyInboxFilterActive({ mockup: false, munspec: false })).toBe(false);
		expect(anyInboxFilterActive({ mockup: true })).toBe(true);
	});

	it("0 is a real bound, not an absent one", () => {
		// `from`/`to`/`ffrom`/`fto` are epochs, and a falsy-check would read the
		// epoch 0 as unset. Unreachable in practice, but the rule is `!= null`.
		expect(anyInboxFilterActive({ ffrom: 0 })).toBe(true);
	});
});
