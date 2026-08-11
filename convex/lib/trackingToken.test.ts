import { describe, expect, test } from "vitest";
import { normalizeTrackingToken, rescueTrackUrl } from "./trackingToken";

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

describe("rescueTrackUrl", () => {
	test("301-target for the exact prod failure shape", () => {
		expect(
			rescueTrackUrl(
				"https://kedaipal.com/track/%7B%7B1%7D%7Da4Ao6manneNOQivZUfPSVhbc",
			),
		).toBe("https://kedaipal.com/track/a4Ao6manneNOQivZUfPSVhbc");
	});

	test("preserves the query string", () => {
		expect(rescueTrackUrl("https://kedaipal.com/track/{{1}}tok?send=1")).toBe(
			"https://kedaipal.com/track/tok?send=1",
		);
	});

	test("returns null for clean links, other routes, and degenerate tokens", () => {
		expect(rescueTrackUrl("https://kedaipal.com/track/cleanToken")).toBeNull();
		expect(rescueTrackUrl("https://kedaipal.com/k-frozen-food")).toBeNull();
		expect(rescueTrackUrl("https://kedaipal.com/track/")).toBeNull();
		// Placeholder with no token after it — nothing to rescue.
		expect(rescueTrackUrl("https://kedaipal.com/track/%7B%7B1%7D%7D")).toBeNull();
		expect(rescueTrackUrl("not a url")).toBeNull();
	});
});
