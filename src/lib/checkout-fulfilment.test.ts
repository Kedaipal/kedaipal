import { describe, expect, test } from "vitest";
import {
	MYT_OFFSET_MS,
	weekdayIndexMyt,
} from "../../convex/lib/fulfilmentDate";
import {
	type DayHours,
	OPEN_ALL_DAY,
	type OpeningHours,
} from "../../convex/lib/openingHours";
import { NO_CART_PREP } from "../../convex/lib/prepFloor";
import {
	asksForTime,
	fulfilmentDayCopy,
	fulfilmentKind,
	fulfilmentTimeCopy,
	isFulfilmentDaySelectable,
	prepForFulfilment,
	prepHint,
	resolveLineRules,
} from "./checkout-fulfilment";
import { type CopyPart, copyText } from "./fulfilment-time-issue";

/** A sentence as the submit banner reads it; null stays null. */
const text = (parts: CopyPart[] | null) => (parts ? copyText(parts) : null);

// Fri 26 Jun 2026, MYT midnight — and a clock builder for that day.
const FRI = Date.UTC(2026, 5, 26) - MYT_OFFSET_MS;
const SAT = FRI + 86_400_000;
const at = (h: number, m = 0) => FRI + (h * 60 + m) * 60_000;
const hm = (h: number, m = 0) => h * 60 + m;

/** Every day open all day, with Friday overridden. */
function week(friday: DayHours): OpeningHours {
	const fri = weekdayIndexMyt(FRI);
	return Array.from({ length: 7 }, (_, i) =>
		i === fri ? friday : { ...OPEN_ALL_DAY },
	);
}
const NINE_TO_SIX = week({ open: hm(9), close: hm(18) });
const SPLIT = week({
	open: hm(7, 30),
	close: hm(10),
	open2: hm(12),
	close2: hm(18),
});
const CLOSED_FRIDAY = week({ open: hm(9), close: hm(18), closed: true });

const PUFF = { minutes: 120, productName: "Ice Cream Puff" };
const DAY_PREP = { minutes: 1440, productName: "Wedding tier" };
const base = { storeName: "Huff & Puff", closedDates: undefined };

describe("resolveLineRules — live first, the cart's snapshot as fallback", () => {
	const line = {
		name: "Puff",
		prepMinutes: 30,
		pickupNote: "Old note.",
		minNoticeDays: 0,
	};

	test("the live product wins — a seller who raised prep after the add is judged now", () => {
		expect(
			resolveLineRules(line, {
				name: "Ice Cream Puff",
				prepMinutes: 120,
				pickupNote: "Side counter.",
				minNoticeDays: 1,
			}),
		).toEqual({
			name: "Ice Cream Puff",
			prepMinutes: 120,
			pickupNote: "Side counter.",
			minNoticeDays: 1,
		});
	});

	test("a cart saved before prep existed takes the live values", () => {
		expect(
			resolveLineRules(
				{ name: "Puff" },
				{ prepMinutes: 90, pickupNote: "Bell." },
			),
		).toMatchObject({ prepMinutes: 90, pickupNote: "Bell." });
	});

	test("a note the seller REMOVED stays removed — live, not the snapshot", () => {
		expect(resolveLineRules(line, {}).pickupNote).toBeUndefined();
	});

	test("no live product (loading, or left the list) falls back to the snapshot", () => {
		expect(resolveLineRules(line, undefined)).toEqual({
			name: "Puff",
			prepMinutes: 30,
			pickupNote: "Old note.",
			minNoticeDays: 0,
		});
		expect(resolveLineRules({ name: "Bare" }, undefined)).toEqual({
			name: "Bare",
			prepMinutes: 0,
			pickupNote: undefined,
			minNoticeDays: 0,
		});
	});
});

