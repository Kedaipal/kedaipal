// Reading URL search params safely (z8r3fdtk87).
//
// TanStack Router's default `parseSearch` JSON-parses every value, so the
// same text arrives in different types depending on how the URL was written:
// a box the app filled writes `?q=%229981%22` and reads back the string
// "9981", but a hand-typed or shared `?q=9981` reads back the NUMBER 9981
// (`true` → boolean, `[1]` → array, `{}` → object).
//
// Two rules follow, and every route's `validateSearch` keeps both:
//
// 1. CLOSE EVERY KEY YOU READ. TanStack merges the validator's result OVER the
//    raw parsed search, so a key the validator leaves out is not dropped — its
//    raw value leaks through `Route.useSearch()` with whatever type the URL
//    gave it. `...(ok ? { q } : {})` is the trap: on a bad value it returns no
//    `q`, and the raw number reaches the component, whose `q.trim()` throws
//    and takes the page down ("Something went wrong" on `/app/admin/sellers
//    ?q=9981` and on the public `/stores?q=2024`). Return the key with
//    `undefined` instead — `undefined` overrides the raw value and is dropped
//    from the URL. `search-params-sweep.test.ts` enforces this for every route.
//
// 2. FREE TEXT GOES THROUGH `searchText`. A search box, a voucher code or a
//    category name can be all digits, and `typeof === "string"` silently
//    throws such a link away. `searchText` takes the scalar back to the text
//    the URL spelled.

/**
 * A free-text search param as text, or `undefined` when there is none.
 *
 * Accepts the scalars TanStack's JSON parse can turn text into — a number
 * (`?q=9981`) or a boolean (`?q=true`) — and returns them as the string the
 * URL spelled. Arrays, objects and `null` are not text and read as absent.
 *
 * The value is NOT trimmed: a search box keeps the space the user just typed.
 * Whitespace-only reads as absent. One documented loss: JSON normalises
 * exotic number spellings, so `?q=1e3` reads back "1000" — leading-zero
 * values (`?q=0123…`, a local phone) are not valid JSON numbers and survive
 * as typed.
 */
export function searchText(raw: unknown): string | undefined {
	const text =
		typeof raw === "string"
			? raw
			: typeof raw === "number" && Number.isFinite(raw)
				? String(raw)
				: typeof raw === "boolean"
					? String(raw)
					: undefined;
	return text !== undefined && text.trim().length > 0 ? text : undefined;
}
