/**
 * Pure ICS builder (booking S6, `86eyn4kf2`): RFC 5545 escaping, MYT all-day
 * date mapping, 75-octet folding, exclusive DTEND semantics and the stable
 * document shape Google diffs against.
 */
import { describe, expect, test } from "vitest";
import { DAY_MS, MYT_OFFSET_MS } from "./fulfilmentDate";
import {
	buildIcsCalendar,
	escapeIcsText,
	foldIcsLine,
	icsDate,
	icsUtcStamp,
	inclusiveEndToExclusive,
} from "./icsFeed";

// 2026-09-25 MYT midnight.
const SEP_25 = Date.UTC(2026, 8, 25) - MYT_OFFSET_MS;

describe("escapeIcsText", () => {
	test("escapes backslash, semicolon, comma and newlines", () => {
		expect(escapeIcsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
		expect(escapeIcsText("plain")).toBe("plain");
	});
});

describe("icsDate", () => {
	test("maps an MYT midnight to that MYT calendar day (not the UTC day)", () => {
		// MYT midnight is 16:00 UTC the previous day — the date must still read
		// as the seller's 25th.
		expect(icsDate(SEP_25)).toBe("20260925");
		expect(icsDate(SEP_25 + DAY_MS)).toBe("20260926");
	});
});

describe("icsUtcStamp", () => {
	test("renders the RFC UTC form", () => {
		expect(icsUtcStamp(Date.UTC(2026, 0, 2, 3, 4, 5))).toBe(
			"20260102T030405Z",
		);
	});
});

describe("foldIcsLine", () => {
	test("leaves short lines alone and folds long ones with leading spaces", () => {
		expect(foldIcsLine("SUMMARY:short")).toBe("SUMMARY:short");
		const long = `SUMMARY:${"x".repeat(200)}`;
		const folded = foldIcsLine(long);
		const lines = folded.split("\r\n");
		expect(lines.length).toBeGreaterThan(1);
		expect(lines[0]).toHaveLength(75);
		for (const cont of lines.slice(1)) {
			expect(cont.startsWith(" ")).toBe(true);
			expect(cont.length).toBeLessThanOrEqual(75);
		}
		// Unfolding reproduces the original exactly.
		expect(folded.replace(/\r\n /g, "")).toBe(long);
	});
});

describe("buildIcsCalendar", () => {
	test("all-day events with exclusive DTEND, stable UIDs, CRLF endings", () => {
		const doc = buildIcsCalendar({
			calendarName: "Bookings — Lembah Camp",
			events: [
				{
					uid: "booking-ORD-1234",
					summary: "Aisha — Riverside Plot",
					start: SEP_25,
					endExclusive: SEP_25 + 2 * DAY_MS, // 2 nights: 25 + 26
					createdAt: Date.UTC(2026, 8, 1, 12, 0, 0),
				},
				{
					uid: "block-abc123",
					summary: "Blocked (Maintenance)",
					start: SEP_25 + 5 * DAY_MS,
					// A one-day inclusive block → exclusive form spans one day.
					endExclusive: inclusiveEndToExclusive(SEP_25 + 5 * DAY_MS),
					createdAt: Date.UTC(2026, 8, 2, 12, 0, 0),
				},
			],
		});
		expect(doc).toContain("BEGIN:VCALENDAR\r\n");
		expect(doc).toContain("X-WR-CALNAME:Bookings — Lembah Camp");
		expect(doc).toContain("UID:booking-ORD-1234@kedaipal.com");
		expect(doc).toContain("DTSTART;VALUE=DATE:20260925");
		// checkOut is exclusive and maps straight onto ICS DTEND: a 25→27 stay
		// renders 25..27-exclusive, so GCal paints the 25th and 26th only.
		expect(doc).toContain("DTEND;VALUE=DATE:20260927");
		expect(doc).toContain("DTSTART;VALUE=DATE:20260930");
		expect(doc).toContain("DTEND;VALUE=DATE:20261001");
		expect(doc.endsWith("END:VCALENDAR\r\n")).toBe(true);
		// Every line CRLF-terminated (Google is strict about this).
		expect(doc.includes("\n")).toBe(true);
		expect(doc.replace(/\r\n/g, "").includes("\n")).toBe(false);
	});
});
