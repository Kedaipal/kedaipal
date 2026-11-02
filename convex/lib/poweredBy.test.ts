import { describe, expect, test } from "vitest";
import { sanitizeAttributionSource } from "./attribution";
import {
	POWERED_BY_TAGS,
	poweredByHref,
	sanitizeReferrerSlug,
} from "./poweredBy";

describe("poweredByHref", () => {
	test("the storefront keeps the bare `powered-by` tag — its GA history stays continuous", () => {
		expect(poweredByHref("storefront", "hermoolah")).toBe(
			"https://kedaipal.com/?src=powered-by&store=hermoolah",
		);
	});

	test("every other surface is a suffixed tag so the funnel can tell them apart", () => {
		expect(poweredByHref("track", "hermoolah")).toBe(
			"https://kedaipal.com/?src=powered-by-track&store=hermoolah",
		);
		expect(poweredByHref("claim", "hermoolah")).toBe(
			"https://kedaipal.com/?src=powered-by-claim&store=hermoolah",
		);
		expect(poweredByHref("receipt", "hermoolah")).toBe(
			"https://kedaipal.com/?src=powered-by-receipt&store=hermoolah",
		);
	});

	test("no slug in scope (skeleton, unknown store) → tagged but unattributed", () => {
		expect(poweredByHref("track")).toBe(
			"https://kedaipal.com/?src=powered-by-track",
		);
		expect(poweredByHref("storefront", "")).toBe(
			"https://kedaipal.com/?src=powered-by",
		);
	});

	test("a slug that isn't slug-shaped is dropped, never URL-encoded into the link", () => {
		expect(poweredByHref("storefront", "Not A Slug!")).toBe(
			"https://kedaipal.com/?src=powered-by",
		);
	});

	test("every tag survives the marketing-side sanitizer unchanged", () => {
		// The landing page re-sanitizes whatever arrives in `?src=`; a tag that
		// came out different would be stamped under a name nobody documented.
		for (const tag of Object.values(POWERED_BY_TAGS)) {
			expect(sanitizeAttributionSource(tag)).toBe(tag);
		}
	});
});

describe("sanitizeReferrerSlug", () => {
	test("accepts a well-formed slug, case-folded and trimmed", () => {
		expect(sanitizeReferrerSlug("  Hermoolah ")).toBe("hermoolah");
		expect(sanitizeReferrerSlug("lekor-mr-ganu")).toBe("lekor-mr-ganu");
	});

	test("drops anything not shaped like one of our slugs — there is no 'other' store", () => {
		expect(sanitizeReferrerSlug(undefined)).toBeUndefined();
		expect(sanitizeReferrerSlug(null)).toBeUndefined();
		expect(sanitizeReferrerSlug("")).toBeUndefined();
		expect(sanitizeReferrerSlug("ab")).toBeUndefined(); // under SLUG_MIN
		expect(sanitizeReferrerSlug("a".repeat(33))).toBeUndefined(); // over SLUG_MAX
		expect(sanitizeReferrerSlug("has space")).toBeUndefined();
		expect(sanitizeReferrerSlug("double--dash")).toBeUndefined();
		expect(sanitizeReferrerSlug("-leading")).toBeUndefined();
		expect(sanitizeReferrerSlug("../etc")).toBeUndefined();
	});
});
