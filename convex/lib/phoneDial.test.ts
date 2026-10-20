/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { COUNTRIES, COUNTRY_DIAL_CODE } from "./country";
import { DIAL_ROWS } from "./dialCodes";
import { DIAL_COUNTRY_NAMES } from "./dialCountryNames";
import {
	cleanPhoneInput,
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
		expect(formatInternational("819012345678")).toBe("+81 901 234 5678");
		expect(formatInternational("")).toBeNull();
	});
	test("a malformed legacy row isn't dressed up as a foreign number (review)", () => {
		// A bare MY NSN stored before normalization: "1" is +1, but 159399791 is
		// no US length — render it plainly rather than as "+1 159399791".
		expect(formatInternational("1159399791")).toBeNull();
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

describe("cleanPhoneInput", () => {
	test("strips bidi marks and maps script digits to ASCII", () => {
		expect(cleanPhoneInput("‪+44 7911‬")).toBe("+44 7911");
		expect(cleanPhoneInput("٠١٢٣")).toBe("0123");
		expect(cleanPhoneInput("۰۱۲")).toBe("012");
		expect(cleanPhoneInput("０１２")).toBe("012");
		expect(cleanPhoneInput("+60 12-345")).toBe("+60 12-345");
	});
	test("the auto-switch sees a + behind a bidi mark", () => {
		expect(detectTypedDialCode("‪+44 7911 123456", "MY")?.iso).toBe("GB");
	});
});

describe("groupNational (via formatInternational) — the echo has to be checkable", () => {
	test("every group is 3–4 digits, never an orphan", () => {
		// 7911123456 as one run defeats the echo line's whole job: spotting a
		// transposed digit. Lengths are the national part after the code.
		const cases: [string, string][] = [
			["6737123456", "+673 712 3456"], // 7 → 3+4
			["85298765432", "+852 9876 5432"], // 8 → 4+4
			["628123456789", "+62 812 345 6789"], // 10 → 3+3+4
			["447911123456", "+44 791 112 3456"], // 10 → 3+3+4
			["919876543210", "+91 987 654 3210"], // 10 → 3+3+4
		];
		for (const [stored, formatted] of cases) {
			expect(formatInternational(stored)).toBe(formatted);
		}
		for (const [stored] of cases) {
			const groups = (formatInternational(stored) as string)
				.split(" ")
				.slice(1);
			for (const g of groups) expect(g.length).toBeGreaterThanOrEqual(3);
			for (const g of groups) expect(g.length).toBeLessThanOrEqual(4);
		}
	});

	test("a short national number is left whole rather than split oddly", () => {
		// Niue (+683) mobiles are 4 digits — "88 88" would read as a mistake.
		expect(formatInternational("6831234")).toBe("+683 1234");
	});
});
