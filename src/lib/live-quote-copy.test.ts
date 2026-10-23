import { describe, expect, it } from "vitest";
import { liveQuoteAddressHint } from "./live-quote-copy";

/**
 * The address helper on a live-priced checkout (23 Oct 2026). It read "by
 * rider … outside the rider's coverage can't be delivered" on every live
 * store, which on a Delyva store was a lie: a courier priced an Alor Setar
 * address no rider could reach (`/test-code` on PR #415).
 */
describe("liveQuoteAddressHint", () => {
	it("riders alone: by rider, with the coverage edge and the pickup alternative", () => {
		expect(
			liveQuoteAddressHint({
				collectsFromCustomer: false,
				riders: true,
				couriers: false,
				selfCollectAvailable: true,
			}),
		).toBe(
			"Delivery is by rider, so the fee depends on your address — you'll see it here once you pick a suggestion. Addresses outside the rider's coverage can't be delivered — pick up instead.",
		);
	});

	it("no pickup to offer: the edge sentence stands alone", () => {
		expect(
			liveQuoteAddressHint({
				collectsFromCustomer: false,
				riders: true,
				couriers: false,
				selfCollectAvailable: false,
			}),
		).toMatch(/can't be delivered\.$/);
	});

	it("a courier can bid: by rider or courier, and the coverage edge is gone", () => {
		const hint = liveQuoteAddressHint({
			collectsFromCustomer: false,
			riders: true,
			couriers: true,
			selfCollectAvailable: true,
		});
		expect(hint).toBe(
			"Delivery is by rider or courier, so the fee depends on your address — you'll see it here once you pick a suggestion.",
		);
		expect(hint).not.toContain("coverage");
	});

	it("couriers alone: by courier", () => {
		expect(
			liveQuoteAddressHint({
				collectsFromCustomer: false,
				riders: false,
				couriers: true,
				selfCollectAvailable: false,
			}),
		).toMatch(/^Delivery is by courier, so/);
	});

	it("a collection service collects, and its edge is about collecting", () => {
		expect(
			liveQuoteAddressHint({
				collectsFromCustomer: true,
				riders: true,
				couriers: false,
				selfCollectAvailable: false,
			}),
		).toBe(
			"Collection is by rider, so the fee depends on your address — you'll see it here once you pick a suggestion. Addresses outside the rider's coverage can't be collected from.",
		);
	});
});
