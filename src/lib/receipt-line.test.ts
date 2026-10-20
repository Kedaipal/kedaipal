// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	RECEIPT_LABEL_CLASS,
	RECEIPT_VARIANT_CLASS,
	receiptLineLabel,
} from "./receipt-line";

describe("receiptLineLabel", () => {
	it("leads with the quantity, so a narrow column can never cut it", () => {
		expect(receiptLineLabel(4, "Kek Batik")).toBe("4× Kek Batik");
		// The bug this replaces put `×4` LAST, where truncation reached it first.
		expect(receiptLineLabel(4, "Kek Batik").endsWith("×4")).toBe(false);
	});

	it("always prints the quantity, including 1×, so the column reads evenly", () => {
		expect(receiptLineLabel(1, "Kek Batik")).toBe("1× Kek Batik");
	});

	it("never joins the variant onto the name", () => {
		// The caller renders `optionLabel` / `variantLabel` as its own line; if a
		// future change re-joins it here, a long name eats it again.
		expect(receiptLineLabel(2, "Kek Batik")).not.toContain("(");
		expect(receiptLineLabel(2, "Kek Batik")).not.toContain("·");
	});
});

describe("receipt label classes", () => {
	it("wraps rather than truncating, and can shrink below a long word", () => {
		expect(RECEIPT_LABEL_CLASS).toContain("wrap-anywhere");
		expect(RECEIPT_LABEL_CLASS).toContain("min-w-0");
		// `truncate` is the bug; `break-words` is the near-miss that does NOT
		// reduce a flex item's min-content size, so it would still overflow.
		expect(RECEIPT_LABEL_CLASS).not.toContain("truncate");
		expect(RECEIPT_LABEL_CLASS).not.toContain("break-words");
	});

	it("gives the variant its own line", () => {
		expect(RECEIPT_VARIANT_CLASS).toContain("block");
	});
});

/**
 * The divergence guard.
 *
 * Both buyer Order Tickets render the same design from separate components,
 * and they drifted once already: `z8r3fdhpaj` fixed the storefront receipt and
 * the claim receipt kept joining name + variant + a trailing `×qty` into one
 * truncated string. A reviewer caught it; this test is so the next one doesn't
 * have to.
 */
describe("every buyer Order Ticket builds its item label the same way", () => {
	const TICKETS = [
		"components/storefront/checkout-summary.tsx",
		"components/claim/claim-ticket.tsx",
	];

	for (const rel of TICKETS) {
		const src = readFileSync(join(__dirname, "..", rel), "utf8");

		it(`${rel} uses the shared label definition`, () => {
			expect(src).toContain('from "../../lib/receipt-line"');
			expect(src).toContain("receiptLineLabel(");
			expect(src).toContain("RECEIPT_LABEL_CLASS");
			expect(src).toContain("RECEIPT_VARIANT_CLASS");
		});

		it(`${rel} does not re-join the variant into the name`, () => {
			// The two shapes that shipped the bug, in either ticket.
			expect(src).not.toMatch(/\$\{[\w.]*variantLabel\}\)/);
			expect(src).not.toMatch(/·\s*\$\{[\w.]*optionLabel\}/);
		});
	}
});
