import { describe, expect, test } from "vitest";
import { normalizeTrackingToken, rescuePlaceholderUrl } from "./trackingToken";

describe("normalizeTrackingToken", () => {
	test("passes clean tokens through untouched", () => {
		expect(normalizeTrackingToken("a4Ao6manneNOQivZUfPSVhbc")).toBe(
			"a4Ao6manneNOQivZUfPSVhbc",
		);
	});

	test("strips a literal {{1}} prefix", () => {
		expect(normalizeTrackingToken("{{1}}a4Ao6manneNOQivZUfPSVhbc")).toBe(
			"a4Ao6manneNOQivZUfPSVhbc",
		);
	});

	test("strips a percent-encoded prefix in either hex case", () => {
		expect(normalizeTrackingToken("%7B%7B1%7D%7Dtok")).toBe("tok");
		expect(normalizeTrackingToken("%7b%7b1%7d%7dtok")).toBe("tok");
	});

	test("strips repeated placeholders but never mid-token braces", () => {
		expect(normalizeTrackingToken("{{1}}{{2}}tok")).toBe("tok");
		// Pollution is strictly a prefix (WhatsApp appends the suffix after the
		// literal placeholder) — anything later is not ours to rewrite.
		expect(normalizeTrackingToken("tok{{1}}")).toBe("tok{{1}}");
	});
});

describe("rescuePlaceholderUrl", () => {
	test("301-target for the exact prod failure shape", () => {
		expect(
			rescuePlaceholderUrl(
				"https://kedaipal.com/track/%7B%7B1%7D%7Da4Ao6manneNOQivZUfPSVhbc",
			),
		).toBe("https://kedaipal.com/track/a4Ao6manneNOQivZUfPSVhbc");
	});

	test("preserves the query string", () => {
		expect(
			rescuePlaceholderUrl("https://kedaipal.com/track/{{1}}tok?send=1"),
		).toBe("https://kedaipal.com/track/tok?send=1");
	});

	// The seller alert templates (86eyhw9zy) are the first URL buttons on a
	// non-/track path; the identical mis-registration must land on the same
	// rescue instead of 307-looping the SELLER out of their own order.
	test("rescues the seller-alert /app/orders button shape", () => {
		expect(
			rescuePlaceholderUrl(
				"https://kedaipal.com/app/orders/%7B%7B1%7D%7DORD-4821",
			),
		).toBe("https://kedaipal.com/app/orders/ORD-4821");
		expect(
			rescuePlaceholderUrl("https://kedaipal.com/app/orders/{{1}}ORD-4821"),
		).toBe("https://kedaipal.com/app/orders/ORD-4821");
	});

	test("rescues a placeholder in any segment, not just the last", () => {
		expect(
			rescuePlaceholderUrl("https://kedaipal.com/{{1}}k-frozen-food/checkout"),
		).toBe("https://kedaipal.com/k-frozen-food/checkout");
	});

	test("returns null for clean links, other routes, and degenerate paths", () => {
		expect(
			rescuePlaceholderUrl("https://kedaipal.com/track/cleanToken"),
		).toBeNull();
		expect(rescuePlaceholderUrl("https://kedaipal.com/k-frozen-food")).toBeNull();
		expect(rescuePlaceholderUrl("https://kedaipal.com/app/orders")).toBeNull();
		expect(rescuePlaceholderUrl("https://kedaipal.com/track/")).toBeNull();
		// Placeholder and nothing else — the parameter never arrived, so there is
		// no destination to guess. Let the router 404 it.
		expect(
			rescuePlaceholderUrl("https://kedaipal.com/track/%7B%7B1%7D%7D"),
		).toBeNull();
		expect(
			rescuePlaceholderUrl("https://kedaipal.com/app/orders/{{1}}"),
		).toBeNull();
		expect(rescuePlaceholderUrl("not a url")).toBeNull();
	});
});
