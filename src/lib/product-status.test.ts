import { describe, expect, it } from "vitest";
import { productStatus } from "./product-status";

describe("productStatus", () => {
	it("labels a visible, in-stock product Live", () => {
		expect(
			productStatus({ active: true, hidden: false, inStock: true }).label,
		).toBe("Live");
	});

	it("labels an out-of-stock product Sold out (not Live)", () => {
		const s = productStatus({ active: true, hidden: false, inStock: false });
		expect(s.label).toBe("Sold out");
		expect(s.tone).toBe("warn");
	});

	it("labels a hidden product Hidden, even when in stock", () => {
		const s = productStatus({ active: true, hidden: true, inStock: true });
		expect(s.label).toBe("Hidden");
		expect(s.detail).toMatch(/counter/i);
	});

	it("treats category suppression like hidden", () => {
		expect(
			productStatus({
				active: true,
				hiddenByCategory: true,
				inStock: true,
			}).label,
		).toBe("Hidden");
	});

	it("hidden wins over sold out — visibility is the bigger fact", () => {
		expect(
			productStatus({ active: true, hidden: true, inStock: false }).label,
		).toBe("Hidden");
	});

	it("archived wins over everything", () => {
		expect(
			productStatus({ active: false, hidden: true, inStock: false }).label,
		).toBe("Archived");
	});
});
