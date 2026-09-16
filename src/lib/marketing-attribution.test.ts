// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
	captureMarketingSource,
	readMarketingReferrerStore,
	readMarketingSource,
} from "./marketing-attribution";

beforeEach(() => {
	sessionStorage.clear();
});

describe("captureMarketingSource / readMarketingSource", () => {
	it("captures ?src= and reads it back", () => {
		captureMarketingSource("?src=spotlight-thg");
		expect(readMarketingSource()).toBe("spotlight-thg");
	});

	it("falls back to utm_source when ?src= is absent", () => {
		captureMarketingSource("?utm_source=TikTok");
		expect(readMarketingSource()).toBe("tiktok");
	});

	it("an EMPTY ?src= falls through to utm_source", () => {
		// Same rule as the buyer-side capture: an authoring accident must not
		// out-rank a real signal.
		captureMarketingSource("?src=&utm_source=directory");
		expect(readMarketingSource()).toBe("directory");
	});

	it("a garbage ?src= stores as 'other' — tampering must not read as untagged", () => {
		captureMarketingSource("?src=%23%23%23");
		expect(readMarketingSource()).toBe("other");
	});

	it("a hit WITHOUT a tag keeps the stored one (in-site navigation)", () => {
		captureMarketingSource("?src=qr-poster");
		captureMarketingSource("");
		expect(readMarketingSource()).toBe("qr-poster");
	});

	it("a later hit WITH a tag overwrites (last-touch within session)", () => {
		captureMarketingSource("?src=powered-by");
		captureMarketingSource("?src=referral-mimi");
		expect(readMarketingSource()).toBe("referral-mimi");
	});

	it("uses its own key — never collides with a store's buyer-side tag", () => {
		captureMarketingSource("?src=powered-by");
		// The buyer capture for a store named "marketing-src" must stay empty.
		expect(sessionStorage.getItem("kedaipal:src:marketing-src")).toBeNull();
	});

	it("reads undefined when nothing was captured", () => {
		expect(readMarketingSource()).toBeUndefined();
	});
});

describe("the powered-by referrer store (?store=, z8r3fdcwd0)", () => {
	it("captures the referring store beside the tag", () => {
		captureMarketingSource("?src=powered-by-track&store=hermoolah");
		expect(readMarketingSource()).toBe("powered-by-track");
		expect(readMarketingReferrerStore()).toBe("hermoolah");
	});

	it("a referrer without a tag says nothing — never stored", () => {
		captureMarketingSource("?store=hermoolah");
		expect(readMarketingSource()).toBeUndefined();
		expect(readMarketingReferrerStore()).toBeUndefined();
	});

	it("a later tagged hit WITHOUT a referrer clears the stale one — the pair describes one visit", () => {
		captureMarketingSource("?src=powered-by&store=hermoolah");
		captureMarketingSource("?src=spotlight-thg");
		expect(readMarketingSource()).toBe("spotlight-thg");
		expect(readMarketingReferrerStore()).toBeUndefined();
	});

	it("an untagged hit leaves BOTH alone (in-site navigation)", () => {
		captureMarketingSource("?src=powered-by&store=hermoolah");
		captureMarketingSource("?utm_campaign=x");
		expect(readMarketingSource()).toBe("powered-by");
		expect(readMarketingReferrerStore()).toBe("hermoolah");
	});

	it("a referrer that isn't slug-shaped is dropped, not bucketed — there is no 'other' store", () => {
		captureMarketingSource("?src=powered-by&store=%3Cscript%3E");
		expect(readMarketingSource()).toBe("powered-by");
		expect(readMarketingReferrerStore()).toBeUndefined();
	});

	it("case-folds the slug the way the server does", () => {
		captureMarketingSource("?src=powered-by&store=Hermoolah");
		expect(readMarketingReferrerStore()).toBe("hermoolah");
	});

	it("uses its own key — never the buyer-side namespace", () => {
		captureMarketingSource("?src=powered-by&store=hermoolah");
		expect(sessionStorage.getItem("kedaipal:marketing-ref-store")).toBe(
			"hermoolah",
		);
		expect(sessionStorage.getItem("kedaipal:src:hermoolah")).toBeNull();
	});
});
