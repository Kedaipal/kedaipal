import { describe, expect, test } from "vitest";
import { MYT_OFFSET_MS } from "./fulfilmentDate";
import { monthStartMyt } from "./usagePeriod";

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
