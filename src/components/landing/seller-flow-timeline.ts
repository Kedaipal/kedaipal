import { DISPATCH_BEATS } from "./delivery";
import { PAYNOW_BEATS } from "./pay-now";
import { HANDSHAKE_BEATS } from "./payment-handshake";

/**
 * The seller-flow walkthrough's clock (z8r3fdtpub T3): ONE timeline for
 * four phases, so a reader can click a step and the auto-advance resumes
 * from there. Each step names the phase and the beat the phase's mock
 * should show, and how long to hold it.
 *
 * The holds are the mocks' own beat tables, flattened — `PAYNOW_BEATS`,
 * `HANDSHAKE_BEATS` and `DISPATCH_BEATS` stay the source of truth for their stories, so the
 * walkthrough cannot drift from the mocks it plays. Phase 01 has two beats
 * of its own: the inbox at rest, then the order landing (`AfterPhone` beat
 * 1); its later beats (paid, shipped, the flash sale) are phases 02–04's
 * job here, and the hero stage keeps them.
 */

export type FlowPhase = 1 | 2 | 3 | 4;

export interface FlowStep {
	phase: FlowPhase;
	/** The beat passed to that phase's mock. */
	beat: number;
	/** How long the step holds, ms. */
	hold: number;
}

const PHASE_1_HOLDS = [1200, 3400] as const;

function steps(phase: FlowPhase, holds: readonly number[]): FlowStep[] {
	return holds.map((hold, beat) => ({ phase, beat, hold }));
}

export const TIMELINE: readonly FlowStep[] = [
	...steps(1, PHASE_1_HOLDS),
	...steps(2, PAYNOW_BEATS),
	...steps(3, HANDSHAKE_BEATS),
	...steps(4, DISPATCH_BEATS),
];

/** The holds alone, in the shape `useTimeline` takes. */
export const TIMELINE_HOLDS: readonly number[] = TIMELINE.map((s) => s.hold);

/** The index of a phase's first step — where a click on that step jumps. */
export function firstStepOf(phase: FlowPhase): number {
	return TIMELINE.findIndex((s) => s.phase === phase);
}

/** The last step index of a phase — the reduced-motion still. */
export function lastStepOf(phase: FlowPhase): number {
	return (
		TIMELINE.length -
		1 -
		[...TIMELINE].reverse().findIndex((s) => s.phase === phase)
	);
}

/** The phase and beat at a timeline index (clamped). */
export function stepAt(index: number): { phase: FlowPhase; beat: number } {
	const step = TIMELINE[Math.max(0, Math.min(index, TIMELINE.length - 1))];
	return { phase: step.phase, beat: step.beat };
}