describe("which fulfilment asks for a time", () => {
	test("kinds follow the method and the store's direction", () => {
		expect(fulfilmentKind("delivery", false)).toBe("delivery");
		expect(fulfilmentKind("delivery", true)).toBe("collection");
		expect(fulfilmentKind("self_collect", true)).toBe("pickup");
	});

	test("delivery and collection always ask", () => {
		for (const kind of ["delivery", "collection"] as const) {
			expect(
				asksForTime({
					kind,
					isDropOff: false,
					openingHours: undefined,
					prepMinutes: 0,
				}),
			).toBe(true);
		}
	});

	test("a pickup asks only when hours or prep make the hour matter", () => {
		const pickup = { kind: "pickup" as const, isDropOff: false };
		expect(
			asksForTime({ ...pickup, openingHours: undefined, prepMinutes: 0 }),
		).toBe(false);
		expect(
			asksForTime({ ...pickup, openingHours: NINE_TO_SIX, prepMinutes: 0 }),
		).toBe(true);
		expect(
			asksForTime({ ...pickup, openingHours: undefined, prepMinutes: 60 }),
		).toBe(true);
	});

	test("a drop-off meet-up never asks — the point's schedule sets the hour", () => {
		expect(
			asksForTime({
				kind: "pickup",
				isDropOff: true,
				openingHours: NINE_TO_SIX,
				prepMinutes: 120,
			}),
		).toBe(false);
	});

	test("a collection trip carries no prep — the rider collects first", () => {
		expect(prepForFulfilment(PUFF, "collection")).toEqual(NO_CART_PREP);
		expect(prepForFulfilment(PUFF, "pickup")).toBe(PUFF);
		expect(prepForFulfilment(PUFF, "delivery")).toBe(PUFF);
	});
});

describe("isFulfilmentDaySelectable", () => {
	test("a timed today with prep that outlasts the hours is not offered", () => {
		// 4:30 PM, 2h prep, 6 PM close.
		expect(
			isFulfilmentDaySelectable({
				hours: NINE_TO_SIX,
				closedDates: undefined,
				dateEpoch: FRI,
				now: at(16, 30),
				prep: PUFF,
				timed: true,
			}),
		).toBe(false);
		expect(
			isFulfilmentDaySelectable({
				hours: NINE_TO_SIX,
				closedDates: undefined,
				dateEpoch: SAT,
				now: at(16, 30),
				prep: PUFF,
				timed: true,
			}),
		).toBe(true);
	});

	test("a date-only pickup today stays offered after hours when no prep is involved", () => {
		// Zero change for a drop-off meet-up: the day just has to be open.
		expect(
			isFulfilmentDaySelectable({
				hours: NINE_TO_SIX,
				closedDates: undefined,
				dateEpoch: FRI,
				now: at(20),
				prep: NO_CART_PREP,
				timed: false,
			}),
		).toBe(true);
	});

	test("a date-only pickup today is withheld once prep outlasts the DAY, not the hours", () => {
		const dateOnly = {
			hours: NINE_TO_SIX,
			closedDates: undefined,
			dateEpoch: FRI,
			timed: false,
		};
		// 8 PM, after closing: a day-long prep can't be ready tonight. Judged
		// against the hours this slipped through — no slots with prep or without.
		expect(
			isFulfilmentDaySelectable({ ...dateOnly, now: at(20), prep: DAY_PREP }),
		).toBe(false);
		// 4:30 PM plus 2h ends past the 6 PM close — but a meet-up's hour is
		// its own, so today stays on offer.
		expect(
			isFulfilmentDaySelectable({ ...dateOnly, now: at(16, 30), prep: PUFF }),
		).toBe(true);
	});
});

