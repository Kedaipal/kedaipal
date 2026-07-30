import { describe, expect, it } from "vitest";
import type { DispatchBlock } from "../../convex/lalamove";
import { dispatchBlockCopy } from "./dispatch-block";

const ALL_REASONS: DispatchBlock[] = [
	"not_delivery",
	"bad_status",
	"job_active",
	"booking_disabled",
	"plan_gated",
	"no_credentials",
	"no_coords",
	"no_buyer_phone",
	"no_seller_phone",
];

describe("dispatchBlockCopy", () => {
	it("gives every dispatch block its own seller-facing line", () => {
		for (const reason of ALL_REASONS) {
			const copy = dispatchBlockCopy(reason);
			expect(copy.length).toBeGreaterThan(0);
			// The raw enum must never leak into seller-facing copy.
			expect(copy).not.toContain(reason);
		}
	});

	it("names a fix path on the reasons a seller can act on", () => {
		expect(dispatchBlockCopy("no_credentials")).toContain("Settings");
		expect(dispatchBlockCopy("no_seller_phone")).toContain("Settings");
		expect(dispatchBlockCopy("booking_disabled")).toContain("Settings");
		expect(dispatchBlockCopy("plan_gated")).toContain("Pro");
		expect(dispatchBlockCopy("no_coords")).toContain("map pin");
	});

	it("falls back to a generic line for reasons it doesn't know", () => {
		// The booking actions widen the union with their own failures.
		expect(dispatchBlockCopy("quote_failed")).toBe(
			"Booking isn't available for this order.",
		);
		expect(dispatchBlockCopy("not_found")).toBe(
			"Booking isn't available for this order.",
		);
	});
});
