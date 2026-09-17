import { describe, expect, test } from "vitest";
import { MYT_OFFSET_MS } from "../../convex/lib/fulfilmentDate";
import {
	type DayHours,
	OPEN_ALL_DAY,
	type OpeningHours,
} from "../../convex/lib/openingHours";
import {
	copyText,
	fulfilmentTimeIssue,
	planTimeRepair,
	timeIssueCopy,
	timeMovedCopy,
} from "./fulfilment-time-issue";

// 2026-06-26 is a FRIDAY. 17:10 MYT = 09:10 UTC (the live-test moment).
const FRI = Date.UTC(2026, 5, 26) - MYT_OFFSET_MS;
const SAT = FRI + 86_400_000;
const at = (h: number, m: number) => Date.UTC(2026, 5, 26, h - 8, m, 0);

/** 4:30–5:30 PM, then 7:00–9:00 PM: the schedule the live test ran on. */
const SPLIT: DayHours = { open: 990, close: 1050, open2: 1140, close2: 1260 };
const week = (day: DayHours): OpeningHours =>
	Array.from({ length: 7 }, (_, i) => (i === 5 || i === 6 ? day : OPEN_ALL_DAY));
const hours = week(SPLIT);
const ctx = { storeName: "Huff & Puff", verb: "deliver" as const };

describe("fulfilmentTimeIssue", () => {
	test("a pickable time has no issue", () => {
		expect(
			fulfilmentTimeIssue({ hours, dayEpoch: SAT, timeMinutes: 1000, now: at(9, 0) }),
		).toBeNull();
	});

	test("the day comes first: no slot outranks an empty field", () => {
		// Friday 21:30: both windows are over.
		expect(
			fulfilmentTimeIssue({
				hours,
				dayEpoch: FRI,
				timeMinutes: undefined,
				now: at(21, 30),
			}),
		).toEqual({ kind: "no_slot", storeClosed: true });
	});

	test("an empty field on a day with slots is 'missing'", () => {
		expect(
			fulfilmentTimeIssue({
				hours,
				dayEpoch: SAT,
				timeMinutes: Number.NaN,
				now: at(9, 0),
			}),
		).toEqual({ kind: "missing" });
	});

	test("too early, too late, and the break each name themselves", () => {
		const base = { hours, dayEpoch: SAT, now: at(9, 0) };
		expect(fulfilmentTimeIssue({ ...base, timeMinutes: 900 })).toEqual({
			kind: "too_early",
			earliest: 990,
		});
		expect(fulfilmentTimeIssue({ ...base, timeMinutes: 1300 })).toEqual({
			kind: "too_late",
			latest: 1260,
		});
		expect(fulfilmentTimeIssue({ ...base, timeMinutes: 1080 })).toEqual({
			kind: "in_break",
			gap: { open: 1050, close: 1140 },
		});
	});

	test("today, a time in a break the floor already passed reads 'earliest'", () => {
		// Friday 17:40 → the 4:30–5:30 window is gone; 6:00 PM is before 7:00 PM.
		expect(
			fulfilmentTimeIssue({
				hours,
				dayEpoch: FRI,
				timeMinutes: 1080,
				now: at(17, 40),
			}),
		).toEqual({ kind: "too_early", earliest: 1140 });
	});
});

