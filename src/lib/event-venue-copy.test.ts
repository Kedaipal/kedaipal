// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * The hidden-point workaround must stop being advertised (`z8r3fdm32x`).
 *
 * Before `pickupLocations.eventsOnly`, an events-only address had to
 * masquerade as a DEACTIVATED pickup point. Two pieces of seller-facing copy
 * told sellers to do exactly that — the server's refusal in `products.ts` and
 * `EVENT_NO_VENUE_COPY` on the Event card — both ending "A hidden point works
 * if it's only for events."
 *
 * With a dedicated Event venues section that advice contradicts the product:
 * it sends the seller to deactivate something in order to achieve what a
 * first-class control now does, and a deactivated point reads as retired
 * everywhere else.
 *
 * Why a scan and not an assertion on the constants: both strings are
 * module-private, they live on opposite sides of the client/server line, and
 * the pair survived an 89-commit `staging` merge unnoticed — a clean textual
 * merge says nothing about copy describing behaviour that was retired on the
 * other branch. House precedent: `convex-read-pattern.test.ts`,
 * `pricing-copy.test.ts`, `landing-funnel.test.ts`.
 */

const ROOT = join(__dirname, "..", "..");
const SCANNED_DIRS = ["src", "convex"];
const SKIP_DIRS = new Set([
	"node_modules",
	"_generated",
	"paraglide",
	"dist",
	".git",
]);

/**
 * Phrases that only make sense under the retired model. Deliberately matched
 * loosely (case-insensitive, flexible whitespace) so a reworded-but-equivalent
 * instruction still trips it.
 */
const RETIRED_ADVICE: Array<{ pattern: RegExp; why: string }> = [
	{
		pattern: /hidden point works/i,
		why: "tells the seller to deactivate a pickup point to make it events-only — that is what the Event venues section replaced",
	},
	{
		pattern: /a\s+hidden\s+point\s+is\s+(?:a\s+)?(?:fine|first-class)/i,
		why: "same retired workaround, reworded",
	},
];

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	const walk = (d: string) => {
		for (const entry of readdirSync(d, { withFileTypes: true })) {
			if (entry.name.startsWith(".")) continue;
			const full = join(d, entry.name);
			if (entry.isDirectory()) {
				if (SKIP_DIRS.has(entry.name)) continue;
				walk(full);
				continue;
			}
			if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
				out.push(full);
			}
		}
	};
	walk(join(ROOT, dir));
	return out;
}

describe("event venue copy", () => {
	test("no seller-facing copy still recommends a hidden pickup point", () => {
		const offenders: string[] = [];
		for (const dir of SCANNED_DIRS) {
			for (const file of sourceFiles(dir)) {
				const text = readFileSync(file, "utf8");
				for (const { pattern, why } of RETIRED_ADVICE) {
					if (pattern.test(text)) {
						offenders.push(`${relative(ROOT, file)} — ${why}`);
					}
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	test("the scan actually looks at a meaningful number of files", () => {
		// Guards the guard: a broken walk would make the test above pass by
		// scanning nothing.
		const count = SCANNED_DIRS.reduce((n, d) => n + sourceFiles(d).length, 0);
		expect(count).toBeGreaterThan(300);
	});
});
