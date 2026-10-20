import { describe, expect, it } from "vitest";
import type { DelyvaDispatchBlock } from "../../convex/delyva";
import {
	courierContactFallbackCopy,
	delyvaBlockCopy,
	UNKNOWN_DELYVA_BLOCK_COPY,
} from "./delyva-dispatch-block";

// Every member of the union, listed by hand — the Record in
// delyva-dispatch-block.ts is the compile-time half of this check.
const ALL_REASONS: DelyvaDispatchBlock[] = [
	"country_unsupported",
	"not_delivery",
	"bad_status",
	"job_active",
	"not_connected",
	"disabled",
	"plan_gated",
	"no_pickup_address",
	"no_address",
];

describe("delyvaBlockCopy", () => {
	it("gives every dispatch block its own seller-facing line", () => {
		const seen = new Set<string>();
		for (const reason of ALL_REASONS) {
			const copy = delyvaBlockCopy(reason);
			expect(copy).not.toBe(UNKNOWN_DELYVA_BLOCK_COPY);
			expect(copy).not.toContain(reason);
			expect(seen.has(copy)).toBe(false);
			seen.add(copy);
		}
	});

	it("country_unsupported names the way out, and no country (both book Delyva)", () => {
		// It said "only available for Malaysian stores" while
		// COUNTRY_DELYVA_BOOKING.SG was true — false on the day it was written.
		const copy = delyvaBlockCopy("country_unsupported");
		expect(copy).toMatch(/your country/);
		expect(copy).toMatch(/tracking number/);
		expect(copy).not.toMatch(/Malaysia|Singapore/);
	});

	it("falls back to a generic line for reasons it doesn't know", () => {
		expect(delyvaBlockCopy("quote_failed")).toBe(UNKNOWN_DELYVA_BLOCK_COPY);
	});
});

describe("courierContactFallbackCopy (z8r3fdh274)", () => {
	it("says who the courier will call, in the store's market", () => {
		expect(courierContactFallbackCopy("MY")).toBe(
			"This buyer's WhatsApp number isn't a Malaysian number, so the courier gets your store's number instead, with the buyer's real number in the booking note.",
		);
		expect(courierContactFallbackCopy("SG")).toContain(
			"isn't a Singapore number",
		);
	});
});
