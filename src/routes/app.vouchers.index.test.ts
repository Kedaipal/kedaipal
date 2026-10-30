/**
 * The filtered empty state names WHERE the vouchers are (`z8r3fdr617`).
 *
 * It used to say "Your other vouchers are under the different filters above"
 * — grammatically off, and it made the seller read all four chips to find
 * which one held anything. The counts are already in hand at that point, so
 * the sentence may as well answer the question.
 */
import { describe, expect, it } from "vitest";
import { elsewhereLine, visibleFilters } from "./app.vouchers.index";

const counts = { active: 1, redeemed: 3, expired: 0, voided: 7, scheduled: 0 };

describe("elsewhereLine", () => {
	it("names the non-empty filters with their counts, in chip order", () => {
		expect(elsewhereLine(counts, "expired")).toBe(
			"Active (1), Used (3) and Voided (7)",
		);
	});

	it("leaves out the filter the seller is standing on", () => {
		// They are looking at an empty Active; pointing them back at Active
		// would be the one useless answer.
		expect(elsewhereLine({ ...counts, active: 0 }, "active")).toBe(
			"Used (3) and Voided (7)",
		);
	});

	it("reads as a plain phrase when only one filter holds anything", () => {
		expect(
			elsewhereLine(
				{ active: 0, redeemed: 0, expired: 0, voided: 7, scheduled: 0 },
				"active",
			),
		).toBe("Voided (7)");
	});

	it("falls back to the vague form rather than guessing", () => {
		// Counts not loaded yet, and — the real case — a store whose ONLY
		// vouchers are the ones in the filter being viewed, where naming
		// anything would be false.
		expect(elsewhereLine(undefined, "active")).toBe("the other filters above");
		expect(
			elsewhereLine(
				{ active: 2, redeemed: 0, expired: 0, voided: 0, scheduled: 0 },
				"active",
			),
		).toBe("the other filters above");
	});
});

/**
 * The Scheduled chip (`z8r3fdz0pw`) sits next to Active by meaning, and only
 * shows while a code is waiting to start — a store that never schedules one
 * shouldn't carry a permanently empty chip.
 */
describe("visibleFilters", () => {
	const keys = (
		c: typeof counts | undefined,
		f: Parameters<typeof visibleFilters>[1],
	) => visibleFilters(c, f).map((x) => x.key);

	it("hides Scheduled while nothing is scheduled", () => {
		expect(keys(counts, "active")).toEqual([
			"active",
			"redeemed",
			"expired",
			"voided",
			"all",
		]);
	});

	it("shows it right after Active once a code is waiting", () => {
		expect(keys({ ...counts, scheduled: 2 }, "active")).toEqual([
			"active",
			"scheduled",
			"redeemed",
			"expired",
			"voided",
			"all",
		]);
	});

	it("keeps it while it is the chip in use, so the seller isn't stranded", () => {
		expect(keys(counts, "scheduled")).toContain("scheduled");
	});

	it("names Scheduled in the elsewhere line like any other filter", () => {
		expect(
			elsewhereLine({ ...counts, active: 0, scheduled: 1 }, "active"),
		).toBe("Scheduled (1), Used (3) and Voided (7)");
	});
});
