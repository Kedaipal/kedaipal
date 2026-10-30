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
	test("an EasyParcel-priced lane round-trips, threshold included", () => {
		const lane = {
			country: "SG" as const,
			pricing: { kind: "live" as const, freeAbove: 30000 },
		};
		expect(laneFromDraft(draftFromLane(lane), "SG")).toEqual({
			ok: true,
			lane,
		});
	});

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
	test("an EasyParcel-priced lane says what EasyParcel is missing, and that it comes back by itself", () => {
		expect(laneBlockCopy("courier_unavailable", "SG", "not_connected")).toMatch(
			/priced live by EasyParcel, and EasyParcel isn't connected yet.*once EasyParcel can quote/,
		);
		expect(
			laneBlockCopy("courier_unavailable", "SG", "no_sender_phone"),
		).toMatch(/no WhatsApp number/);
		expect(
			laneBlockCopy("courier_unavailable", "MY", "wrong_currency"),
		).toMatch(/another currency/);
	});

	test("delivery off reads right whether the lane is on or off — no 'first'", () => {
		const copy = laneBlockCopy("delivery_off", "MY");
		expect(copy).toMatch(/Turn delivery on to deliver there\.$/);
		expect(copy).not.toMatch(/first/);
	});

	test("a new lane waiting on products says it's almost on", () => {
		expect(laneBlockCopy("awaiting_products", "SG")).toMatch(
			/^Almost on — choose which products can go to Singapore/,
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
