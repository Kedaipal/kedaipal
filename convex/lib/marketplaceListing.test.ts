import { describe, expect, test } from "vitest";
import {
	collapseStoreArea,
	compHighlightEligible,
	highlightSource,
	isInternalStore,
	isListableRow,
	isNewStore,
	NEW_STORE_WINDOW_MS,
	sanitizeStoreArea,
	sponsorshipActive,
	STORE_AREA_MAX,
} from "./marketplaceListing";

describe("sanitizeStoreArea", () => {
	test("trims and collapses inner whitespace to one line", () => {
		expect(sanitizeStoreArea("  Ampang,   KL \n")).toBe("Ampang, KL");
		expect(sanitizeStoreArea("Ampang,\nKL")).toBe("Ampang, KL");
	});

	test("collapseStoreArea is exactly the stored shape (the form compares with it)", () => {
		expect(collapseStoreArea("  Ampang,   KL ")).toBe("Ampang, KL");
		expect(sanitizeStoreArea("  Ampang,   KL ")).toBe(
			collapseStoreArea("  Ampang,   KL "),
		);
		expect(collapseStoreArea("   ")).toBe("");
	});

	test("blank clears (undefined), never an empty string", () => {
		expect(sanitizeStoreArea("")).toBeUndefined();
		expect(sanitizeStoreArea("   \n ")).toBeUndefined();
	});

	test("refuses over-cap input, accepts exactly the cap", () => {
		expect(() => sanitizeStoreArea("x".repeat(STORE_AREA_MAX + 1))).toThrow(
			/exceeds/,
		);
		expect(sanitizeStoreArea("x".repeat(STORE_AREA_MAX))).toHaveLength(
			STORE_AREA_MAX,
		);
	});
});

describe("isListableRow — every clause bites", () => {
	// One assertion per clause: delete a guard in isListableRow and the
	// matching test goes red (mutation-test posture).
	const base = { internal: false };
	test("a plain row is listed by default", () => {
		expect(isListableRow(base)).toBe(true);
	});

	test("an internal store is never listed", () => {
		expect(isListableRow({ internal: true })).toBe(false);
	});

	test("an opt-out stamp delists, whatever its age", () => {
		expect(isListableRow({ ...base, marketplaceUnlistedAt: 1 })).toBe(false);
		expect(isListableRow({ ...base, marketplaceUnlistedAt: Date.now() })).toBe(
			false,
		);
	});

	test("a purging store is never listed", () => {
		expect(isListableRow({ ...base, purgeStartedAt: Date.now() })).toBe(false);
	});
});

describe("isInternalStore", () => {
	test("the report's exclusion OR an internal comp", () => {
		expect(isInternalStore(true, undefined)).toBe(true);
		expect(isInternalStore(false, "internal")).toBe(true);
		expect(isInternalStore(false, "partner")).toBe(false);
		expect(isInternalStore(false, undefined)).toBe(false);
	});
});

describe("highlightSource — paid window, comp, or nothing", () => {
	const now = 1_700_000_000_000;
	test("a live paid window, comped or not", () => {
		expect(
			highlightSource({ sponsoredUntil: now + 1, comped: false }, now),
		).toBe("paid");
		expect(
			highlightSource(
				{ sponsoredUntil: now + 1, comped: true, compKind: "partner" },
				now,
			),
		).toBe("paid");
	});

	test("partner / sponsor / pilot comps are featured automatically", () => {
		for (const kind of ["partner", "sponsor", "pilot"]) {
			expect(highlightSource({ comped: true, compKind: kind }, now)).toBe(
				"comp",
			);
		}
	});

	test("an internal comp, a stampless legacy comp and a non-comp are not", () => {
		expect(highlightSource({ comped: true, compKind: "internal" }, now)).toBe(
			null,
		);
		expect(highlightSource({ comped: true }, now)).toBe(null);
		expect(highlightSource({ comped: false, compKind: "partner" }, now)).toBe(
			null,
		);
	});

	test("the admin's off switch keeps a comped store off; a paid window still wins", () => {
		const off = { comped: true, compKind: "sponsor", compHighlightOffAt: 1 };
		expect(highlightSource(off, now)).toBe(null);
		expect(highlightSource({ ...off, sponsoredUntil: now + 1 }, now)).toBe(
			"paid",
		);
	});

	test("an expired window falls back to the comp, or to nothing", () => {
		expect(
			highlightSource(
				{ sponsoredUntil: now - 1, comped: true, compKind: "pilot" },
				now,
			),
		).toBe("comp");
		expect(highlightSource({ sponsoredUntil: now - 1, comped: false }, now)).toBe(
			null,
		);
	});

	test("compHighlightEligible matches the comp half of the rule", () => {
		expect(compHighlightEligible(true, "sponsor")).toBe(true);
		expect(compHighlightEligible(true, "internal")).toBe(false);
		expect(compHighlightEligible(false, "sponsor")).toBe(false);
	});
});

describe("isNewStore", () => {
	test("inside the window is new, past it is not", () => {
		const now = 1_700_000_000_000;
		expect(isNewStore(now - NEW_STORE_WINDOW_MS, now)).toBe(true);
		expect(isNewStore(now - NEW_STORE_WINDOW_MS - 1, now)).toBe(false);
	});
});

describe("sponsorshipActive", () => {
	test("future window is live, past or absent is not", () => {
		const now = 1_700_000_000_000;
		expect(sponsorshipActive(now + 1, now)).toBe(true);
		expect(sponsorshipActive(now, now)).toBe(false);
		expect(sponsorshipActive(now - 1, now)).toBe(false);
		expect(sponsorshipActive(undefined, now)).toBe(false);
	});
});
