import { describe, expect, test } from "vitest";
import {
	assertValidShowcaseWindow,
	isShowcaseLive,
	isShowcaseTheme,
	parseShowcaseSlugParam,
	sanitizeShowcaseLabel,
	sanitizeShowcaseTagline,
	sanitizeShowcaseTitle,
	SHOWCASE_LABEL_MAX,
	SHOWCASE_TAGLINE_MAX,
	SHOWCASE_THEMES,
	SHOWCASE_TITLE_MAX,
	showcaseSlugFromTitle,
	showcaseState,
} from "./showcase";

const NOW = Date.UTC(2026, 9, 17, 4, 0, 0); // Sat 17 Oct 2026 12:00 MYT
const DAY = 24 * 60 * 60 * 1000;

describe("showcaseState — draft outranks the dates, the window is read-time", () => {
	test("unpublished is a draft whatever the window says", () => {
		expect(
			showcaseState({ startsAt: NOW - DAY, endsAt: NOW + DAY }, NOW),
		).toBe("draft");
	});
	test("published with no dates is live", () => {
		expect(showcaseState({ publishedAt: NOW - DAY }, NOW)).toBe("live");
	});
	test("published, starts in the future: scheduled", () => {
		expect(
			showcaseState({ publishedAt: NOW, startsAt: NOW + DAY }, NOW),
		).toBe("scheduled");
	});
	test("published, inside the window: live", () => {
		expect(
			showcaseState(
				{ publishedAt: NOW, startsAt: NOW - DAY, endsAt: NOW + DAY },
				NOW,
			),
		).toBe("live");
	});
	test("the end is exclusive — at the very millisecond it's over", () => {
		expect(showcaseState({ publishedAt: NOW, endsAt: NOW }, NOW)).toBe(
			"ended",
		);
		expect(showcaseState({ publishedAt: NOW, endsAt: NOW + 1 }, NOW)).toBe(
			"live",
		);
	});
	test("ended outranks scheduled on a window that is entirely in the past", () => {
		expect(
			showcaseState(
				{ publishedAt: NOW, startsAt: NOW - 2 * DAY, endsAt: NOW - DAY },
				NOW,
			),
		).toBe("ended");
	});
	test("isShowcaseLive is exactly the live state", () => {
		expect(isShowcaseLive({ publishedAt: NOW }, NOW)).toBe(true);
		expect(isShowcaseLive({}, NOW)).toBe(false);
		expect(isShowcaseLive({ publishedAt: NOW, endsAt: NOW }, NOW)).toBe(
			false,
		);
	});
});

describe("sanitizers — the saved shape, with the caps named", () => {
	test("title collapses whitespace and refuses blank or over-cap", () => {
		expect(sanitizeShowcaseTitle("  Malaysia   Campfest  2026 ")).toBe(
			"Malaysia Campfest 2026",
		);
		expect(() => sanitizeShowcaseTitle("   ")).toThrow(/title/i);
		expect(() =>
			sanitizeShowcaseTitle("x".repeat(SHOWCASE_TITLE_MAX + 1)),
		).toThrow(String(SHOWCASE_TITLE_MAX));
	});
	test("tagline and label: blank means unset, over-cap refused", () => {
		expect(sanitizeShowcaseTagline("  ")).toBeUndefined();
		expect(sanitizeShowcaseTagline(undefined)).toBeUndefined();
		expect(sanitizeShowcaseTagline(" Order ahead,  pick up ")).toBe(
			"Order ahead, pick up",
		);
		expect(() =>
			sanitizeShowcaseTagline("x".repeat(SHOWCASE_TAGLINE_MAX + 1)),
		).toThrow(String(SHOWCASE_TAGLINE_MAX));
		expect(sanitizeShowcaseLabel("")).toBeUndefined();
		expect(sanitizeShowcaseLabel(" Booth  B4 ")).toBe("Booth B4");
		expect(() =>
			sanitizeShowcaseLabel("x".repeat(SHOWCASE_LABEL_MAX + 1)),
		).toThrow(String(SHOWCASE_LABEL_MAX));
	});
	test("a window that ends before it starts is refused; open ends are fine", () => {
		expect(() =>
			assertValidShowcaseWindow({ startsAt: NOW, endsAt: NOW - 1 }),
		).toThrow(/end after it starts/);
		expect(() =>
			assertValidShowcaseWindow({ startsAt: NOW, endsAt: NOW }),
		).toThrow();
		expect(() => assertValidShowcaseWindow({ startsAt: NOW })).not.toThrow();
		expect(() => assertValidShowcaseWindow({ endsAt: NOW })).not.toThrow();
		expect(() =>
			assertValidShowcaseWindow({ startsAt: NOW, endsAt: NOW + 1 }),
		).not.toThrow();
	});
});

describe("the ?showcase= handle", () => {
	test("slug keeps the year, drops punctuation and accents", () => {
		expect(showcaseSlugFromTitle("Malaysia Campfest 2026")).toBe(
			"malaysia-campfest-2026",
		);
		expect(showcaseSlugFromTitle("Pesta Kuih — Raya '27!")).toBe(
			"pesta-kuih-raya-27",
		);
		expect(showcaseSlugFromTitle("Café Pop-up")).toBe("cafe-pop-up");
	});
	test("an all-symbol title still gets a handle", () => {
		expect(showcaseSlugFromTitle("!!!")).toBe("showcase");
	});
	test("a long title is cut without a trailing dash", () => {
		const slug = showcaseSlugFromTitle(
			"The Very Long Festival Of Everything That Fits In Sixty Chars",
		);
		expect(slug.length).toBeLessThanOrEqual(48);
		expect(slug.endsWith("-")).toBe(false);
	});
	test("parseShowcaseSlugParam accepts a slug and nothing else", () => {
		expect(parseShowcaseSlugParam("malaysia-campfest-2026")).toBe(
			"malaysia-campfest-2026",
		);
		expect(parseShowcaseSlugParam(" Malaysia-Campfest-2026 ")).toBe(
			"malaysia-campfest-2026",
		);
		expect(parseShowcaseSlugParam("-leading")).toBeUndefined();
		expect(parseShowcaseSlugParam("has space")).toBeUndefined();
		expect(parseShowcaseSlugParam("")).toBeUndefined();
		expect(parseShowcaseSlugParam(42)).toBeUndefined();
		expect(parseShowcaseSlugParam("a".repeat(49))).toBeUndefined();
	});
});

describe("themes", () => {
	test("the set is closed and every member passes the guard", () => {
		for (const theme of SHOWCASE_THEMES) expect(isShowcaseTheme(theme)).toBe(true);
		expect(isShowcaseTheme("rainbow")).toBe(false);
		expect(isShowcaseTheme(undefined)).toBe(false);
	});
});
