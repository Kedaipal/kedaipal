import { describe, expect, test } from "vitest";
import { MYT_OFFSET_MS, weekdayIndexMyt } from "./fulfilmentDate";
import {
	type DayHours,
	OPEN_ALL_DAY,
	type OpeningHours,
} from "./openingHours";
import {
	NO_CART_PREP,
	prepFloorCopy,
	prepFloorHours,
	prepFloorIssue,
	prepFloorProblem,
	slowestPrep,
} from "./prepFloor";

// Fri 26 Jun 2026, MYT midnight — and a clock builder for that day.
const FRI = Date.UTC(2026, 5, 26) - MYT_OFFSET_MS;
const TOMORROW = FRI + 86_400_000;
const at = (h: number, m = 0) => FRI + (h * 60 + m) * 60_000;
const hm = (h: number, m = 0) => h * 60 + m;

/** Every day open all day, with the given weekday overridden. */
function week(day: DayHours): OpeningHours {
	const fri = weekdayIndexMyt(FRI);
	return Array.from({ length: 7 }, (_, i) =>
		i === fri ? day : { ...OPEN_ALL_DAY },
	);
}

const PUFF = { minutes: 120, productName: "Ice Cream Puff" };

describe("slowestPrep", () => {
	test("the slowest line sets the floor, and names the product", () => {
		expect(
			slowestPrep([
				{ name: "Kuih", prepMinutes: 15 },
				{ name: "Ice Cream Puff", prepMinutes: 240 },
				{ name: "Cream Puff", prepMinutes: 60 },
			]),
		).toEqual({ minutes: 240, productName: "Ice Cream Puff" });
	});

	test("a tie keeps the FIRST product, so the name doesn't flip as items are added", () => {
		expect(
			slowestPrep([
				{ name: "First", prepMinutes: 120 },
				{ name: "Second", prepMinutes: 120 },
			]).productName,
		).toBe("First");
	});

	test("no prep anywhere, junk, or an empty cart all mean no floor", () => {
		expect(slowestPrep([])).toEqual(NO_CART_PREP);
		expect(slowestPrep([{ name: "A" }, { name: "B", prepMinutes: 0 }])).toEqual(
			NO_CART_PREP,
		);
		expect(
			slowestPrep([{ name: "A", prepMinutes: Number.NaN }]).minutes,
		).toBe(0);
	});
});

describe("prepFloorIssue", () => {
	const base = {
		hours: undefined as OpeningHours | undefined,
		dateEpoch: FRI,
		now: at(10),
		prep: PUFF,
		kind: "pickup" as const,
	};

	test("no prep window: never an issue", () => {
		expect(
			prepFloorIssue({ ...base, prep: NO_CART_PREP, timeMinutes: hm(10, 5) }),
		).toBeNull();
	});

	test("THE DONE CRITERION: order at 10:00, 2h prep — 11:00 refused, 12:00 fine", () => {
		expect(prepFloorIssue({ ...base, timeMinutes: hm(11) })).toBe(
			'“Ice Cream Puff” needs 2 hours to prepare — earliest pickup is 12:00 PM',
		);
		expect(prepFloorIssue({ ...base, timeMinutes: hm(12) })).toBeNull();
	});

	test("the noun follows the method", () => {
		expect(
			prepFloorIssue({ ...base, kind: "delivery", timeMinutes: hm(11) }),
		).toMatch(/earliest delivery is 12:00 PM/);
	});

	test("a FUTURE day is never floored — prep is absorbed overnight", () => {
		expect(
			prepFloorIssue({ ...base, dateEpoch: TOMORROW, timeMinutes: hm(7) }),
		).toBeNull();
	});

	test("the named earliest is always a slot a buyer can pick — never inside a break", () => {
		// Breakfast 7:30–10:00, lunch 12:00–18:00; ordering at 9:00 with 2h prep
		// swallows breakfast whole. "now + prep" would say 11:00 — inside the
		// break. The first pickable slot is noon.
		const split = week({ open: hm(7, 30), close: hm(10), open2: hm(12), close2: hm(18) });
		const issue = prepFloorIssue({
			...base,
			hours: split,
			now: at(9),
			timeMinutes: hm(9, 30),
		});
		expect(issue).toMatch(/earliest pickup is 12:00 PM/);
		expect(issue).not.toMatch(/11:00/);
	});

	test("prep that runs past closing makes today too late — not an earliest after close", () => {
		// The bug this module replaced: 18:00 close, ordering at 16:30, 2h prep
		// named "earliest pickup is 6:30 PM", after the shutters were down.
		const shop = week({ open: hm(9), close: hm(18) });
		const issue = prepFloorIssue({
			...base,
			hours: shop,
			now: at(16, 30),
			timeMinutes: hm(17, 45),
		});
		expect(issue).toBe(
			'“Ice Cream Puff” needs 2 hours to prepare — too late for today, pick a later day',
		);
	});

	test("too late for today fires even with NO time chosen", () => {
		// The day-level check, before a time is picked, already knows today is
		// out. (A DATE-ONLY order passes `prepFloorHours` — see below.)
		const shop = week({ open: hm(9), close: hm(18) });
		expect(
			prepFloorIssue({ ...base, hours: shop, now: at(16, 30), timeMinutes: undefined }),
		).toMatch(/too late for today/);
	});

	test("a full day of prep leaves no slot today on a 24/7 store", () => {
		expect(
			prepFloorIssue({
				...base,
				prep: { minutes: 1440, productName: "Wedding tier" },
				now: at(8),
				timeMinutes: hm(23),
			}),
		).toMatch(/too late for today/);
	});

	test("stays silent where the opening-hours gate owns the message", () => {
		const split = week({ open: hm(7, 30), close: hm(10), open2: hm(12), close2: hm(18) });
		// A closed or finished day: both window sets are empty — not prep's fault.
		const closed = week({ ...OPEN_ALL_DAY, closed: true });
		expect(
			prepFloorIssue({ ...base, hours: closed, timeMinutes: hm(12) }),
		).toBeNull();
		// After the earliest slot but inside the break: the hours gate names the
		// break; prep has nothing to add.
		expect(
			prepFloorIssue({ ...base, hours: split, now: at(7), timeMinutes: hm(11) }),
		).toBeNull();
	});

	test("a prep shorter than the checkout lead is not the reason for anything", () => {
		expect(
			prepFloorIssue({
				...base,
				prep: { minutes: 5, productName: "Kuih" },
				timeMinutes: hm(10, 5),
			}),
		).toBeNull();
	});
});

