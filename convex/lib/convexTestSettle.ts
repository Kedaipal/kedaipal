// Test-only helper (imported by *.test.ts; no runtime caller). Structural
// type, so this module never imports convex-test into the deployed bundle.

/**
 * Let a convex-test instance's scheduled work run to completion.
 *
 * Why it exists (z8r3fdv55f): convex-test decides whether an action's
 * `ctx.runQuery`/write is "nested" from GLOBAL state — so a scheduled action
 * (every order and booking request schedules the seller-alert email +
 * WhatsApp) that fires while a test mutation is mid-transaction skips the lock,
 * restarts the transaction on the shared fake DB, and silently discards that
 * mutation's writes. A seeded `bookingBlocks` row read back as `null` straight
 * after `blockDays` returned. Real Convex serializes transactions; this is a
 * harness hazard only. Same family as the proof-required cap seed
 * (z8r3fdnpxf).
 *
 * `finishInProgressScheduledFunctions` alone is not enough: a `runAfter(0)`
 * job is not "in progress" until its timer fires, so yield a macrotask first,
 * and repeat because an action can schedule a follow-up (the email fallback).
 */
export async function settleScheduled(t: {
	finishInProgressScheduledFunctions(): Promise<void>;
}): Promise<void> {
	for (let round = 0; round < 3; round++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await t.finishInProgressScheduledFunctions();
	}
}
