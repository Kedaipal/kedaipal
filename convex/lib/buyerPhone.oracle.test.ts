/// <reference types="vite/client" />
import { getExampleNumber } from "libphonenumber-js/max";
import examples from "libphonenumber-js/mobile/examples";
import { describe, expect, test } from "vitest";
import { parseBuyerWaPhone } from "./buyerPhone";
import { DIAL_ROWS } from "./dialCodes";

/**
 * The oracle (z8r3fdh274 review): for EVERY country in the picker, take
 * libphonenumber's own example mobile and type it the five ways buyers do —
 * bare national number, national with the trunk prefix, the calling code
 * without its `+` (the wa.me habit), `+CC …` and `00CC …`. Each must store
 * exactly libphonenumber's E.164 digits: what Meta delivers inbound, what the
 * customer row keys on. This is what caught "62812…" under Indonesia being
 * stored as 62628…: a length-only check can't tell the code from the number.
 *
 * libphonenumber-js is a devDependency — it runs here, never in a bundle.
 */
const cases = DIAL_ROWS.flatMap((row) => {
	const example = getExampleNumber(row.iso, examples);
	if (!example) return [];
	const e164 = example.number.replace(/\D/g, "");
	const nsn = example.nationalNumber;
	const national = example.formatNational().replace(/\D/g, "");
	return [
		[row.iso, "national number", nsn, e164],
		[row.iso, "national, trunk prefix", national, e164],
		[row.iso, "code without +", `${row.dial}${nsn}`, e164],
		[row.iso, "+international", `+${e164}`, e164],
		[row.iso, "00 international", `00${e164}`, e164],
	] as const;
});

describe("parseBuyerWaPhone agrees with libphonenumber for every country", () => {
	test("there is an example for nearly every row", () => {
		expect(cases.length / 5).toBeGreaterThan(230);
	});

	test.each(cases)("%s — %s (%s)", (iso, _form, typed, e164) => {
		const result = parseBuyerWaPhone(typed, iso);
		expect(result).toMatchObject({ ok: true, digits: e164 });
	});
});
