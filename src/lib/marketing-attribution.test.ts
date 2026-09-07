// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
	captureMarketingSource,
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
