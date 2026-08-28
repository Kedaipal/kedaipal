// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	readAttributionSource,
	useCaptureAttribution,
} from "./useSourceAttribution";

function Capture({ slug }: { slug: string | undefined }) {
	useCaptureAttribution(slug);
	return null;
}

function setSearch(search: string) {
	window.history.replaceState(null, "", `/teststore${search}`);
}

beforeEach(() => {
	sessionStorage.clear();
	setSearch("");
});
afterEach(cleanup);

describe("useCaptureAttribution / readAttributionSource", () => {
	it("captures ?src= for the store and reads it back", () => {
		setSearch("?src=tiktok");
		render(<Capture slug="teststore" />);
		expect(readAttributionSource("teststore")).toBe("tiktok");
	});

	it("falls back to utm_source when ?src= is absent", () => {
		setSearch("?utm_source=Instagram");
		render(<Capture slug="teststore" />);
		expect(readAttributionSource("teststore")).toBe("instagram");
	});

	it("an EMPTY ?src= falls through to utm_source", () => {
		// An accident must not out-rank a real signal (PR #226 review).
		setSearch("?src=&utm_source=tiktok");
		render(<Capture slug="teststore" />);
		expect(readAttributionSource("teststore")).toBe("tiktok");
	});

	it("a garbage ?src= still wins over utm_source", () => {
		// Unusable, but genuinely a signal — so it buckets to "other" rather
		// than silently crediting the fallback param.
		setSearch("?src=%23%23%23&utm_source=tiktok");
		render(<Capture slug="teststore" />);
		expect(readAttributionSource("teststore")).toBe("other");
	});

	it("?src= wins over utm_source when both arrive", () => {
		setSearch("?utm_source=instagram&src=tiktok");
		render(<Capture slug="teststore" />);
		expect(readAttributionSource("teststore")).toBe("tiktok");
	});

	it("a hit WITHOUT a tag keeps the stored one (in-store navigation)", () => {
		setSearch("?src=tiktok");
		render(<Capture slug="teststore" />);
		cleanup();
		setSearch("");
		render(<Capture slug="teststore" />);
		expect(readAttributionSource("teststore")).toBe("tiktok");
	});

	it("a later hit WITH a tag overwrites (last-touch within session)", () => {
		setSearch("?src=tiktok");
		render(<Capture slug="teststore" />);
		cleanup();
		setSearch("?src=instagram");
		render(<Capture slug="teststore" />);
		expect(readAttributionSource("teststore")).toBe("instagram");
	});

	it("keys per store — two shops in one tab can't cross-attribute", () => {
		setSearch("?src=tiktok");
		render(<Capture slug="store-a" />);
		expect(readAttributionSource("store-a")).toBe("tiktok");
		expect(readAttributionSource("store-b")).toBeUndefined();
	});

	it("garbage tag is stored as 'other'; empty ?src= is ignored", () => {
		setSearch("?src=%23%23%23");
		render(<Capture slug="teststore" />);
		expect(readAttributionSource("teststore")).toBe("other");
		cleanup();
		sessionStorage.clear();
		setSearch("?src=");
		render(<Capture slug="teststore" />);
		expect(readAttributionSource("teststore")).toBeUndefined();
	});

	it("no slug yet (loader still resolving) → captures nothing, no throw", () => {
		setSearch("?src=tiktok");
		render(<Capture slug={undefined} />);
		expect(sessionStorage.length).toBe(0);
	});
});
