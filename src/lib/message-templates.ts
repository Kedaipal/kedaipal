import {
	type Locale,
	type MessageTemplates,
	TEMPLATE_KEYS,
	type TemplateKey,
} from "../../convex/lib/whatsappCopy";

/** The languages a seller can write the order-number reply in. */
export const TEMPLATE_LOCALES: readonly Locale[] = ["en", "ms", "zh"];

/**
 * Only the editable keys survive into a save. A store from before the
 * one-message-per-order change can still carry `packed`/`shipped`/… overrides
 * in `retailer.messageTemplates`, and the `updateSettings` wire validator
 * accepts `confirm` alone — sending them back would refuse the WHOLE save, so
 * that seller could never edit their reply again. Blank values drop too: the
 * server treats a missing key as "use the default", the same thing a blank
 * means here.
 */
export function editableTemplates(
	source: MessageTemplates | undefined,
): MessageTemplates {
	const out: MessageTemplates = {};
	for (const loc of TEMPLATE_LOCALES) {
		const entry: Partial<Record<TemplateKey, string>> = {};
		for (const key of TEMPLATE_KEYS) {
			const v = source?.[loc]?.[key];
			if (typeof v === "string" && v.trim()) entry[key] = v;
		}
		if (Object.keys(entry).length > 0) out[loc] = entry;
	}
	return out;
}

/** Shared display label for a locale — the language card, the reply rows and
 * every locale picker. */
export const LOCALE_LABELS: Record<Locale, string> = {
	en: "English",
	ms: "Bahasa Malaysia",
	zh: "中文",
};
