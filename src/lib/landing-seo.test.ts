// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The landing meta description has a hard budget and one string that must
 * survive it (landing v2 review, PR #275). Google cuts the snippet around
 * 155–160 chars; "no Meta setup" is the structural differentiator vs
 * WATI / SleekFlow / EasyStore and does its work only if it is visible in
 * SERP. The previous copy was trimmed 167 → 145 for exactly this reason, then
 * a 173-char redraft put the phrase at char 159 while its own comment claimed
 * it was under the cut. A comment asked the next editor to remember; this
 * test measures instead.
 *
 * Scan-the-source rather than import: `index.tsx` is a TanStack route file,
 * and a route module's only export should be `Route` (house precedent for
 * source-scan gates: `currency-literals.test.ts`, `convex-read-pattern.test.ts`).
 */

const ROUTE = join(__dirname, "..", "routes", "index.tsx");
const SERP_BUDGET = 155;
const DIFFERENTIATOR = "no Meta setup";
/** The locked 8 Sep 2026 tagline the description opens with. */
const TAGLINE = "Sell on WhatsApp. Never lose an order or a payment.";

function readSeoDesc(): string {
	const src = readFileSync(ROUTE, "utf8");
	const match = src.match(/const SEO_DESC =\s*"((?:[^"\\]|\\.)*)";/);
	if (!match) throw new Error("SEO_DESC literal not found in routes/index.tsx");
	return JSON.parse(`"${match[1]}"`);
}

describe("landing meta description", () => {
	it(`stays within the ${SERP_BUDGET}-char SERP budget`, () => {
		const desc = readSeoDesc();
		expect(desc.length, desc).toBeLessThanOrEqual(SERP_BUDGET);
	});

	it("keeps the differentiator inside the cut, at the end where it lands", () => {
		const desc = readSeoDesc();
		expect(desc).toContain(DIFFERENTIATOR);
		expect(
			desc.indexOf(DIFFERENTIATOR) + DIFFERENTIATOR.length,
		).toBeLessThanOrEqual(SERP_BUDGET);
	});

	it("opens with the locked tagline and never names a trial length", () => {
		const desc = readSeoDesc();
		expect(desc.startsWith(TAGLINE)).toBe(true);
		expect(desc).not.toMatch(/14[- ]day|trial/i);
	});
});
