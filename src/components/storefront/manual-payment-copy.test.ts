import { describe, expect, it } from "vitest";
import type { ImageRejectReason } from "../../lib/image-upload";
import { isMalay, manualPaymentCopy } from "./manual-payment-copy";

const REASONS: ImageRejectReason[] = [
	"not_an_image",
	"undecodable",
	"too_large",
	"encode_failed",
];

/** Every key resolved to a string, so the two locales can be compared whole. */
function resolved(locale: string): Record<string, string> {
	const c = manualPaymentCopy(locale);
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(c)) {
		if (key === "rejectMessage") {
			for (const reason of REASONS) {
				out[`rejectMessage.${reason}`] = c.rejectMessage(reason);
			}
			continue;
		}
		out[key] =
			typeof value === "function"
				? // Both one- and two-arg builders; the extra arg is harmless.
					(value as (a: string, b: string) => string)("ORD-AB12", "Kek Store")
				: (value as string);
	}
	return out;
}

/**
 * Pairs that are legitimately the same word in both languages. Declared rather
 * than inferred, so a string someone forgot to translate shows up as a failure
 * instead of blending in.
 */
const SAME_IN_BOTH = new Set(["bank"]);

describe("manual-payment sheet copy (z8r3fdnpxf)", () => {
	const en = resolved("en");
	const ms = resolved("ms");

	it("answers in both languages for every string", () => {
		const untranslated = Object.keys(en).filter(
			(key) => !SAME_IN_BOTH.has(key) && en[key] === ms[key],
		);
		// The reason this file exists: the sheet is the buyer's highest-stakes
		// surface and a half-Malay one reads worse than a consistent English one.
		expect(untranslated).toEqual([]);
	});

	it("leaves no string empty in either language", () => {
		for (const key of Object.keys(en)) {
			expect(en[key].trim(), `en.${key}`).not.toBe("");
			expect(ms[key].trim(), `ms.${key}`).not.toBe("");
		}
	});

	it("covers exactly the same keys in both languages", () => {
		expect(Object.keys(ms).sort()).toEqual(Object.keys(en).sort());
	});

	it("tells a buyer to take a screenshot, never to convert the file on a Mac", () => {
		// The shared `imageRejectMessage` names Preview → Export as JPEG because
		// its other caller is a seller on a laptop. This buyer is on a phone and
		// now cannot pay until an image lands, so the fix has to be reachable
		// from where they are.
		expect(en["rejectMessage.undecodable"]).toMatch(/screenshot/i);
		expect(en["rejectMessage.undecodable"]).not.toMatch(/preview|export/i);
		expect(ms["rejectMessage.undecodable"]).toMatch(/tangkapan skrin/i);
	});

	it("names the store in the way out of the mandatory attachment", () => {
		expect(manualPaymentCopy("en").cantAttach("Kek Store")).toContain(
			"Kek Store",
		);
		expect(manualPaymentCopy("ms").cantAttach("Kek Store")).toContain(
			"Kek Store",
		);
	});

	it("reads only `ms` as Malay — an unset or `zh` store gets English", () => {
		expect(isMalay("ms")).toBe(true);
		expect(isMalay("en")).toBe(false);
		expect(isMalay("zh")).toBe(false);
		expect(isMalay(undefined)).toBe(false);
		expect(manualPaymentCopy(undefined).submit).toBe(
			manualPaymentCopy("en").submit,
		);
	});
});
