import { describe, expect, it } from "vitest";
import { DISPATCH_BEATS, SHIPPED_BEAT } from "./delivery";
import { HANDSHAKE_BEATS, RECEIVED_BEAT } from "./payment-handshake";
import {
	firstStepOf,
	stepAt,
	TIMELINE,
	TIMELINE_HOLDS,
} from "./seller-flow-timeline";

/**
 * One clock for three phases: the timeline is the hero inbox's two beats,
 * then every handshake beat, then every dispatch beat, flattened — so the
 * mocks' own beat tables stay the source and the walkthrough can't drift
 * from them.
 */
describe("seller-flow timeline", () => {
	it("flattens the three mocks' beat tables in phase order", () => {
		expect(TIMELINE).toHaveLength(
			2 + HANDSHAKE_BEATS.length + DISPATCH_BEATS.length,
		);
		expect(TIMELINE_HOLDS).toHaveLength(TIMELINE.length);
		expect(TIMELINE[0]).toEqual({ phase: 1, beat: 0, hold: 1200 });
		expect(TIMELINE[1]).toEqual({ phase: 1, beat: 1, hold: 3400 });
	});

	it("knows where each phase starts", () => {
		expect(firstStepOf(1)).toBe(0);
		expect(firstStepOf(2)).toBe(2);
		expect(firstStepOf(3)).toBe(2 + HANDSHAKE_BEATS.length);
	});

	it("ends phase 2 on the received beat and phase 3 on the shipped beat", () => {
		expect(stepAt(firstStepOf(3) - 1)).toEqual({
			phase: 2,
			beat: RECEIVED_BEAT,
		});
		expect(stepAt(TIMELINE.length - 1)).toEqual({
			phase: 3,
			beat: SHIPPED_BEAT,
		});
	});

	it("carries each mock's own holds", () => {
		expect(TIMELINE_HOLDS.slice(2, 2 + HANDSHAKE_BEATS.length)).toEqual([
			...HANDSHAKE_BEATS,
		]);
		expect(TIMELINE_HOLDS.slice(2 + HANDSHAKE_BEATS.length)).toEqual([
			...DISPATCH_BEATS,
		]);
	});
});
