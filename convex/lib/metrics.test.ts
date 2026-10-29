import { describe, expect, test } from "vitest";
import {
	ACQUISITION_CHANNELS,
	ACQUISITION_NOTE_MAX,
	CASH_SPEND_MAX_SEN,
	CHANNEL_COPY,
	cacSen,
	channelCostSen,
	channelLabel,
	FOUNDER_HOURLY_RATE_SEN,
	FOUNDER_HOURS_MAX,
	isAcquisitionChannel,
	normalizeAcquisitionNote,
	spendEntryProblem,
	suggestChannel,
} from "./metrics";

describe("acquisition channels", () => {
	test("is a closed set that rejects anything outside it", () => {
		for (const c of ACQUISITION_CHANNELS) expect(isAcquisitionChannel(c)).toBe(true);
		expect(isAcquisitionChannel("tiktok")).toBe(false);
		expect(isAcquisitionChannel("Walk_In")).toBe(false);
		expect(isAcquisitionChannel("")).toBe(false);
		expect(isAcquisitionChannel(undefined)).toBe(false);
	});

	test("every channel has admin copy", () => {
		for (const c of ACQUISITION_CHANNELS) {
			expect(CHANNEL_COPY[c].label.length).toBeGreaterThan(0);
			expect(CHANNEL_COPY[c].hint.length).toBeGreaterThan(0);
		}
	});

	test("a retired channel still renders as its raw value", () => {
		expect(channelLabel("walk_in")).toBe("Walk-in");
		expect(channelLabel("billboard")).toBe("billboard");
	});
});

describe("suggestChannel", () => {
	test("a referrals row wins over any link tag", () => {
		expect(
			suggestChannel({ signupSource: "tiktok-live", hasReferral: true }),
		).toBe("referral");
	});

	test.each([
		["referral-bearcamp", "referral"],
		["powered-by", "product_led"],
		["powered-by-track", "product_led"],
		["directory", "product_led"],
		["qr-poster", "product_led"],
		["spotlight-thg", "talk_event"],
		["tiktok-live", "inbound_social"],
		["instagram", "inbound_social"],
		["ig", "inbound_social"],
		["google", "inbound_search"],
		["Spotlight-THG", "talk_event"],
	] as const)("tag %s suggests %s", (signupSource, expected) => {
		expect(suggestChannel({ signupSource, hasReferral: false })).toBe(expected);
	});

	test("no tag, or a tag we can't read, suggests nothing", () => {
		expect(suggestChannel({ hasReferral: false })).toBeNull();
		expect(suggestChannel({ signupSource: "  ", hasReferral: false })).toBeNull();
		expect(suggestChannel({ signupSource: "other", hasReferral: false })).toBeNull();
	});
});

describe("normalizeAcquisitionNote", () => {
	test("trims, and treats blank as absent", () => {
		expect(normalizeAcquisitionNote("  Great Day Club talk ")).toBe(
			"Great Day Club talk",
		);
		expect(normalizeAcquisitionNote("   ")).toBeUndefined();
		expect(normalizeAcquisitionNote(undefined)).toBeUndefined();
	});

	test("refuses a note past the cap rather than cutting it", () => {
		expect(() =>
			normalizeAcquisitionNote("x".repeat(ACQUISITION_NOTE_MAX + 1)),
		).toThrow(/140 characters/);
		expect(normalizeAcquisitionNote("x".repeat(ACQUISITION_NOTE_MAX))).toHaveLength(
			ACQUISITION_NOTE_MAX,
		);
	});
});

describe("spendEntryProblem", () => {
	test("accepts whole-sen cash and fractional hours", () => {
		expect(spendEntryProblem({ cashSpend: 12_000, founderHours: 1.5 })).toBeNull();
		expect(spendEntryProblem({ cashSpend: 0 })).toBeNull();
	});

	test.each([
		[{ cashSpend: -1 }, /positive/],
		[{ cashSpend: 10.5 }, /positive/],
		[{ cashSpend: CASH_SPEND_MAX_SEN + 1 }, /too large/],
		[{ cashSpend: 0, founderHours: -2 }, /negative/],
		[{ cashSpend: 0, founderHours: Number.NaN }, /negative/],
		[{ cashSpend: 0, founderHours: FOUNDER_HOURS_MAX + 1 }, /exceed/],
	])("refuses %o", (entry, message) => {
		expect(spendEntryProblem(entry)).toMatch(message);
	});
});

describe("cost and CAC", () => {
	test("founder hours are costed at RM50 an hour", () => {
		expect(FOUNDER_HOURLY_RATE_SEN).toBe(5000);
		expect(channelCostSen({ cashSpend: 30_000, founderHours: 10 })).toBe(80_000);
		expect(channelCostSen({ cashSpend: 30_000 })).toBe(30_000);
	});

	test("CAC divides cost by new paying stores", () => {
		expect(cacSen(80_000, 2)).toBe(40_000);
		expect(cacSen(10_000, 3)).toBe(3333);
	});

	test("no paying store is null, never zero", () => {
		expect(cacSen(80_000, 0)).toBeNull();
		expect(cacSen(0, 0)).toBeNull();
	});
});
