import { describe, expect, test } from "vitest";
import {
	appSectionFor,
	DISPLAY_PATH_MAX,
	displayPath,
	missOwnedElsewhere,
	NOT_FOUND_TITLE,
	notFoundContext,
	notFoundHeadMeta,
	rendersNotFound,
} from "./not-found";

describe("notFoundContext", () => {
	test("anything under /app is the dashboard", () => {
		expect(notFoundContext("/app/nope")).toBe("app");
		expect(notFoundContext("/app/orders/old/link")).toBe("app");
		expect(notFoundContext("/app")).toBe("app");
	});

	test("a single public segment is the shape of a store link", () => {
		expect(notFoundContext("/kek-sayang-bakeri")).toBe("store");
		expect(notFoundContext("/kek-sayang-bakeri/")).toBe("store");
	});

	test("everything else is the marketing site", () => {
		expect(notFoundContext("/foo/bar")).toBe("site");
		expect(notFoundContext("/blog/2026/10/some-post")).toBe("site");
		// `/apps/...` is not `/app/...` — the segment is compared whole.
		expect(notFoundContext("/apps/thing")).toBe("site");
		expect(notFoundContext("/")).toBe("site");
	});

	test("a query or hash never changes the answer", () => {
		expect(notFoundContext("/kek?utm_source=wa")).toBe("store");
		expect(notFoundContext("/app/x#top")).toBe("app");
	});
});

describe("appSectionFor", () => {
	test("names the dashboard section a dead link was reaching for", () => {
		expect(appSectionFor("/app/orders/old/link")).toEqual({
			label: "Orders",
			to: "/app/orders",
		});
		// The Counter lives at /app/checkout — the label is the sidebar's word.
		expect(appSectionFor("/app/checkout/x")).toEqual({
			label: "Counter",
			to: "/app/checkout",
		});
	});

	test("offers nothing when the first segment names no section", () => {
		expect(appSectionFor("/app/nonsense")).toBeNull();
		expect(appSectionFor("/app")).toBeNull();
		expect(appSectionFor("/foo/orders")).toBeNull();
	});

	test("never hands a seller an admin door", () => {
		expect(appSectionFor("/app/admin/whatever")).toBeNull();
	});

	test("an Object.prototype key is not a section", () => {
		expect(appSectionFor("/app/constructor/x")).toBeNull();
		expect(appSectionFor("/app/__proto__/x")).toBeNull();
	});
});

describe("displayPath", () => {
	test("decodes percent-escapes so the typo reads as typed", () => {
		expect(displayPath("/kedai%20sayang")).toBe("/kedai sayang");
	});

	test("a malformed escape is shown raw, never thrown", () => {
		expect(displayPath("/bad%E0%A4%A")).toBe("/bad%E0%A4%A");
	});

	test("a long path is cut with an ellipsis at the cap", () => {
		const long = `/${"a".repeat(200)}`;
		const shown = displayPath(long);
		expect(shown).toHaveLength(DISPLAY_PATH_MAX);
		expect(shown.endsWith("…")).toBe(true);
		expect(displayPath("/short")).toBe("/short");
	});
});

describe("head helpers", () => {
	test("rendersNotFound: a global miss under this layout, or its own notFound()", () => {
		expect(rendersNotFound({ globalNotFound: true, status: "success" })).toBe(
			true,
		);
		expect(rendersNotFound({ status: "notFound" })).toBe(true);
		expect(rendersNotFound({ status: "success" })).toBe(false);
	});

	test("missOwnedElsewhere: matched only on the way to an ancestor's miss", () => {
		const root = { globalNotFound: true };
		const slug = { status: "notFound" };
		expect(missOwnedElsewhere([root, slug], slug)).toBe(true);
		// The boundary itself owns the miss.
		expect(missOwnedElsewhere([root, slug], root)).toBe(false);
		// No global miss at all: a store's own notFound() is its own.
		expect(missOwnedElsewhere([{}, slug], slug)).toBe(false);
	});

	test("notFoundHeadMeta titles the tab and keeps it out of search", () => {
		expect(notFoundHeadMeta("store")).toEqual([
			{ title: NOT_FOUND_TITLE.store },
			{ name: "robots", content: "noindex, follow" },
		]);
		expect(NOT_FOUND_TITLE.site).toBe("Page not found — Kedaipal");
	});
});
