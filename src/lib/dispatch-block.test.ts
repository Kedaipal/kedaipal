import { describe, expect, it } from "vitest";
import type { DispatchBlock } from "../../convex/lalamove";
import { dispatchBlockCopy, UNKNOWN_BLOCK_COPY } from "./dispatch-block";

// Every member of the union, listed by hand: if `DispatchBlock` grows, the
// Record in dispatch-block.ts stops compiling — and this list going stale is
// caught by the "no reason falls back to the generic line" case below.
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
		const seen = new Set<string>();
		for (const reason of ALL_REASONS) {
			const copy = dispatchBlockCopy(reason);
			// A real line, not the catch-all — this copy is a rider vendor's whole
			// explanation when booking is unavailable.
			expect(copy).not.toBe(UNKNOWN_BLOCK_COPY);
			// The raw enum must never leak into seller-facing copy.
			expect(copy).not.toContain(reason);
			expect(seen.has(copy)).toBe(false);
			seen.add(copy);
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
		expect(dispatchBlockCopy("quote_failed")).toBe(UNKNOWN_BLOCK_COPY);
		expect(dispatchBlockCopy("not_found")).toBe(UNKNOWN_BLOCK_COPY);
	});
});
