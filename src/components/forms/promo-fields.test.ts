import { describe, expect, test } from "vitest";
import {
	EMPTY_PROMO_DRAFT,
	type PromoDraft,
	promoDraftFrom,
	promoDraftIssue,
	promoSubmitValue,
	promoWindowSentence,
} from "./promo-fields";

/**
 * The Promotion block's draft rules (z8r3fdcw72). These mirror
 * `sanitizePromo` — the point is that the seller is told BEFORE the round
 * trip, so every refusal the server can produce has a client twin here.
 */

const NOW = new Date("2026-10-09T10:00:00").getTime();
const MIN = 60_000;

function draft(over: Partial<PromoDraft> = {}): PromoDraft {
	return { ...EMPTY_PROMO_DRAFT, on: true, ...over };
}

describe("promoSubmitValue", () => {
	test("off sends null — the spelling that CLEARS a stored promotion", () => {
		// `undefined` would read as "no change" and strand a promotion the
		// seller just switched off.
		expect(promoSubmitValue(draft({ on: false }), NOW)).toBeNull();
	});

	test("start now + a duration becomes an open start and a computed end", () => {
		const value = promoSubmitValue(
			draft({ startMode: "now", endMode: "minutes", durationMinutes: 90 }),
			NOW,
		);
		expect(value?.startsAt).toBeUndefined();
		expect(value?.endsAt).toBe(NOW + 90 * MIN);
	});

	test("a scheduled start anchors the duration to the START, not to now", () => {
		// Otherwise a drop scheduled for tonight would end before it opened.
		const value = promoSubmitValue(
			draft({
				startMode: "schedule",
				startDate: "2026-10-09",
				startTime: "20:00",
				endMode: "minutes",
				durationMinutes: 60,
			}),
			NOW,
		);
		const eightPm = new Date("2026-10-09T20:00:00").getTime();
		expect(value?.startsAt).toBe(eightPm);
		expect(value?.endsAt).toBe(eightPm + 60 * MIN);
	});

	test("no end date = a plain discount: no endsAt at all", () => {
		const value = promoSubmitValue(draft({ endMode: "open" }), NOW);
		expect(value?.endsAt).toBeUndefined();
	});

	test("blank label collapses to undefined so the badge default applies", () => {
		expect(
			promoSubmitValue(draft({ label: "   " }), NOW)?.label,
		).toBeUndefined();
		expect(promoSubmitValue(draft({ label: " Raya " }), NOW)?.label).toBe(
			"Raya",
		);
	});

	test("flash extras are dropped where capacity already caps the listing", () => {
		const over = {
			unitCap: "30",
			maxPerOrder: "2",
			payWithinMinutes: 60,
		} as const;
		const allowed = promoSubmitValue(draft(over), NOW);
		expect(allowed?.unitCap).toBe(30);
		expect(allowed?.maxPerOrder).toBe(2);
		expect(allowed?.payWithinMinutes).toBe(60);
		// A booking/event listing — the server refuses these outright, so the
		// form must not send them even if a stale draft carries them.
		const blocked = promoSubmitValue(draft(over), NOW, { flashAllowed: false });
		expect(blocked?.unitCap).toBeUndefined();
		expect(blocked?.maxPerOrder).toBeUndefined();
		expect(blocked?.payWithinMinutes).toBeUndefined();
	});

	test("a pay window of 0 means no hold, not a zero-minute one", () => {
		expect(
			promoSubmitValue(draft({ payWithinMinutes: 0 }), NOW)?.payWithinMinutes,
		).toBeUndefined();
	});
});

