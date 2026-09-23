import { describe, expect, it } from "vitest";
import {
	EMPTY_EVENT_DRAFT,
	eventDraftValid,
	eventEndDateIssue,
	eventEndDateWarning,
	eventSubmitValue,
} from "./event-fields";

/** A valid multi-day draft; override endDate per case. */
function draft(endDate: string) {
	return {
		...EMPTY_EVENT_DRAFT,
		on: true,
		date: "2026-12-04",
		endDate,
	};
}

describe("last-day guard rails (`z8r3fdff9u`, revised 23 Sep)", () => {
	it("a long span WARNS but never blocks — the hard cap was not ticket scope", () => {
		// 4 Dec → 15 Jan = 43 days: a real class series must save. The warning
		// asks for a second look because a typo'd month or year keeps the
		// listing up (and taking RSVPs) long after the event.
		const long = draft("2027-01-15");
		expect(eventEndDateIssue(long)).toBeNull();
		expect(eventEndDateWarning(long)).toBe(
			"That's a 43-day event — double-check the last day.",
		);
		expect(eventSubmitValue(long)?.endDate).toBeDefined();
	});

	it("a normal span raises neither the error nor the warning", () => {
		const camp = draft("2026-12-06");
		expect(eventEndDateIssue(camp)).toBeNull();
		expect(eventEndDateWarning(camp)).toBeNull();
	});

	it("a REAL problem is still an error, and the warning stays quiet", () => {
		const backwards = draft("2026-12-01");
		expect(eventEndDateIssue(backwards)).toMatch(/before the event date/i);
		expect(eventEndDateWarning(backwards)).toBeNull();
	});
});

describe("the venue is the event's (round 4)", () => {
	it("multi-outlet stores must name it; single-outlet stores never pick", () => {
		const noVenue = draft("2026-12-06");
		expect(eventDraftValid(noVenue, { requireVenue: true })).toBe(false);
		expect(eventDraftValid(noVenue)).toBe(true);
		const withVenue = { ...noVenue, venueId: "loc_abc" };
		expect(eventDraftValid(withVenue, { requireVenue: true })).toBe(true);
		// The pick rides the submit value; blank stays unset.
		expect(eventSubmitValue(withVenue)?.venueId).toBe("loc_abc");
		expect(eventSubmitValue(noVenue)?.venueId).toBeUndefined();
	});
});
