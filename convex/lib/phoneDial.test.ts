/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { COUNTRIES, COUNTRY_DIAL_CODE } from "./country";
import { DIAL_ROWS } from "./dialCodes";
import { DIAL_COUNTRY_NAMES } from "./dialCountryNames";
import {
	detectTypedDialCode,
	dialRow,
	E164_MAX_DIGITS,
	formatInternational,
	rowsForDialCode,
	splitStoredPhone,
} from "./phoneDial";

describe("the generated dial table (scripts/generate-dial-codes.mjs)", () => {
	test("one row per ISO, every row named", () => {
		const isos = DIAL_ROWS.map((r) => r.iso);
		expect(new Set(isos).size).toBe(isos.length);
		for (const iso of isos) expect(DIAL_COUNTRY_NAMES[iso]).toBeTruthy();
	});

	test("the store countries' rows agree with COUNTRY_DIAL_CODE", () => {
		for (const country of COUNTRIES) {
			expect(dialRow(country).dial).toBe(COUNTRY_DIAL_CODE[country]);
		}
	});

	test("calling codes are prefix-free and 1–3 digits (what splitting relies on)", () => {
		const codes = [...new Set(DIAL_ROWS.map((r) => r.dial))];
		for (const code of codes) {
			expect(code).toMatch(/^\d{1,3}$/);
			for (const other of codes) {
				if (other !== code) expect(other.startsWith(code)).toBe(false);
			}
		}
	});

	test("exactly one main country per shared code", () => {
		const codes = new Set(DIAL_ROWS.map((r) => r.dial));
		for (const code of codes) {
			const rows = rowsForDialCode(code);
			expect(rows.filter((r) => r.main)).toHaveLength(1);
			expect(rows[0].main).toBe(true);
		}
		expect(rowsForDialCode("1")[0].iso).toBe("US");
		expect(rowsForDialCode("44")[0].iso).toBe("GB");
	});

	test("every mobile length fits E.164 once the code is added", () => {
		for (const row of DIAL_ROWS) {
			for (const len of row.lengths) {
				expect(row.dial.length + len).toBeLessThanOrEqual(E164_MAX_DIGITS);
			}
		}
	});

	test("the trunk-prefix facts the validator leans on", () => {
		expect(dialRow("MY").trunk).toBe("0");
		expect(dialRow("SG").trunk).toBeNull();
		expect(dialRow("IT").trunk).toBeNull();
		expect(dialRow("CI").trunk).toBeNull();
		expect(dialRow("RU").trunk).toBe("8");
		expect(dialRow("HU").trunk).toBe("06");
		expect(dialRow("US").trunk).toBe("1");
	});

	test("the countries WhatsApp Business can't message are not offered", () => {
		const isos = new Set<string>(DIAL_ROWS.map((r) => r.iso));
		for (const blocked of ["CU", "IR", "KP", "SY"]) {
			expect(isos.has(blocked)).toBe(false);
		}
	});
});

describe("splitStoredPhone / formatInternational", () => {
	test("splits on the calling code", () => {
		expect(splitStoredPhone("447911123456")).toEqual({
			iso: "GB",
			dial: "44",
			national: "7911123456",
		});
		expect(splitStoredPhone("6737123456")?.iso).toBe("BN");
		expect(splitStoredPhone("14155550132")?.iso).toBe("US");
	});
	test("no code, no split", () => {
		expect(splitStoredPhone("")).toBeNull();
		expect(splitStoredPhone("999")).toBeNull();
	});
	test("formats +CC NATIONAL", () => {
		expect(formatInternational("819012345678")).toBe("+81 9012345678");
		expect(formatInternational("")).toBeNull();
	});
});

describe("detectTypedDialCode — the picker's auto-switch", () => {
	test("switches on a complete +CC and hands back the rest", () => {
		expect(detectTypedDialCode("+81 90-1234-5678", "MY")).toEqual({
			iso: "JP",
			dial: "81",
			rest: "90-1234-5678",
		});
		expect(detectTypedDialCode("0065 9123 4567", "MY")).toEqual({
			iso: "SG",
			dial: "65",
			rest: "9123 4567",
		});
	});
	test("waits for the code to be complete", () => {
		expect(detectTypedDialCode("+", "MY")).toBeNull();
		expect(detectTypedDialCode("+6", "MY")).toBeNull();
		expect(detectTypedDialCode("+60", "SG")?.iso).toBe("MY");
	});
	test("never sniffs bare digits", () => {
		expect(detectTypedDialCode("6591234567", "MY")).toBeNull();
		expect(detectTypedDialCode("012-345 6789", "MY")).toBeNull();
	});
	test("a shared code keeps a pick that answers to it", () => {
		expect(detectTypedDialCode("+1 416", "CA")?.iso).toBe("CA");
		expect(detectTypedDialCode("+1 416", "MY")?.iso).toBe("US");
	});
	test("an unknown code or stray character gives up", () => {
		expect(detectTypedDialCode("+999 1", "MY")).toBeNull();
		expect(detectTypedDialCode("+a1", "MY")).toBeNull();
	});
});
