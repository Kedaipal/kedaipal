/**
 * The one author of a JSON-LD `<script>` in a route's `head()`.
 *
 * TanStack renders a head script's `children` with `dangerouslySetInnerHTML`
 * on the server, and `JSON.stringify` leaves `<` and `/` alone — so a seller
 * string such as a store name `</script><script src=//x.yz>` would close the
 * tag mid-string and run as markup. The HTML parser ends a script at
 * `</script` whatever the JS/JSON context; only the characters themselves can
 * be changed. Every route builds its JSON-LD from seller- or admin-entered
 * text (store and product names, descriptions), and `/stores` lists every
 * seller on one shared page, so one bad name would reach every buyer there.
 *
 * `<` is the load-bearing escape (it kills `</script` and `<!--`); `>` and `&`
 * go too, so the string stays inert in any HTML context it is later moved to.
 * Each `\uXXXX` is plain JSON, so crawlers parse the same values.
 *
 * Machine-enforced: `json-ld.test.ts` fails on any `application/ld+json`
 * outside this file, so a route cannot pair the type with a raw stringify.
 */
const HTML_UNSAFE = /[<>&]/g;

const ESCAPES: Record<string, string> = {
	"<": "\\u003c",
	">": "\\u003e",
	"&": "\\u0026",
};

/** JSON safe to place verbatim between `<script>` tags. */
export function serializeJsonLd(data: object): string {
	return JSON.stringify(data).replace(HTML_UNSAFE, (ch) => ESCAPES[ch] ?? ch);
}

/** A `head()` `scripts` entry carrying `data` as structured data. */
export function jsonLdScript(data: object): {
	type: "application/ld+json";
	children: string;
} {
	return { type: "application/ld+json", children: serializeJsonLd(data) };
}