describe("fulfilmentDayCopy", () => {
	const day = (over: Partial<Parameters<typeof fulfilmentDayCopy>[0]>) =>
		text(
			fulfilmentDayCopy({
				...base,
				hours: NINE_TO_SIX,
				dateEpoch: FRI,
				now: at(9),
				prep: NO_CART_PREP,
				timed: true,
				kind: "pickup",
				...over,
			}),
		);

	test("a closed weekday is named, for every kind", () => {
		for (const kind of ["delivery", "collection", "pickup"] as const) {
			expect(day({ hours: CLOSED_FRIDAY, kind })).toBe(
				"Huff & Puff is closed on Fridays — pick another day.",
			);
		}
	});

	test("prep that used today up is named before the generic 'closed'", () => {
		expect(day({ now: at(16, 30), prep: PUFF })).toBe(
			"“Ice Cream Puff” needs 2 hours to prepare — too late for today, pick a later day.",
		);
	});

	test("still open but out of time is 'no time left', never 'closed' (5:50 PM, 6 PM close)", () => {
		expect(day({ now: at(17, 50) })).toBe(
			"There's no time left to pick up today — pick tomorrow.",
		);
	});

	test("a store already closed for today says so — prep is never blamed", () => {
		expect(day({ now: at(19), prep: PUFF })).toBe(
			"Huff & Puff has closed for today — pick another day.",
		);
	});

	test("an all-day store near midnight has no time left, in the kind's verb", () => {
		const late = { hours: undefined, now: at(23, 55) };
		expect(day({ ...late, kind: "pickup" })).toBe(
			"There's no time left to pick up today — pick tomorrow.",
		);
		expect(day({ ...late, kind: "delivery" })).toBe(
			"There's no time left to deliver today — pick tomorrow.",
		);
	});

	test("a date-only day only checks open + prep", () => {
		expect(day({ now: at(19), timed: false })).toBeNull();
	});

	test("a date-only day's prep races midnight, and a closed weekday still comes first", () => {
		expect(day({ now: at(20), prep: DAY_PREP, timed: false })).toBe(
			"“Wedding tier” needs 24 hours to prepare — too late for today, pick a later day.",
		);
		expect(day({ now: at(16, 30), prep: PUFF, timed: false })).toBeNull();
		expect(
			day({ hours: CLOSED_FRIDAY, now: at(20), prep: DAY_PREP, timed: false }),
		).toBe("Huff & Puff is closed on Fridays — pick another day.");
	});

	test("a good day is null", () => {
		expect(day({})).toBeNull();
		expect(day({ dateEpoch: SAT, now: at(19), prep: PUFF })).toBeNull();
	});
});

describe("fulfilmentTimeCopy — T1's ladder with the prep floor threaded in", () => {
	const time = (
		timeMinutes: number | undefined,
		over: Partial<Parameters<typeof fulfilmentTimeCopy>[0]> = {},
	) =>
		text(
			fulfilmentTimeCopy({
				...base,
				hours: NINE_TO_SIX,
				dateEpoch: FRI,
				now: at(9),
				prep: PUFF,
				kind: "pickup",
				timeMinutes,
				...over,
			}),
		);

	test("an empty field asks for the kind's time", () => {
		expect(time(undefined)).toBe("Pick a pickup time.");
		expect(time(undefined, { kind: "delivery" })).toBe("Pick a delivery time.");
		expect(time(undefined, { kind: "collection" })).toBe(
			"Pick a collection time.",
		);
	});

	test("inside the prep window: the server's words, naming the product", () => {
		expect(time(hm(10, 30))).toBe(
			"“Ice Cream Puff” needs 2 hours to prepare — earliest pickup is 11:00 AM.",
		);
		expect(time(hm(11))).toBeNull();
	});

	test("a split day where prep swallows breakfast names lunch, never the break", () => {
		// 9:00 with 2h prep on 7:30–10:00 / 12:00–18:00.
		expect(time(hm(9, 45), { hours: SPLIT })).toBe(
			"“Ice Cream Puff” needs 2 hours to prepare — earliest pickup is 12:00 PM.",
		);
	});

	test("with no prep, the hours speak: before opening, after closing, the break", () => {
		const noPrep = { prep: NO_CART_PREP, now: at(6) };
		expect(time(hm(8), noPrep)).toBe(
			"The earliest you can pick up is 9:00 AM — pick that or later.",
		);
		expect(time(hm(8), { ...noPrep, kind: "delivery" })).toBe(
			"The earliest we can deliver is 9:00 AM — pick that or later.",
		);
		expect(time(hm(19), noPrep)).toBe(
			"Huff & Puff closes at 6:00 PM that day — pick an earlier time.",
		);
		expect(time(hm(11), { ...noPrep, hours: SPLIT })).toBe(
			"Huff & Puff is closed 10:00 AM – 12:00 PM — pick a time in an open window.",
		);
	});

	test("the day's problem outranks the time's", () => {
		expect(time(hm(12), { hours: CLOSED_FRIDAY })).toBe(
			"Huff & Puff is closed on Fridays — pick another day.",
		);
	});

	test("a future day takes any open time — prep is absorbed overnight", () => {
		expect(time(hm(9), { dateEpoch: SAT, now: at(17) })).toBeNull();
	});
});

