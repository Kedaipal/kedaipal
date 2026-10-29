import { describe, expect, test } from "vitest";
import {
	draftFromLane,
	laneBlockCopy,
	laneFromDraft,
	overseasOf,
} from "./overseas-delivery";

// The overseas price form (z8r3fdr5yy): every mistake an inline sentence,
// every saved lane a draft that round-trips.

describe("draft ⇄ lane", () => {
	test("flat round-trips, threshold included", () => {
		const lane = {
			country: "SG" as const,
			pricing: { kind: "flat" as const, fee: 2500, freeAbove: 30000 },
		};
		const back = laneFromDraft(draftFromLane(lane), "SG");
		expect(back).toEqual({ ok: true, lane });
	});

	test("weight round-trips, bands sorted", () => {
		const lane = {
			country: "SG" as const,
			pricing: {
				kind: "weight" as const,
				bands: [
					{ maxKg: 1, fee: 1800 },
					{ maxKg: 3, fee: 3200 },
				],
				freeAbove: undefined,
			},
		};
		expect(laneFromDraft(draftFromLane(lane), "SG")).toEqual({
			ok: true,
			lane,
		});
	});

	test("a saved free lane comes back already acknowledged", () => {
		const draft = draftFromLane({ country: "SG", pricing: { kind: "free" } });
		expect(draft.freeAcknowledged).toBe(true);
	});
});

describe("what to fix, in a sentence", () => {
	test("free needs the seller to say they'll pay the courier", () => {
		const draft = { ...draftFromLane(undefined), kind: "free" as const };
		const result = laneFromDraft(draft, "SG");
		expect(result.ok).toBe(false);
		expect(!result.ok && result.error).toMatch(/pay the courier/);
	});

	test("a blank flat fee points at Free instead of saving zero", () => {
		const result = laneFromDraft(draftFromLane(undefined), "SG");
		expect(!result.ok && result.error).toMatch(/choose Free/);
	});

	test("a weight band without a fee names the band", () => {
		const draft = {
			...draftFromLane(undefined),
			kind: "weight" as const,
			bands: [{ maxKg: "2", fee: "" }],
		};
		expect(laneFromDraft(draft, "SG")).toEqual({
			ok: false,
			error: "Enter a fee for the up-to-2 kg band (0 makes it free).",
		});
	});
});

describe("the switch's reasons", () => {
	test("live pricing names both countries and the way out", () => {
		expect(laneBlockCopy("live_pricing", "MY", "SG")).toMatch(
			/only deliver within Malaysia.*own delivery price to deliver to Singapore/,
		);
	});
});

describe("the product form's overseas question", () => {
	test("asked only when a lane is saved", () => {
		expect(overseasOf({ country: "MY" })).toBeUndefined();
		expect(
			overseasOf({
				country: "MY",
				crossBorderLanes: [{ country: "SG", pricing: { kind: "free" } }],
			}),
		).toEqual({ destination: "SG", storeCountry: "MY" });
	});
});
