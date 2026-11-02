import { describe, expect, it } from "vitest";
import type { DispatchBlock } from "../../convex/lalamove";
import {
	dispatchBlockCopy,
	riderContactFallbackCopy,
	UNKNOWN_BLOCK_COPY,
} from "./dispatch-block";

// Every member of the union, listed by hand: if `DispatchBlock` grows, the
// Record in dispatch-block.ts stops compiling — and this list going stale is
// caught by the "no reason falls back to the generic line" case below.
const ALL_REASONS: DispatchBlock[] = [
	"country_unsupported",
	"not_delivery",
	"bad_status",
	"job_active",
	"booking_disabled",
	"no_business_address",
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

	it("country_unsupported offers the alternative instead of a fix (86eyqgujv)", () => {
		// The one reason with no setting to change: rider booking isn't served
		// in the store's country. Pointing the seller at Settings would be a dead
		// end, so the line names what they do instead — ship it themselves.
		const copy = dispatchBlockCopy("country_unsupported");
		expect(copy).not.toContain("Settings");
		expect(copy).toMatch(/your country/);
		expect(copy).toMatch(/shipped yourself/);
		// Never a named country: both countries we sell in book riders, so a
		// "Malaysian stores only" line would be false wherever it showed.
		expect(copy).not.toMatch(/Malaysia|Singapore/);
	});

	it("falls back to a generic line for reasons it doesn't know", () => {
		// The booking actions widen the union with their own failures.
		expect(dispatchBlockCopy("quote_failed")).toBe(UNKNOWN_BLOCK_COPY);
		expect(dispatchBlockCopy("not_found")).toBe(UNKNOWN_BLOCK_COPY);
	});
});

describe("riderContactFallbackCopy (z8r3fdh274)", () => {
	it("names the store's own market — Malaysian on an MY store", () => {
		expect(riderContactFallbackCopy("MY", false)).toBe(
			"This buyer's WhatsApp number isn't a Malaysian number, and Lalamove only takes Malaysian contacts — the rider gets your store's number instead, with the buyer's real number in the rider notes.",
		);
	});

	it("…and Singapore on an SG store, where the old line said '+60'", () => {
		const copy = riderContactFallbackCopy("SG", false);
		expect(copy).toContain("isn't a Singapore number");
		expect(copy).toContain("only takes Singapore contacts");
		expect(copy).not.toMatch(/Malaysia|\+60/);
	});

	it("on a collection trip it names the rider who comes to the BUYER", () => {
		expect(riderContactFallbackCopy("MY", true)).toContain(
			"— the rider collecting from the buyer gets your store's number instead, with the buyer's real number in the rider notes.",
		);
	});
});
