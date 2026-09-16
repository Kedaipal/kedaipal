import { describe, expect, test } from "vitest";
import { MYT_OFFSET_MS, weekdayIndexMyt } from "./fulfilmentDate";
import {
	type DayHours,
	OPEN_ALL_DAY,
	type OpeningHours,
} from "./openingHours";
import {
	NO_CART_PREP,
	prepFloorIssue,
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
			'"Ice Cream Puff" needs 2 hours to prepare — earliest pickup is 12:00 PM',
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
			'"Ice Cream Puff" needs 2 hours to prepare — too late for today, pick a later day',
		);
	});

	test("too late for today fires even with NO time chosen", () => {
		// A date-only order still can't be ready today.
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