describe("copy — one sentence for the notice and the submit banner", () => {
	test("each issue flattens to the exact submit wording", () => {
		expect(
			copyText(timeIssueCopy({ kind: "in_break", gap: { open: 1050, close: 1140 } }, ctx)),
		).toBe("Huff & Puff is closed 5:30 PM – 7:00 PM — pick a time in an open window.");
		expect(copyText(timeIssueCopy({ kind: "too_early", earliest: 990 }, ctx))).toBe(
			"The earliest we can deliver is 4:30 PM — pick that or later.",
		);
		expect(copyText(timeIssueCopy({ kind: "too_late", latest: 1260 }, ctx))).toBe(
			"Huff & Puff closes at 9:00 PM that day — pick an earlier time.",
		);
		expect(copyText(timeIssueCopy({ kind: "missing" }, ctx))).toBe(
			"Pick a delivery time.",
		);
		expect(
			copyText(timeIssueCopy({ kind: "missing" }, { ...ctx, verb: "collect" })),
		).toBe("Pick a collection time.");
		expect(
			copyText(timeIssueCopy({ kind: "no_slot", storeClosed: true }, ctx)),
		).toBe("Huff & Puff has closed for today — pick another day.");
		expect(
			copyText(timeIssueCopy({ kind: "no_slot", storeClosed: false }, ctx)),
		).toBe("There's no time left to deliver today — pick tomorrow.");
	});

	test("ranges and times stay as values, so the page can keep them whole", () => {
		const parts = timeIssueCopy(
			{ kind: "in_break", gap: { open: 1050, close: 1140 } },
			ctx,
		);
		expect(parts).toContainEqual({ range: { open: 1050, close: 1140 } });
	});

	test("a move is announced, naming the break when that's why", () => {
		expect(
			copyText(
				timeMovedCopy(
					{ from: 1080, to: 1140, gap: { open: 1050, close: 1140 } },
					{ storeName: "Huff & Puff" },
				),
			),
		).toBe("We moved your time to 7:00 PM — Huff & Puff is closed 5:30 PM – 7:00 PM.");
		expect(
			copyText(
				timeMovedCopy({ from: 1035, to: 1040, gap: null }, { storeName: "Huff & Puff" }),
			),
		).toBe("We moved your time to 5:20 PM — 5:15 PM is no longer available.");
	});
});

describe("planTimeRepair — ownership decides who may change the time", () => {
	test("a BUYER-typed time is never rewritten, even when it's in the break", () => {
		// The live-test bug: a typed 6:00 PM became 5:20 PM within 30 seconds.
		expect(
			planTimeRepair({
				hours,
				dayEpoch: FRI,
				currentHhmm: "18:00",
				systemHhmm: "17:15",
				now: at(17, 0),
			}),
		).toBeNull();
	});

	test("a pickable SYSTEM time is left alone", () => {
		expect(
			planTimeRepair({
				hours,
				dayEpoch: FRI,
				currentHhmm: "17:15",
				systemHhmm: "17:15",
				now: at(17, 0),
			}),
		).toBeNull();
	});

	test("a stale system time moves FORWARD into the next window, and says why", () => {
		// 5:25 PM prefill; the floor passes 5:30 PM → jump to 7:00 PM, not 5:35.
		expect(
			planTimeRepair({
				hours,
				dayEpoch: FRI,
				currentHhmm: "17:25",
				systemHhmm: "17:25",
				now: at(17, 16),
			}),
		).toEqual({
			nextHhmm: "19:00",
			moved: { from: 1045, to: 1140, gap: null },
		});
	});

	test("a system time stranded in a break names the break it left", () => {
		// The seller shortens window 1 to 5:00 PM while 5:25 PM sits prefilled.
		const shortened = week({ ...SPLIT, close: 1020 });
		expect(
			planTimeRepair({
				hours: shortened,
				dayEpoch: SAT,
				currentHhmm: "17:25",
				systemHhmm: "17:25",
				now: at(9, 0),
			}),
		).toEqual({
			nextHhmm: "19:00",
			moved: { from: 1045, to: 1140, gap: { open: 1020, close: 1140 } },
		});
	});

	test("only with NOTHING later left may a repair fall back to an earlier slot", () => {
		// 8:30 PM prefill; the seller cuts window 2 to 7:00–8:00 PM. No slot is
		// left after 8:30 PM, so the day's first slot is the only honest answer,
		// and the move is still announced.
		const cut = week({ ...SPLIT, close2: 1200 });
		expect(
			planTimeRepair({
				hours: cut,
				dayEpoch: SAT,
				currentHhmm: "20:30",
				systemHhmm: "20:30",
				now: at(9, 0),
			}),
		).toEqual({
			nextHhmm: "16:30",
			moved: { from: 1230, to: 990, gap: null },
		});
	});

	test("a day with no slot left clears a system time instead of keeping a false one", () => {
		expect(
			planTimeRepair({
				hours,
				dayEpoch: FRI,
				currentHhmm: "19:00",
				systemHhmm: "19:00",
				now: at(21, 30),
			}),
		).toEqual({ nextHhmm: "", moved: null });
	});

	test("an empty system time refills on a day that has slots, silently", () => {
		expect(
			planTimeRepair({
				hours,
				dayEpoch: SAT,
				currentHhmm: "",
				systemHhmm: "",
				now: at(21, 30),
			}),
		).toEqual({ nextHhmm: "16:30", moved: null });
	});
});
