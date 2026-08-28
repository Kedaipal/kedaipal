import { describe, expect, test } from "vitest";
import {
	ATTRIBUTION_MAX_LENGTH,
	ATTRIBUTION_OTHER,
	attributionBucket,
	KNOWN_SOURCE_LABELS,
	SHARE_TAG_PRESETS,
	sanitizeAttributionSource,
	sourceLabel,
} from "./attribution";

describe("sanitizeAttributionSource", () => {
	test("absent / blank → undefined (direct, never stamped)", () => {
		expect(sanitizeAttributionSource(undefined)).toBeUndefined();
		expect(sanitizeAttributionSource(null)).toBeUndefined();
		expect(sanitizeAttributionSource("")).toBeUndefined();
		expect(sanitizeAttributionSource("   ")).toBeUndefined();
	});

	test("clean tags pass through", () => {
		expect(sanitizeAttributionSource("tiktok")).toBe("tiktok");
		expect(sanitizeAttributionSource("raya-promo")).toBe("raya-promo");
		expect(sanitizeAttributionSource("live_2026")).toBe("live_2026");
		// The claim-link stamp (86eyq0epn) must survive sanitization untouched.
		expect(sanitizeAttributionSource("tiktok-live")).toBe("tiktok-live");
	});

	test("normalizes case and whitespace", () => {
		expect(sanitizeAttributionSource("TikTok")).toBe("tiktok");
		expect(sanitizeAttributionSource("  Instagram ")).toBe("instagram");
		expect(sanitizeAttributionSource("raya promo")).toBe("raya-promo");
	});

	test("strips disallowed chars, collapses + trims separators", () => {
		expect(sanitizeAttributionSource("tik!tok?")).toBe("tiktok");
		expect(sanitizeAttributionSource("a--__b")).toBe("a-b");
		expect(sanitizeAttributionSource("--tiktok--")).toBe("tiktok");
	});

	test("present-but-garbage buckets to 'other', never to direct", () => {
		expect(sanitizeAttributionSource("###")).toBe(ATTRIBUTION_OTHER);
		expect(sanitizeAttributionSource("😀😀")).toBe(ATTRIBUTION_OTHER);
		expect(sanitizeAttributionSource("---")).toBe(ATTRIBUTION_OTHER);
	});

	test("caps length", () => {
		const long = "x".repeat(200);
		expect(sanitizeAttributionSource(long)).toBe(
			"x".repeat(ATTRIBUTION_MAX_LENGTH),
		);
	});

	test("is IDEMPOTENT — the cap never leaves a trailing separator", () => {
		// The drill-down depends on this: the inbox re-sanitizes every `?asrc=`
		// it reads, so if sanitize(stored) !== stored the chip would filter to
		// zero orders while the picker still offered it (PR #226 review).
		// This input's 32nd character is the separator, which the length cap
		// re-exposes after the earlier trim already removed it.
		const boundary = `${"a".repeat(31)}-b`;
		const once = sanitizeAttributionSource(boundary);
		expect(once).toBe("a".repeat(31));
		expect(once?.endsWith("-")).toBe(false);

		for (const raw of [
			boundary,
			`${"b".repeat(30)}__cd`,
			"tiktok",
			"raya-promo",
			"###",
			"Raya Promo!!",
			"x".repeat(200),
		]) {
			const first = sanitizeAttributionSource(raw);
			expect(sanitizeAttributionSource(first)).toBe(first);
		}
	});

	test("never throws on hostile input", () => {
		for (const raw of [
			"<script>alert(1)</script>",
			"%0d%0aSet-Cookie",
			// Control bytes as ESCAPES, not literals: raw \x00 in the source
			// makes git classify this file as binary, and an undiffable test is
			// a permanent review blind spot (PR #226 review). Same input at runtime.
			"\u0000\u0001",
			"a".repeat(100_000),
		]) {
			expect(() => sanitizeAttributionSource(raw)).not.toThrow();
		}
	});
});

describe("attributionBucket", () => {
	test("stamped tag wins", () => {
		expect(
			attributionBucket({ source: "storefront", attributionSource: "tiktok" }),
		).toBe("tiktok");
	});

	test("counter-checkout orders derive 'counter' without a stamp", () => {
		expect(attributionBucket({ source: "counter" })).toBe("counter");
	});

	test("everything else is direct — including legacy undefined source", () => {
		expect(attributionBucket({ source: "storefront" })).toBe("direct");
		expect(attributionBucket({})).toBe("direct");
	});
});

describe("labels + presets", () => {
	test("known tags get pretty labels, free-form tags render verbatim", () => {
		expect(sourceLabel("tiktok")).toBe("TikTok");
		expect(sourceLabel("direct")).toBe("Direct / shared link");
		expect(sourceLabel("counter")).toBe("Counter");
		expect(sourceLabel("raya-promo")).toBe("raya-promo");
	});

	test("every share preset is already sanitizer-stable and labelled", () => {
		for (const p of SHARE_TAG_PRESETS) {
			expect(sanitizeAttributionSource(p.tag)).toBe(p.tag);
			expect(KNOWN_SOURCE_LABELS[p.tag]).toBe(p.label);
		}
	});

	test("every Kedaipal-emitted tag survives sanitization unchanged", () => {
		// The values our own surfaces emit (poster QRs, despatch-label QR) must
		// round-trip — a sanitizer tweak that mangles one would misfile orders.
		for (const tag of ["counter", "online", "awb", "tiktok-live"]) {
			expect(sanitizeAttributionSource(tag)).toBe(tag);
		}
	});
});
