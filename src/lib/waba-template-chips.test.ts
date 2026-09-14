import { describe, expect, test } from "vitest";
import {
	categoryChip,
	categoryTone,
	qualityTone,
	statusTone,
	TONE_CLASS,
} from "./waba-template-chips";

describe("statusTone", () => {
	test("APPROVED is the only green", () => {
		expect(statusTone("APPROVED")).toBe("ok");
	});

	test.each(["PAUSED", "DISABLED", "REJECTED", "PENDING_DELETION", "FLAGGED"])(
		"%s is red — every send naming the template fails",
		(status) => {
			expect(statusTone(status)).toBe("bad");
		},
	);

	test("an in-flight status is amber, not green or red", () => {
		expect(statusTone("PENDING")).toBe("warn");
		expect(statusTone("IN_APPEAL")).toBe("warn");
	});

	test("no event yet is muted, never a claim either way", () => {
		expect(statusTone(undefined)).toBe("muted");
	});
});

describe("categoryTone — the 6.1× question", () => {
	test.each(["UTILITY", "AUTHENTICATION", "SERVICE"])(
		"%s is low-rate, so green",
		(category) => {
			expect(categoryTone(category)).toBe("ok");
		},
	);

	test("MARKETING is red", () => {
		expect(categoryTone("MARKETING")).toBe("bad");
	});

	test("an unrecognised category is treated as expensive, not as fine", () => {
		// Fail loud: a category we don't know is not a category we can price.
		expect(categoryTone("SOMETHING_NEW")).toBe("bad");
	});
});

describe("qualityTone", () => {
	test("GREEN ok, YELLOW warn, RED bad, unknown muted", () => {
		expect(qualityTone("GREEN")).toBe("ok");
		expect(qualityTone("YELLOW")).toBe("warn");
		expect(qualityTone("RED")).toBe("bad");
		expect(qualityTone(undefined)).toBe("muted");
		expect(qualityTone("WHAT")).toBe("muted");
	});
});

describe("categoryChip — Meta never announces the approved category", () => {
	test("a configured template with no category event reads UTILITY (assumed)", () => {
		// The normal, healthy case: Meta posts a category event only on CHANGE,
		// so without this the panel's headline column is blank for ever.
		expect(categoryChip(undefined, true)).toEqual({
			value: "UTILITY (assumed)",
			tone: "muted",
		});
	});

	test("assumed is muted, not green — we were told nothing", () => {
		expect(categoryChip(undefined, true).tone).not.toBe("ok");
	});

	test("a template we do NOT configure gets no benefit of the doubt", () => {
		expect(categoryChip(undefined, false)).toEqual({
			value: "unknown",
			tone: "muted",
		});
	});

	test("a real category event always beats the assumption, both ways", () => {
		expect(categoryChip("MARKETING", true)).toEqual({
			value: "MARKETING",
			tone: "bad",
		});
		expect(categoryChip("UTILITY", true)).toEqual({
			value: "UTILITY",
			tone: "ok",
		});
		// Even for a template we don't configure.
		expect(categoryChip("MARKETING", false).tone).toBe("bad");
	});
});

describe("TONE_CLASS", () => {
	test("every tone has a class, and each carries a dark variant", () => {
		for (const tone of ["ok", "warn", "bad", "muted"] as const) {
			expect(TONE_CLASS[tone]).toBeTruthy();
		}
		// muted rides semantic tokens (already theme-aware); the three coloured
		// tones are raw palette and must declare their dark counterpart, or the
		// panel is unreadable once the dark-mode toggle lands.
		for (const tone of ["ok", "warn", "bad"] as const) {
			expect(TONE_CLASS[tone]).toMatch(/dark:/);
		}
	});
});
