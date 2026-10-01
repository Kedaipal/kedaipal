import { describe, expect, test } from "vitest";
import {
	type BulkVocab,
	buildBulkTargets,
	MIXED_KINDS_NOTE,
	NO_SUCH_STEP_REASON,
} from "./inbox-bulk-targets";
import { type OrderStage, resolveStages } from "./orderStatus";

const vocab = (kind: BulkVocab["kind"], bookingPackaged?: boolean): BulkVocab => ({
	kind,
	stages: resolveStages({ deliveryMethod: kind, bookingPackaged }),
});

const CAKE: OrderStage[] = [
	{ id: "c1", anchor: "confirmed", label: { en: "Order in" }, sortOrder: 0 },
	{ id: "c2", anchor: "packed", label: { en: "Baking" }, sortOrder: 1 },
	{ id: "c3", anchor: "delivered", label: { en: "Collected" }, sortOrder: 2 },
];

const labels = (v: BulkVocab[], fallback: OrderStage[] = []) =>
	buildBulkTargets(v, fallback).targets.map((t) => t.label);

describe("buildBulkTargets — the menu speaks the selection", () => {
	test("one kind selected → that kind's own words", () => {
		// The reported bug: selecting a campsite booking offered "Ready for
		// Pickup" and "Collected", because the menu read the STORE's flow.
		expect(labels([vocab("booking")])).toEqual([
			"Confirmed",
			"In production",
			"Checked In",
			"Checked Out",
		]);
		expect(labels([vocab("self_collect")])).toEqual([
			"Confirmed",
			"Packed",
			"Ready for Pickup",
			"Collected",
		]);
	});

	test("a milestone the selection has no step for is DISABLED with a reason", () => {
		const { targets } = buildBulkTargets([vocab("booking")], []);
		const packed = targets.find((t) => t.anchor === "packed");
		// A booking's default pipeline skips `packed`, so the action would skip
		// every selected row — say so instead of offering it.
		expect(packed?.disabled).toBe(true);
		expect(packed?.reason).toBe(NO_SUCH_STEP_REASON);
		// The ones it CAN reach stay live.
		expect(targets.find((t) => t.anchor === "shipped")?.disabled).toBe(false);
	});

	test("an event RSVP disables both middle milestones", () => {
		const { targets } = buildBulkTargets([vocab("event")], []);
		expect(
			targets.filter((t) => t.disabled).map((t) => t.anchor),
		).toEqual(["packed", "shipped"]);
	});

	test("kinds that AGREE keep the seller's familiar word, with no note", () => {
		// delivery + pickup share Confirmed/Packed and differ only at the last
		// two, so only those two fall back.
		const { targets, note } = buildBulkTargets(
			[vocab("delivery"), vocab("self_collect")],
			[],
		);
		expect(targets.map((t) => t.label)).toEqual([
			"Confirmed",
			"Packed",
			"Ready",
			"Done",
		]);
		expect(note).toBe(MIXED_KINDS_NOTE);
	});

	test("kinds that agree on EVERY milestone produce no note at all", () => {
		const same: BulkVocab = { kind: "delivery", stages: CAKE };
		const twin: BulkVocab = { kind: "self_collect", stages: CAKE };
		const { targets, note } = buildBulkTargets([same, twin], []);
		expect(targets.map((t) => t.label)).toEqual([
			"Order in",
			"Baking",
			"Ready",
			"Collected",
		]);
		// `shipped` is absent from BOTH, so it is disabled — but agreeing that a
		// milestone is unreachable is not a disagreement about WORDS, so no note.
		expect(targets.find((t) => t.anchor === "shipped")?.disabled).toBe(true);
		expect(note).toBeUndefined();
	});

	test("a SINGLE kind never gets the mixed-kinds note, disabled rows or not", () => {
		// Seen by rendering it: a lone booking showed "Your selection mixes
		// kinds of order" above four rows describing one kind, because the
		// unreachable `packed` row was being counted as mixing.
		const { targets, note } = buildBulkTargets([vocab("booking")], []);
		expect(targets.some((t) => t.disabled)).toBe(true);
		expect(note).toBeUndefined();
	});

	test("a stay and a PACKAGE are different vocabularies", () => {
		// Active/Ended vs Checked in/out — same kind, different words, so the
		// menu must not pick one of them arbitrarily.
		const { targets } = buildBulkTargets(
			[vocab("booking"), vocab("booking", true)],
			[],
		);
		expect(targets.find((t) => t.anchor === "shipped")?.label).toBe("Ready");
		expect(targets.find((t) => t.anchor === "delivered")?.label).toBe("Done");
	});

	test("nothing selected → the store's own words, nothing disabled", () => {
		const { targets, note } = buildBulkTargets([], CAKE);
		expect(targets.map((t) => t.label)).toEqual([
			"Order in",
			"Baking",
			"Ready",
			"Collected",
		]);
		expect(targets.some((t) => t.disabled)).toBe(false);
		expect(note).toBeUndefined();
	});
});
