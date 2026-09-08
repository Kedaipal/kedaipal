// @vitest-environment node
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
	containsBrand,
	isReservedSlug,
	RESERVED_SLUG_GROUPS,
	RESERVED_SLUG_MESSAGE,
	RESERVED_SLUGS,
} from "../../convex/lib/reservedSlugs";
import { assertValidSlug } from "../../convex/lib/slug";
import { SLUG_MAX, SLUG_MIN, slugSchema, validateSlugShape } from "./slug";

/**
 * Gate test for the reserved store-handle list (ClickUp z8r3fddrd3).
 *
 * A store lives at `kedaipal.com/<slug>`, so every top-level path the app
 * serves is a name a vendor must be refused. The list was hand-written at MVP
 * and by September 2026 six live routes (`claim`, `track`, `cost`, `terms`,
 * `privacy`, `acceptable-use`) and four `public/` folders had been added
 * without anyone touching it — a vendor could have registered `track`. Prose
 * does not fail a build; this does. House precedent for a scan-the-source
 * gate: `convex-read-pattern.test.ts`, `dependency-pins.test.ts`.
 */

const REPO = join(__dirname, "..", "..");

/**
 * First URL segment of a TanStack file route, or null when the file does not
 * claim a fixed top-level segment: `__root`, `index`, `$param` routes (those
 * are what a store slug IS), and the `[.]`-escaped dotted files whose names
 * the slug shape already rejects (asserted separately below).
 */
function topSegment(file: string): string | null {
	const name = file.replace(/\.tsx?$/, "").replace(/\[\.\]/g, "\0");
	const first = name.split(".")[0].replace(/_$/, "");
	if (first === "__root" || first === "index") return null;
	if (first.startsWith("$")) return null;
	if (first.includes("\0")) return null;
	return first;
}

function liveRouteSegments(): string[] {
	const files = readdirSync(join(REPO, "src", "routes"));
	const segments = new Set<string>();
	for (const f of files) {
		const seg = topSegment(f);
		if (seg) segments.add(seg);
	}
	return [...segments].sort();
}

function publicTopLevel(): string[] {
	return readdirSync(join(REPO, "public"))
		.filter((name) => !name.includes("."))
		.sort();
}

describe("reserved slugs cover the namespace a store shares", () => {
	test("every live top-level route is reserved", () => {
		const missing = liveRouteSegments().filter((s) => !isReservedSlug(s));
		expect(
			missing,
			`Route segment(s) a vendor could register as a store: ${missing.join(", ")} — add to LIVE_ROUTES in convex/lib/reservedSlugs.ts`,
		).toEqual([]);
	});

	test("LIVE_ROUTES lists exactly the routes on disk — no stale entries", () => {
		// A stale entry is harmless to buyers but lies to the next reader about
		// what exists. Live routes that move into another group still count.
		const onDisk = liveRouteSegments();
		expect([...RESERVED_SLUG_GROUPS.LIVE_ROUTES].sort()).toEqual(onDisk);
	});

	test("every public/ folder served from the root is reserved", () => {
		const missing = publicTopLevel().filter((s) => !isReservedSlug(s));
		expect(
			missing,
			`public/ folder(s) a vendor could register as a store: ${missing.join(", ")} — add to PUBLIC_FOLDERS in convex/lib/reservedSlugs.ts`,
		).toEqual([]);
		expect([...RESERVED_SLUG_GROUPS.PUBLIC_FOLDERS].sort()).toEqual(
			publicTopLevel(),
		);
	});

	test("dotted route and asset filenames are already unreachable as slugs", () => {
		// Why sitemap.xml / favicon.ico / robots.txt are NOT in the list: the
		// slug shape refuses them before the reserved check ever runs. If the
		// shape ever loosens, this is the test that says the list must grow.
		const dotted = [
			...readdirSync(join(REPO, "src", "routes"))
				.filter((f) => f.includes("[.]"))
				.map((f) => f.replace(/\.tsx?$/, "").replace(/\[\.\]/g, ".")),
			...readdirSync(join(REPO, "public")).filter((n) => n.includes(".")),
		];
		expect(dotted.length).toBeGreaterThan(0);
		for (const name of dotted) {
			expect(validateSlugShape(name)).toEqual({ ok: false, reason: "invalid" });
		}
		// TanStack Start's own internals.
		expect(validateSlugShape("_server")).toEqual({
			ok: false,
			reason: "invalid",
		});
	});
});