describe("promoDraftIssue — every server refusal has a client twin", () => {
	test("an off draft never complains", () => {
		expect(
			promoDraftIssue(draft({ on: false, label: "x".repeat(99) }), NOW),
		).toBeUndefined();
	});

	test("a label past the cap", () => {
		expect(promoDraftIssue(draft({ label: "x".repeat(21) }), NOW)).toMatch(
			/20 characters/,
		);
	});

	test("a scheduled start or end with nothing picked", () => {
		expect(promoDraftIssue(draft({ startMode: "schedule" }), NOW)).toMatch(
			/date and time the promotion starts/,
		);
		expect(promoDraftIssue(draft({ endMode: "until" }), NOW)).toMatch(
			/date and time the promotion ends/,
		);
	});

	test("an end before the start, and an end already in the past", () => {
		expect(
			promoDraftIssue(
				draft({
					startMode: "schedule",
					startDate: "2026-10-09",
					startTime: "20:00",
					endMode: "until",
					endDate: "2026-10-09",
					endTime: "19:00",
				}),
				NOW,
			),
		).toMatch(/end after it starts/);
		expect(
			promoDraftIssue(
				draft({ endMode: "until", endDate: "2026-10-08", endTime: "09:00" }),
				NOW,
			),
		).toMatch(/already passed/);
	});

	test("a cap or max-per-order that isn't a whole number above zero", () => {
		expect(promoDraftIssue(draft({ unitCap: "0" }), NOW)).toMatch(/unit cap/);
		expect(promoDraftIssue(draft({ unitCap: "2.5" }), NOW)).toMatch(/unit cap/);
		expect(promoDraftIssue(draft({ maxPerOrder: "-1" }), NOW)).toMatch(
			/Max per order/,
		);
		// A blank field is "off", never an error.
		expect(
			promoDraftIssue(draft({ unitCap: "", maxPerOrder: "" }), NOW),
		).toBeUndefined();
	});

	test("a pay window outside the claim-link rails", () => {
		expect(promoDraftIssue(draft({ payWithinMinutes: 2 }), NOW)).toMatch(
			/5 minutes and 7 days/,
		);
		expect(
			promoDraftIssue(draft({ payWithinMinutes: 8 * 24 * 60 }), NOW),
		).toMatch(/5 minutes and 7 days/);
	});
});

describe("promoDraftFrom", () => {
	test("no stored promotion seeds the empty draft, switched off", () => {
		expect(promoDraftFrom(undefined)).toEqual(EMPTY_PROMO_DRAFT);
	});

	test("a stored window re-opens as a SCHEDULED start, never as 'now'", () => {
		// "Now" has already happened by the time the form is re-opened; showing
		// it would offer to silently move a running sale's start.
		const seeded = promoDraftFrom({
			label: "Raya",
			startsAt: new Date("2026-10-09T20:00:00").getTime(),
			endsAt: new Date("2026-10-09T22:30:00").getTime(),
			unitCap: 30,
			maxPerOrder: 2,
			payWithinMinutes: 60,
		});
		expect(seeded.on).toBe(true);
		expect(seeded.startMode).toBe("schedule");
		expect(seeded.startDate).toBe("2026-10-09");
		expect(seeded.startTime).toBe("20:00");
		expect(seeded.endMode).toBe("until");
		expect(seeded.endTime).toBe("22:30");
		expect(seeded.unitCap).toBe("30");
		expect(seeded.maxPerOrder).toBe("2");
		expect(seeded.payWithinMinutes).toBe(60);
	});

	test("a stored promotion with no end seeds the no-end-date mode", () => {
		expect(promoDraftFrom({ label: "Always" }).endMode).toBe("open");
	});

	test("a seeded draft round-trips back to the same window", () => {
		const stored = {
			startsAt: new Date("2026-10-10T08:00:00").getTime(),
			endsAt: new Date("2026-10-11T08:00:00").getTime(),
		};
		const value = promoSubmitValue(promoDraftFrom(stored), NOW);
		expect(value?.startsAt).toBe(stored.startsAt);
		expect(value?.endsAt).toBe(stored.endsAt);
	});
});

describe("promoWindowSentence", () => {
	test("says what the two answers ADD UP TO, so a duration can't read as a start", () => {
		const sentence = promoWindowSentence(
			draft({ endMode: "minutes", durationMinutes: 60 }),
			NOW,
		);
		expect(sentence).toMatch(/^Runs from the moment you save until /);
		expect(promoWindowSentence(draft({ endMode: "open" }), NOW)).toMatch(
			/until you turn it off/,
		);
		expect(
			promoWindowSentence(
				draft({
					startMode: "schedule",
					startDate: "2026-10-09",
					startTime: "20:00",
					endMode: "minutes",
					durationMinutes: 30,
				}),
				NOW,
			),
		).toMatch(/^Runs from .* until /);
	});

	test("an off draft says nothing", () => {
		expect(promoWindowSentence(draft({ on: false }), NOW)).toBe("");
	});
});
