import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * The product CREATE route must forward every optional product-level field the
 * form collects (`z8r3fdff9u` post-mortem). The create call is hand-written, so
 * a rebase can silently drop one line of it while every convex test stays green
 * — they call the API directly and never notice the route starving it. That is
 * not hypothetical: the T2 rebase dropped `event:` exactly this way, and the
 * form then said "Product created." while storing a plain product.
 *
 * A source scan, not a render test, on purpose — the failure mode is a MISSING
 * LINE, which is precisely what a scan pins and what a behavioural test around
 * a mocked mutation can silently mock away. House precedent:
 * convex-read-pattern.test.ts, currency-literals.test.ts.
 */
describe("product create route — payload completeness", () => {
	const source = readFileSync(
		join(__dirname, "..", "routes", "app.products.new.tsx"),
		"utf8",
	);

	test.each(["event", "prepMinutes", "pickupNote", "minNoticeDays", "minQuantity", "booking"])(
		"the create call forwards %s",
		(field) => {
			expect(source).toMatch(new RegExp(`${field}: values.${field}`));
		},
	);
});