describe("the list itself stays honest", () => {
	test("no entry is dead — each one is a slug the shape would otherwise accept", () => {
		// `favicon.ico`, `_` and friends used to sit here giving false comfort:
		// they could never be typed as a slug, so listing them protected nothing.
		for (const entry of RESERVED_SLUGS) {
			expect(entry, `"${entry}" can never be a slug`).toMatch(
				/^[a-z0-9]+(-[a-z0-9]+)*$/,
			);
			expect(entry.length).toBeGreaterThanOrEqual(SLUG_MIN);
			expect(entry.length).toBeLessThanOrEqual(SLUG_MAX);
		}
	});

	test("no name is listed in two groups", () => {
		const all = Object.values(RESERVED_SLUG_GROUPS).flat();
		const dupes = all.filter((s, i) => all.indexOf(s) !== i);
		expect(dupes).toEqual([]);
	});

	test("no exact entry carries the brand — containsBrand already covers it", () => {
		for (const entry of RESERVED_SLUGS) {
			expect(
				containsBrand(entry),
				`"${entry}" is already refused by the brand rule`,
			).toBe(false);
		}
	});
});

describe("the brand rule — anywhere in the text, however it is spelled", () => {
	test("refuses the brand as prefix, suffix or infix", () => {
		for (const s of [
			"kedaipal",
			"kedaipal-official",
			"official-kedaipal",
			"the-kedaipal-store",
			"kedaipalhq",
			"my-kedaipal-store",
		]) {
			expect(isReservedSlug(s), s).toBe(true);
		}
	});

	test("separators and case do not hide it", () => {
		// One normalisation (lowercase, strip non-alphanumerics) instead of a
		// hand-listed set of spellings — so `kedai-pal` needs no entry.
		for (const s of [
			"kedai-pal",
			"Kedai Pal",
			"K.E.D.A.I.P.A.L",
			"KEDAIPAL",
			"kedai_pal",
		]) {
			expect(containsBrand(s), s).toBe(true);
		}
	});

	test("does not refuse the ordinary Malay word for shop", () => {
		for (const s of [
			"kedai-runcit",
			"kedai-ali",
			"pal-mart",
			"kedai-pals-friend",
		]) {
			expect(isReservedSlug(s), s).toBe(s === "kedai-pals-friend");
		}
	});
});

describe("both validators agree, with the same words", () => {
	test("server validator throws the shared message", () => {
		for (const s of ["track", "privacy", "img", "kedaipal-support", "orders"]) {
			expect(() => assertValidSlug(s), s).toThrow(RESERVED_SLUG_MESSAGE);
		}
	});

	test("client schema and live pre-check refuse the same names", () => {
		for (const s of ["track", "privacy", "img", "kedaipal-support", "orders"]) {
			expect(() => slugSchema.parse(s), s).toThrow(RESERVED_SLUG_MESSAGE);
			expect(validateSlugShape(s), s).toEqual({
				ok: false,
				reason: "reserved",
			});
		}
	});

	test("an ordinary shop handle still passes both", () => {
		expect(assertValidSlug("Kuih-Mak-Cik")).toBe("kuih-mak-cik");
		expect(slugSchema.parse("Kuih-Mak-Cik")).toBe("kuih-mak-cik");
	});

	test("the copy names who reserved it", () => {
		expect(RESERVED_SLUG_MESSAGE).toMatch(/Kedaipal/);
	});
});