describe("prepFloorHours — the deadline a prep window races", () => {
	const shop = week({ open: hm(9), close: hm(18) });
	const closedFriday = week({ open: hm(9), close: hm(18), closed: true });
	const DAY_PREP = { minutes: 1440, productName: "Wedding tier" };
	const base = { dateEpoch: FRI, timeMinutes: undefined, kind: "pickup" as const };

	test("a timed fulfilment races closing time: the store's hours, untouched", () => {
		expect(prepFloorHours(shop, true)).toBe(shop);
		expect(prepFloorHours(undefined, true)).toBeUndefined();
		expect(prepFloorHours(undefined, false)).toBeUndefined();
	});

	test("a date-only one races midnight on every open day; closed days stay closed", () => {
		const judged = prepFloorHours(closedFriday, false);
		expect(judged?.[weekdayIndexMyt(FRI)]).toEqual(
			closedFriday[weekdayIndexMyt(FRI)],
		);
		expect(
			judged?.filter((day) => !day.closed).every((day) => day.open === 0 && day.close === 1439),
		).toBe(true);
		expect(judged?.filter((day) => !day.closed)).toHaveLength(6);
	});

	test("THE GAP: after closing, a day-long prep is still too late for a date-only today", () => {
		// Against the store's hours, 8 PM has no slot with prep AND none
		// without — right for a timed order, where the hours rules speak, but a
		// date-only order then had nobody refusing it.
		const args = { ...base, prep: DAY_PREP, now: at(20) };
		expect(prepFloorIssue({ ...args, hours: shop })).toBeNull();
		expect(prepFloorIssue({ ...args, hours: prepFloorHours(shop, false) })).toBe(
			"“Wedding tier” needs 24 hours to prepare — too late for today, pick a later day",
		);
	});

	test("closing time isn't a date-only deadline: prep done before midnight is fine", () => {
		// 4:30 PM plus 2h is 6:30 PM — past a 6 PM close, still today.
		const args = { ...base, prep: PUFF, now: at(16, 30) };
		expect(prepFloorIssue({ ...args, hours: shop })).toMatch(/too late for today/);
		expect(prepFloorIssue({ ...args, hours: prepFloorHours(shop, false) })).toBeNull();
	});

	test("a closed weekday stays the opening-hours gate's to refuse", () => {
		expect(
			prepFloorIssue({
				...base,
				prep: DAY_PREP,
				now: at(20),
				hours: prepFloorHours(closedFriday, false),
			}),
		).toBeNull();
	});
});

describe("prepFloorProblem + prepFloorCopy — one sentence, two renderings", () => {
	const args = {
		hours: undefined as OpeningHours | undefined,
		dateEpoch: FRI,
		now: at(10),
		prep: PUFF,
		kind: "pickup" as const,
	};

	test("the problem is data: too early carries the slot, too late carries nothing", () => {
		expect(prepFloorProblem({ ...args, timeMinutes: hm(11) })).toEqual({
			kind: "too_early",
			earliest: hm(12),
		});
		expect(
			prepFloorProblem({ ...args, now: at(22, 30), timeMinutes: undefined }),
		).toEqual({ kind: "too_late_today" });
		expect(prepFloorProblem({ ...args, timeMinutes: hm(12) })).toBeNull();
	});

	test("the copy keeps the time as a value, and joins into the server's exact words", () => {
		const problem = prepFloorProblem({ ...args, timeMinutes: hm(11) });
		if (!problem) throw new Error("expected a prep problem");
		const parts = prepFloorCopy(problem, PUFF, "pickup");
		expect(parts).toContainEqual({ time: hm(12) });
		// The checkout renders these parts; the server throws the joined string.
		expect(prepFloorIssue({ ...args, timeMinutes: hm(11) })).toBe(
			"“Ice Cream Puff” needs 2 hours to prepare — earliest pickup is 12:00 PM",
		);
	});
});