describe("prepHint — the one line about today", () => {
	const hint = (over: Partial<Parameters<typeof prepHint>[0]> = {}) =>
		text(
			prepHint({
				hours: NINE_TO_SIX,
				closedDates: undefined,
				now: at(9),
				prep: PUFF,
				kind: "pickup",
				noticeDays: 0,
				timed: true,
				...over,
			}),
		);

	test("prep moves today's first slot: say how long, and when", () => {
		expect(hint()).toBe(
			"“Ice Cream Puff” takes about 2 hours to prepare, so the earliest pickup today is 11:00 AM.",
		);
		expect(hint({ kind: "delivery" })).toBe(
			"“Ice Cream Puff” takes about 2 hours to prepare, so the earliest delivery today is 11:00 AM.",
		);
	});

	test("a date-only pickup hears when it's ready instead", () => {
		expect(hint({ timed: false })).toBe(
			"“Ice Cream Puff” takes about 2 hours to prepare, so it's ready from 11:00 AM today.",
		);
	});

	test("a date-only hint races midnight, not closing time", () => {
		expect(hint({ timed: false, now: at(16, 30) })).toBe(
			"“Ice Cream Puff” takes about 2 hours to prepare, so it's ready from 6:30 PM today.",
		);
		expect(hint({ timed: false, now: at(20), prep: DAY_PREP })).toBe(
			"“Wedding tier” takes about 24 hours to prepare, so it can't be ready today.",
		);
		expect(hint({ timed: false, hours: CLOSED_FRIDAY })).toBeNull();
	});

	test("prep that outlasts today explains why Today isn't offered", () => {
		expect(hint({ now: at(16, 30) })).toBe(
			"“Ice Cream Puff” takes about 2 hours to prepare, so it can't be ready today.",
		);
	});

	test("silent when prep changes nothing the buyer can see", () => {
		expect(hint({ prep: NO_CART_PREP })).toBeNull();
		// A day of notice already rules today out.
		expect(hint({ noticeDays: 1 })).toBeNull();
		// Closed for today anyway — the hours say so, not prep.
		expect(hint({ now: at(19) })).toBeNull();
		expect(hint({ hours: CLOSED_FRIDAY })).toBeNull();
		// A store opening at 5 PM: at 9 AM a 2h prep moves nothing.
		expect(hint({ hours: week({ open: hm(17), close: hm(22) }) })).toBeNull();
	});
});

describe("times stay whole for the page", () => {
	test("a prep refusal and the prep hint carry the time as a value, not text", () => {
		const refusal = fulfilmentTimeCopy({
			...base,
			hours: NINE_TO_SIX,
			dateEpoch: FRI,
			now: at(9),
			prep: PUFF,
			kind: "pickup",
			timeMinutes: hm(10, 30),
		});
		expect(refusal).toContainEqual({ time: hm(11) });
		expect(
			prepHint({
				hours: NINE_TO_SIX,
				closedDates: undefined,
				now: at(9),
				prep: PUFF,
				kind: "pickup",
				noticeDays: 0,
				timed: true,
			}),
		).toContainEqual({ time: hm(11) });
	});
});

describe("closed dates (z8r3fdhpm7)", () => {
	const raya = { startDate: FRI, endDate: FRI, label: "Hari Raya" };

	test("a closed date is never offered, timed or date-only", () => {
		for (const timed of [true, false]) {
			expect(
				isFulfilmentDaySelectable({
					hours: NINE_TO_SIX,
					closedDates: [raya],
					dateEpoch: FRI,
					now: at(9),
					prep: NO_CART_PREP,
					timed,
				}),
			).toBe(false);
		}
		expect(
			isFulfilmentDaySelectable({
				hours: NINE_TO_SIX,
				closedDates: [raya],
				dateEpoch: SAT,
				now: at(9),
				prep: NO_CART_PREP,
				timed: true,
			}),
		).toBe(true);
	});

	test("the day notice names the range and the reason, before prep speaks", () => {
		const copy = fulfilmentDayCopy({
			...base,
			closedDates: [raya],
			hours: NINE_TO_SIX,
			dateEpoch: FRI,
			now: at(16, 30),
			prep: PUFF,
			timed: true,
			kind: "pickup",
		});
		expect(text(copy)).toMatch(
			/^Huff & Puff is closed Fri, .* \(Hari Raya\) — pick another day\.$/,
		);
	});

	test("the prep hint stays quiet on a closed today", () => {
		expect(
			prepHint({
				hours: NINE_TO_SIX,
				closedDates: [raya],
				now: at(9),
				prep: PUFF,
				kind: "pickup",
				noticeDays: 0,
				timed: true,
			}),
		).toBeNull();
	});
});
