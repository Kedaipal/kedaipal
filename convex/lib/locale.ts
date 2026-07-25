// Canonical `Locale` union — the SINGLE source of truth for every buyer/seller
// -facing locale in the codebase (WhatsApp copy, emails, order-status labels,
// the retailer's stored `locale` field, OG meta tags). Every module that used
// to declare its own `Locale = "en" | "ms"` now imports it from here instead,
// so adding a locale is a one-file type change — any Record<Locale, …> lookup
// missing the new key becomes a compile error, not a silent English fallback.
//
// Pure — no Convex imports — so it's safe to import from both `convex/` (server)
// and `src/` (client) code. Client files reach into `convex/lib/*` directly
// elsewhere in this codebase (see src/lib/insights-view.ts, src/lib/subscription.ts,
// src/routes/app.settings.tsx importing `Locale` from convex/lib/whatsappCopy),
// so this file is imported the same way rather than duplicated client-side.
//
// NOTE: `src/lib/orderStatus.ts` mirrors `convex/lib/orderStatus.ts` (separate
// files because the two bundle from different directories) but imports THIS
// file directly for the `Locale` type itself, rather than re-declaring it — see
// docs/i18n.md "Add a locale" for the add-a-locale checklist.

export type Locale = "en" | "ms" | "zh";

export const LOCALES: readonly Locale[] = ["en", "ms", "zh"];

export const DEFAULT_LOCALE: Locale = "en";

/**
 * Narrow an arbitrary value (a DB field, query param, header) to a known
 * `Locale`. Unknown, missing, or invalid input falls back to `"en"` — the
 * same fallback semantics the original `whatsappCopy.pickLocale` had, now
 * covering all of `LOCALES`. Never throws.
 */
export function pickLocale(input: unknown): Locale {
	return typeof input === "string" &&
		(LOCALES as readonly string[]).includes(input)
		? (input as Locale)
		: DEFAULT_LOCALE;
}

/** Open Graph `og:locale` values (BCP-47-ish, territory-tagged for Malaysia). */
export const OG_LOCALE: Record<Locale, string> = {
	en: "en_MY",
	ms: "ms_MY",
	zh: "zh_MY",
};
