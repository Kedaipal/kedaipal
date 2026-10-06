import { describe, expect, test } from "vitest";
import { MYT_OFFSET_MS } from "./fulfilmentDate";
import {
	addMonthsMyt,
	monthStartMyt,
	nextMonthStartMyt,
	usagePeriodKey,
} from "./usagePeriod";

const utc = (iso: string) => Date.parse(iso);

describe("monthStartMyt", () => {
	test("mid-month timestamp keys to the 1st, MYT midnight", () => {
		const key = monthStartMyt(utc("2026-07-15T04:00:00Z"));
		expect(key).toBe(utc("2026-07-01T00:00:00+08:00"));
		// It IS an MYT midnight.
		expect((key + MYT_OFFSET_MS) % (24 * 60 * 60 * 1000)).toBe(0);
	});

	test("MYT month boundary: 30 Jun 16:30 UTC is already 1 Jul in Malaysia", () => {
		expect(monthStartMyt(utc("2026-06-30T16:30:00Z"))).toBe(
			utc("2026-07-01T00:00:00+08:00"),
		);
		// …while 15:30 UTC is still 30 Jun MYT (23:30).
		expect(monthStartMyt(utc("2026-06-30T15:30:00Z"))).toBe(
			utc("2026-06-01T00:00:00+08:00"),
		);
	});

	test("idempotent: the key of a key is itself", () => {
		const key = monthStartMyt(utc("2026-02-11T10:00:00Z"));
		expect(monthStartMyt(key)).toBe(key);
	});

	test("year boundary rolls correctly", () => {
		expect(monthStartMyt(utc("2026-12-31T17:00:00Z"))).toBe(
			utc("2027-01-01T00:00:00+08:00"),
		);
	});
});

// Credits (86eye2ccu): the ledger's period key, the refresh moment and the
// "valid 12 months" expiry all ride the same MYT calendar.
describe("usagePeriodKey", () => {
	test("keys to the MYT month as a sortable YYYY-MM", () => {
		expect(usagePeriodKey(utc("2026-10-15T04:00:00Z"))).toBe("2026-10");
		// 16:30 UTC on 31 Oct is already 1 Nov in Malaysia.
		expect(usagePeriodKey(utc("2026-10-31T16:30:00Z"))).toBe("2026-11");
		expect(usagePeriodKey(utc("2026-12-31T17:00:00Z"))).toBe("2027-01");
		// Lexicographic order IS chronological order (the by_period range scan).
		expect("2026-09" < "2026-10" && "2026-12" < "2027-01").toBe(true);
	});
});

describe("nextMonthStartMyt", () => {
	test("the 1st of the next month, MYT midnight — across a year end too", () => {
		expect(nextMonthStartMyt(utc("2026-10-15T04:00:00Z"))).toBe(
			utc("2026-11-01T00:00:00+08:00"),
		);
		expect(nextMonthStartMyt(utc("2026-12-20T04:00:00Z"))).toBe(
			utc("2027-01-01T00:00:00+08:00"),
		);
	});
});

describe("addMonthsMyt", () => {
	test("12 months is the same date next year, not 365 days", () => {
		const landed = utc("2026-10-15T04:00:00Z");
		expect(addMonthsMyt(landed, 12)).toBe(utc("2027-10-15T04:00:00Z"));
		// Across a leap day, 365 days would land a day early.
		expect(addMonthsMyt(utc("2027-10-15T04:00:00Z"), 12)).toBe(
			utc("2028-10-15T04:00:00Z"),
		);
	});

	test("a day that doesn't exist in the target month clamps to its last day", () => {
		expect(addMonthsMyt(utc("2028-02-29T04:00:00Z"), 12)).toBe(
			utc("2029-02-28T04:00:00Z"),
		);
		expect(addMonthsMyt(utc("2026-01-31T04:00:00Z"), 1)).toBe(
			utc("2026-02-28T04:00:00Z"),
		);
	});

	test("reads the MYT wall clock: 23:30 MYT on 31 Jan stays 31 Jan → 28 Feb", () => {
		// 15:30 UTC = 23:30 MYT, still the 31st locally.
		expect(addMonthsMyt(utc("2026-01-31T15:30:00Z"), 1)).toBe(
			utc("2026-02-28T15:30:00Z"),
		);
	});
});
