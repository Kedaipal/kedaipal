// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";
import {
	MAX_OPTION_AXES,
	MAX_VALUES_PER_AXIS,
	MAX_VARIANTS_PER_PRODUCT,
} from "../../convex/lib/variant";

/**
 * Machine enforcement that the product-variant caps have exactly ONE definition
 * (ClickUp z8r3fdjgvd).
 *
 * They used to be hand-mirrored: `convex/lib/variant.ts` held the truth, and
 * `src/lib/product-import.ts` carried a copy with a "kept in sync manually"
 * comment. Manual sync is what actually happened — two MORE copies grew that
 * nobody had written down, in `variant-editor.tsx` (`MAX_VARIANTS = 50`) and
 * `product-wizard.tsx`, under different names so a grep for the canonical one
 * missed them. Raising the cap while those sat at 50 would have left the server
 * accepting 56 variants and the editor still refusing to save them: the seller
 * sees "56 variants exceeds the max of 50" and the release looks shipped.
 *
 * `convex/lib/variant.ts` imports nothing, so `src/` importing it is free — the
 * pattern 200+ files in this app already use for `convex/lib/*` helpers. There
 * is therefore no bundle argument for a mirror, only drift.
 *
 * House precedent for a scan-the-source gate test: `convex-read-pattern.test.ts`
 * and `dependency-pins.test.ts`.
 */

const ROOTS = [join(__dirname, ".."), join(__dirname, "..", "..", "convex")];

/** Generated trees — not hand-written, and not ours to police. */
const SKIP_DIRS = new Set(["paraglide", "node_modules", "_generated"]);
const SKIP_FILES = new Set(["routeTree.gen.ts"]);

/** The one file allowed to declare them. */
const CANONICAL = join("convex", "lib", "variant.ts");

/**
 * Names the net catches that are a DIFFERENT concept, not a mirror of a cap on
 * the size of the option grid. Listed explicitly so adding one is a decision.
 */
const NOT_A_GRID_CAP = new Set([
	// Images attached to a single variant — nothing to do with how many variants
	// a product may have.
	"MAX_IMAGES_PER_VARIANT",
]);

function sourceFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) sourceFiles(join(dir, entry.name), acc);
			continue;
		}
		if (SKIP_FILES.has(entry.name)) continue;
		if (/\.tsx?$/.test(entry.name)) acc.push(join(dir, entry.name));
	}
	return acc;
}

/**
 * Any local binding whose name says "cap on axes / values / variants". Catches
 * the aliases the real mirrors used (`MAX_AXES`, `MAX_VARIANTS`) rather than
 * only the canonical spellings, which is exactly how they stayed hidden.
 */
const LOCAL_CAP_DECL_RE =
	/(?:^|\n)\s*(?:export\s+)?const\s+(MAX_[A-Z0-9_]*(?:AXES|AXIS|VARIANTS?)[A-Z0-9_]*)\s*=/g;

const FILES = ROOTS.flatMap((root) => sourceFiles(root));
const REPO = join(__dirname, "..", "..");

describe("product-variant caps have a single definition", () => {
	test("the scan actually walked both source trees", () => {
		// Without this, a broken walk would make the assertion below vacuously
		// pass — a green test proving nothing is worse than no test.
		expect(FILES.length).toBeGreaterThan(200);
		expect(
			FILES.some((f) => f.endsWith(join("forms", "variant-editor.tsx"))),
		).toBe(true);
		expect(FILES.some((f) => f.endsWith(CANONICAL))).toBe(true);
	});

	test("no file outside convex/lib/variant.ts declares a variant cap", () => {
		const offenders: string[] = [];
		for (const file of FILES) {
			const rel = relative(REPO, file);
			if (rel === CANONICAL) continue;
			// A test may state the number it is pinning; that is the point of a pin.
			if (/\.test\.tsx?$/.test(rel)) continue;
			for (const match of readFileSync(file, "utf8").matchAll(
				LOCAL_CAP_DECL_RE,
			)) {
				if (NOT_A_GRID_CAP.has(match[1])) continue;
				offenders.push(`${rel} — const ${match[1]}`);
			}
		}

		expect(
			offenders,
			[
				"These files declare their own product-variant cap instead of importing",
				"the one in convex/lib/variant.ts. A mirror that drifts low makes the",
				"editor refuse a grid the server would accept, with no failing test.",
				"",
				"Import it instead:",
				'  import { MAX_VARIANTS_PER_PRODUCT } from "../../convex/lib/variant";',
			].join("\n"),
		).toEqual([]);
	});

	test("the caps are the values every surface quotes", () => {
		// Pins the numbers themselves so a change is a deliberate edit here, next
		// to the docs + release-note obligation, rather than a silent one.
		expect(MAX_OPTION_AXES).toBe(2);
		expect(MAX_VALUES_PER_AXIS).toBe(25);
		expect(MAX_VARIANTS_PER_PRODUCT).toBe(100);
	});
});
