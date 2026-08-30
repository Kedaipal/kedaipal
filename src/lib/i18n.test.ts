import { describe, expect, it } from "vitest";
import { LOCALES, type Locale } from "../../convex/lib/locale";
import en from "../../messages/en.json";
import ms from "../../messages/ms.json";
import zh from "../../messages/zh.json";
import projectSettings from "../../project.inlang/settings.json";

/**
 * Guards the Paraglide message catalogs (`messages/{locale}.json`) against the
 * three ways translations silently rot:
 *   1. A key added to one locale but not another (untranslated UI text).
 *   2. A placeholder (`{name}`) renamed/dropped in a translation, which breaks
 *      interpolation at runtime with no type error.
 *   3. An empty/blank translated value.
 * It does NOT catch hardcoded English that never goes through `m.*` — that's a
 * review concern. See docs/i18n.md.
 *
 * Generalized (not hardcoded to an en/ms pair) so a future locale is verified
 * automatically the moment its catalog file + `project.inlang/settings.json`
 * entry exist — see docs/i18n.md "Add a locale".
 */

const SCHEMA_KEY = "$schema";

// Loaded catalogs, keyed by locale. Add a new locale's `import` above and its
// entry here (or, once every catalog file exists, wire this from a manifest —
// vitest doesn't support dynamic `import()` of a variable path at collection
// time, so a static map is the simplest reliable option).
const CATALOGS: Record<Locale, Record<string, unknown>> = {
	en: en as Record<string, unknown>,
	ms: ms as Record<string, unknown>,
	zh: zh as Record<string, unknown>,
};

function messageKeys(catalog: Record<string, unknown>): string[] {
	return Object.keys(catalog).filter((k) => k !== SCHEMA_KEY);
}

function placeholders(value: string): string[] {
	return [...value.matchAll(/\{(\w+)\}/g)].map((mt) => mt[1]).sort();
}

const baseLocale: Locale = "en";
const baseKeys = messageKeys(CATALOGS[baseLocale]);
const otherLocales = LOCALES.filter((l) => l !== baseLocale);

describe("i18n message catalogs", () => {
	it("project.inlang/settings.json locales match the LOCALES the app knows about", () => {
		expect(new Set(projectSettings.locales)).toEqual(new Set(LOCALES));
	});

	it("every catalog file listed above is registered under a known Locale", () => {
		expect(Object.keys(CATALOGS).sort()).toEqual([...LOCALES].sort());
	});

	for (const locale of otherLocales) {
		const catalog = CATALOGS[locale];
		const keys = messageKeys(catalog);

		it(`${locale} has every key ${baseLocale} has (no untranslated strings)`, () => {
			const keySet = new Set(keys);
			const missing = baseKeys.filter((k) => !keySet.has(k));
			expect(
				missing,
				`keys missing from ${locale}.json: ${missing.join(", ")}`,
			).toEqual([]);
		});

		it(`${locale} has no keys that ${baseLocale} lacks (no orphan translations)`, () => {
			const baseSet = new Set(baseKeys);
			const extra = keys.filter((k) => !baseSet.has(k));
			expect(
				extra,
				`orphan keys in ${locale}.json: ${extra.join(", ")}`,
			).toEqual([]);
		});

		it(`each ${locale} key uses the same placeholders as its ${baseLocale} source`, () => {
			const mismatches: string[] = [];
			const baseRecord = CATALOGS[baseLocale] as Record<string, string>;
			const localeRecord = catalog as Record<string, string>;
			for (const key of baseKeys) {
				if (!(key in localeRecord)) continue;
				const basePlaceholders = placeholders(baseRecord[key]);
				const localePlaceholders = placeholders(localeRecord[key]);
				if (basePlaceholders.join(",") !== localePlaceholders.join(",")) {
					mismatches.push(
						`${key}: ${baseLocale}[${basePlaceholders.join(",")}] vs ${locale}[${localePlaceholders.join(",")}]`,
					);
				}
			}
			expect(
				mismatches,
				`placeholder mismatches:\n${mismatches.join("\n")}`,
			).toEqual([]);
		});
	}

	it("has no empty values in any locale", () => {
		const empties: string[] = [];
		for (const locale of LOCALES) {
			for (const key of messageKeys(CATALOGS[locale])) {
				const value = (CATALOGS[locale] as Record<string, string>)[key];
				if (typeof value !== "string" || value.trim() === "") {
					empties.push(`${locale}.${key}`);
				}
			}
		}
		expect(empties, `empty message values: ${empties.join(", ")}`).toEqual([]);
	});
});
