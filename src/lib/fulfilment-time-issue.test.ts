import { describe, expect, test } from "vitest";
import { MYT_OFFSET_MS } from "../../convex/lib/fulfilmentDate";
import {
	type DayHours,
	OPEN_ALL_DAY,
	type OpeningHours,
} from "../../convex/lib/openingHours";
import {
	copyText,
	fulfilmentInputsKey,
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
		).toEqual({ kind: "no_slot", reason: "closed" });
	});

	test("open but out of time is NOT 'closed': the lead ran out before the last close", () => {
		// Friday 20:50 → the 7:00–9:00 PM window is still open, but the 15-minute
		// lead runs past 9:00 PM. The store hasn't closed; there's no time left.
		expect(
			fulfilmentTimeIssue({
				hours,
				dayEpoch: FRI,
				timeMinutes: undefined,
				now: at(20, 50),
			}),
		).toEqual({ kind: "no_slot", reason: "too_late" });
	});

	test("a weekday the store never opens says so, naming the weekday", () => {
		const closedThursdays: OpeningHours = Array.from({ length: 7 }, (_, i) =>
			i === 4 ? { ...SPLIT, closed: true } : SPLIT,
		);
		const THU = FRI - 86_400_000;
		expect(
			fulfilmentTimeIssue({
				hours: closedThursdays,
				dayEpoch: THU,
				timeMinutes: 1000,
				now: at(9, 0) - 86_400_000,
			}),
		).toEqual({ kind: "no_slot", reason: "closed_day", weekday: 4 });
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

describe("the cart's prep window is a CAUSE the ladder carries (z8r3fdff97)", () => {
	// Friday (today) with 2h prep. At 16:00 the floor is 18:00, so the
	// 4:30–5:30 window is gone and 7:00–9:00 PM is still open.
	const prep = { prepMinutes: 120, prepItemName: "Ice Cream Puff" };

	test("a time inside the prep window is too early BECAUSE of prep, and names the item", () => {
		// Friday is today here, so the floor applies.
		const issue = fulfilmentTimeIssue({
			hours,
			dayEpoch: FRI,
			timeMinutes: 1000,
			now: at(16, 0),
			...prep,
		});
		expect(issue).toEqual({
			kind: "too_early",
			earliest: 1140,
			prep: { itemName: "Ice Cream Puff", minutes: 120 },
		});
		if (!issue) throw new Error("expected an issue");
		expect(copyText(timeIssueCopy(issue, { ...ctx, verb: "pick up" }))).toBe(
			"“Ice Cream Puff” needs 2 hours to prepare — earliest pickup is 7:00 PM.",
		);
	});

	test("a prep that uses today up is too late BECAUSE of prep — not 'closed'", () => {
		// Friday 19:30 with 2h prep: 9:30 PM is past the 9:00 PM close.
		const issue = fulfilmentTimeIssue({
			hours,
			dayEpoch: FRI,
			timeMinutes: undefined,
			now: at(19, 30),
			...prep,
		});
		expect(issue).toEqual({
			kind: "no_slot",
			reason: "too_late",
			prep: { itemName: "Ice Cream Puff", minutes: 120 },
		});
		if (!issue) throw new Error("expected an issue");
		expect(copyText(timeIssueCopy(issue, { ...ctx, verb: "pick up" }))).toBe(
			"“Ice Cream Puff” needs 2 hours to prepare — too late for today, pick a later day.",
		);
	});

	test("prep is never blamed for what the hours already refuse", () => {
		// Friday 21:30: closed with or without prep — the hours speak.
		expect(
			fulfilmentTimeIssue({
				hours,
				dayEpoch: FRI,
				timeMinutes: undefined,
				now: at(21, 30),
				...prep,
			}),
		).toEqual({ kind: "no_slot", reason: "closed" });
		// Saturday is a future day: prep is absorbed overnight.
		expect(
			fulfilmentTimeIssue({
				hours,
				dayEpoch: SAT,
				timeMinutes: 900,
				now: at(16, 0),
				...prep,
			}),
		).toEqual({ kind: "too_early", earliest: 990 });
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
			copyText(timeIssueCopy({ kind: "no_slot", reason: "closed" }, ctx)),
		).toBe("Huff & Puff has closed for today — pick another day.");
		expect(
			copyText(timeIssueCopy({ kind: "no_slot", reason: "too_late" }, ctx)),
		).toBe("There's no time left to deliver today — pick tomorrow.");
		expect(
			copyText(
				timeIssueCopy({ kind: "no_slot", reason: "closed_day", weekday: 4 }, ctx),
			),
		).toBe("Huff & Puff is closed on Thursdays — pick another day.");
	});

	test("a buyer picking up speaks for themselves — never the collection service's words (z8r3fdff97)", () => {
		// "collection" is the rider-collects-from-the-buyer service; a buyer
		// collecting in person picks up.
		const pickup = { ...ctx, verb: "pick up" as const };
		expect(copyText(timeIssueCopy({ kind: "missing" }, pickup))).toBe(
			"Pick a pickup time.",
		);
		expect(
			copyText(timeIssueCopy({ kind: "too_early", earliest: 990 }, pickup)),
		).toBe("The earliest you can pick up is 4:30 PM — pick that or later.");
		expect(
			copyText(timeIssueCopy({ kind: "no_slot", reason: "too_late" }, pickup)),
		).toBe("There's no time left to pick up today — pick tomorrow.");
	});

	test("ranges and times stay as values, so the page can keep them whole", () => {
		const parts = timeIssueCopy(
			{ kind: "in_break", gap: { open: 1050, close: 1140 } },
			ctx,
		);
		expect(parts).toContainEqual({ range: { open: 1050, close: 1140 } });
	});

	test("a move is announced with its TRUE reason", () => {
		const store = { storeName: "Huff & Puff" };
		expect(
			copyText(
				timeMovedCopy(
					{
						from: 1080,
						to: 1140,
						reason: { kind: "break", gap: { open: 1050, close: 1140 } },
					},
					store,
				),
			),
		).toBe("We moved your time to 7:00 PM — Huff & Puff is closed 5:30 PM – 7:00 PM.");
		expect(
			copyText(
				timeMovedCopy({ from: 1035, to: 1040, reason: { kind: "passed" } }, store),
			),
		).toBe("We moved your time to 5:20 PM — 5:15 PM is no longer available.");
		// A new DAY is not the clock passing: nothing expired, the day just keeps
		// different hours. Saying "no longer available" here was the live-test bug.
		expect(
			copyText(
				timeMovedCopy({ from: 600, to: 780, reason: { kind: "before_open" } }, store),
			),
		).toBe("We moved your time to 1:00 PM — 10:00 AM is before Huff & Puff opens that day.");
		expect(
			copyText(
				timeMovedCopy({ from: 1170, to: 600, reason: { kind: "after_close" } }, store),
			),
		).toBe("We moved your time to 10:00 AM — 7:30 PM is after Huff & Puff closes that day.");
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
			moved: { from: 1045, to: 1140, reason: { kind: "passed" } },
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
			moved: {
				from: 1045,
				to: 1140,
				reason: { kind: "break", gap: { open: 1020, close: 1140 } },
			},
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
			moved: { from: 1230, to: 990, reason: { kind: "after_close" } },
		});
	});

	test("switching to a day that opens LATER says so — not 'no longer available'", () => {
		// Friday 10:00 AM prefill, buyer picks Saturday, which opens at 4:30 PM.
		expect(
			planTimeRepair({
				hours,
				dayEpoch: SAT,
				currentHhmm: "10:00",
				systemHhmm: "10:00",
				now: at(9, 0),
			}),
		).toEqual({
			nextHhmm: "16:30",
			moved: { from: 600, to: 990, reason: { kind: "before_open" } },
		});
	});

	test("switching to a day that closes EARLIER says so", () => {
		// Today's 7:30 PM prefill; the buyer picks a day that runs 10 AM – 6 PM.
		const earlyClose: OpeningHours = Array.from({ length: 7 }, (_, i) =>
			i === 6 ? { open: 600, close: 1080 } : OPEN_ALL_DAY,
		);
		expect(
			planTimeRepair({
				hours: earlyClose,
				dayEpoch: SAT,
				currentHhmm: "19:30",
				systemHhmm: "19:30",
				now: at(9, 0),
			}),
		).toEqual({
			nextHhmm: "10:00",
			moved: { from: 1170, to: 600, reason: { kind: "after_close" } },
		});
	});

	test("a time the PREP window overtook has passed — it is not 'before opening'", () => {
		// Today 9:00 AM, 10:00 AM sits before the 4:30 PM opening. With no prep
		// the floor (9:15 AM) is behind it, so the opening is the reason; with a
		// two-hour prep the floor (11:00 AM) overtakes it, and "passed" is true.
		const base = {
			hours,
			dayEpoch: FRI,
			currentHhmm: "10:00",
			systemHhmm: "10:00",
			now: at(9, 0),
		};
		expect(planTimeRepair(base)?.moved?.reason).toEqual({ kind: "before_open" });
		expect(
			planTimeRepair({ ...base, prepMinutes: 120 })?.moved?.reason,
		).toEqual({ kind: "passed" });
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

describe("fulfilmentInputsKey — a refusal stands only while its inputs do", () => {
	const base = {
		deliveryMethod: "delivery",
		pickupLocationId: "",
		fulfilmentDate: "2026-06-27",
		fulfilmentTime: "18:00",
	};

	test("the same choice keeps its refusal", () => {
		expect(fulfilmentInputsKey({ ...base })).toBe(fulfilmentInputsKey(base));
	});

	test("changing ANY judged input retires it — the pickup point included", () => {
		// Switching to a drop-off point turns the time requirement off, so a
		// refusal left over from the self-collect point would be stale too.
		for (const patch of [
			{ deliveryMethod: "self_collect" },
			{ pickupLocationId: "jx7edez1nd7p7rmc3d9138m0ad8ejqqv" },
			{ fulfilmentDate: "2026-06-28" },
			{ fulfilmentTime: "19:00" },
		]) {
			expect(fulfilmentInputsKey({ ...base, ...patch })).not.toBe(
				fulfilmentInputsKey(base),
			);
		}
	});
});
