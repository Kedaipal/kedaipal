import { describe, expect, test } from "vitest";
import { pastOrderFilingMessage } from "./past-order-filing";

describe("pastOrderFilingMessage", () => {
	test("names how many orders were filed and under what", () => {
		expect(
			pastOrderFilingMessage({
				filedOrders: 15,
				filingContinues: false,
				categoryNames: ["COMBO BOOKS WITH ZOOM"],
			}),
		).toBe("15 earlier orders are now filed under COMBO BOOKS WITH ZOOM.");
	});

	test("singular for one order, and lists several categories", () => {
		expect(
			pastOrderFilingMessage({
				filedOrders: 1,
				filingContinues: false,
				categoryNames: ["Bestseller", "Kuih"],
			}),
		).toBe("1 earlier order is now filed under Bestseller and Kuih.");
	});

	test("says when older orders are still being filed", () => {
		expect(
			pastOrderFilingMessage({
				filedOrders: 200,
				filingContinues: true,
				categoryNames: ["Kuih"],
			}),
		).toBe(
			"200 earlier orders are now filed under Kuih. Older orders are being filed now.",
		);
		expect(
			pastOrderFilingMessage({
				filedOrders: 0,
				filingContinues: true,
				categoryNames: ["Kuih"],
			}),
		).toBe("Earlier orders for this product are being filed under Kuih now.");
	});

	test("nothing to say when nothing was filed", () => {
		expect(
			pastOrderFilingMessage({
				filedOrders: 0,
				filingContinues: false,
				categoryNames: ["Kuih"],
			}),
		).toBeUndefined();
	});
});
