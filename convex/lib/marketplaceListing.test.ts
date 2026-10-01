import { describe, expect, test } from "vitest";
import {
	collapseStoreArea,
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
	test("a plain row is listed by default", () => {
		expect(isListableRow({})).toBe(true);
	});

	test("an opt-out stamp delists, whatever its age", () => {
		expect(isListableRow({ marketplaceUnlistedAt: 1 })).toBe(false);
		expect(isListableRow({ marketplaceUnlistedAt: Date.now() })).toBe(false);
	});

	test("a purging store is never listed", () => {
		expect(isListableRow({ purgeStartedAt: Date.now() })).toBe(false);
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
