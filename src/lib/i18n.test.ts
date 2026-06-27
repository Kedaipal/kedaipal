import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import ms from "../../messages/ms.json";

/**
 * Guards the Paraglide message catalogs (`messages/{en,ms}.json`) against the
 * two ways translations silently rot:
 *   1. A key added to one locale but not the other (untranslated UI text).
 *   2. A placeholder (`{name}`) renamed/dropped in a translation, which breaks
 *      interpolation at runtime with no type error.
 * It does NOT catch hardcoded English that never goes through `m.*` — that's a
 * review concern. See docs/i18n.md.
 */

const SCHEMA_KEY = "$schema";

function messageKeys(catalog: Record<string, unknown>): string[] {
	return Object.keys(catalog).filter((k) => k !== SCHEMA_KEY);
}

function placeholders(value: string): string[] {
	return [...value.matchAll(/\{(\w+)\}/g)].map((mt) => mt[1]).sort();
}

const enKeys = messageKeys(en as Record<string, unknown>);
const msKeys = messageKeys(ms as Record<string, unknown>);

describe("i18n message catalogs", () => {
	it("ms has every key en has (no untranslated strings)", () => {
		const msSet = new Set(msKeys);
		const missing = enKeys.filter((k) => !msSet.has(k));
		expect(missing, `keys missing from ms.json: ${missing.join(", ")}`).toEqual(
			[],
		);
	});

	it("ms has no keys that en lacks (no orphan translations)", () => {
		const enSet = new Set(enKeys);
		const extra = msKeys.filter((k) => !enSet.has(k));
		expect(extra, `orphan keys in ms.json: ${extra.join(", ")}`).toEqual([]);
	});

	it("has no empty values in either locale", () => {
		const empties: string[] = [];
		for (const [locale, catalog] of [
			["en", en],
			["ms", ms],
		] as const) {
			for (const key of messageKeys(catalog as Record<string, unknown>)) {
				const value = (catalog as Record<string, string>)[key];
				if (typeof value !== "string" || value.trim() === "") {
					empties.push(`${locale}.${key}`);
				}
			}
		}
		expect(empties, `empty message values: ${empties.join(", ")}`).toEqual([]);
	});

	it("each translated key uses the same placeholders as its en source", () => {
		const mismatches: string[] = [];
		const enRecord = en as Record<string, string>;
		const msRecord = ms as Record<string, string>;
		for (const key of enKeys) {
			if (!(key in msRecord)) continue;
			const enPlaceholders = placeholders(enRecord[key]);
			const msPlaceholders = placeholders(msRecord[key]);
			if (enPlaceholders.join(",") !== msPlaceholders.join(",")) {
				mismatches.push(
					`${key}: en[${enPlaceholders.join(",")}] vs ms[${msPlaceholders.join(",")}]`,
				);
			}
		}
		expect(
			mismatches,
			`placeholder mismatches:\n${mismatches.join("\n")}`,
		).toEqual([]);
	});
});
