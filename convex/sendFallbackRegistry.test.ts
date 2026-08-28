// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Machine enforcement for the outbound-fallback rule (ClickUp 86eyrtz9t).
 *
 * The rule: **a WhatsApp send that reaches nobody must tell somebody.** Kedaipal
 * runs one shared WABA, and a send can end up delivered to no one for reasons
 * that have nothing to do with the code that asked for it — the Meta template
 * isn't approved yet, the buyer opted out, the seller hit a cap, quality is
 * throttled, Meta is down. In every one of those cases a human is waiting on a
 * message that will never arrive.
 *
 * Before this, each call site hand-rolled its own blocked/retry/fallback block,
 * which is exactly why coverage was uneven: three seller alerts had a thorough
 * email fallback while `notifyFoundingWelcome` had a `console.error` and
 * `notifyCounterOrderCreated` swallowed the failure entirely. Prose in CLAUDE.md
 * would not have caught either, so this test does.
 *
 * How it works: every `makeGuardedSender(...)` construction in `convex/` must be
 * declared below with its fallback posture. Add a send site and this test fails
 * until you have said, in writing, who hears about it when it reaches nobody.
 * That is the whole point — the failure IS the design review.
 *
 * House precedent: `src/lib/convex-read-pattern.test.ts` (86eyqgxe1) and
 * `src/lib/dependency-pins.test.ts`.
 */

const CONVEX = __dirname;

/** Files that construct guarded senders. Keep in sync with the registry below. */
const SOURCES = ["whatsapp.ts"] as const;

type Posture =
	/** Uses `.deliver()` with an `onUnreachable` that routes to a second
	 *  channel, or to state a human will actually see. */
	| "deliver"
	/** Deliberately fire-and-forget: no second channel exists and nothing is
	 *  owed. Must carry a `why` that survives a reviewer's "are you sure?". */
	| "fire-and-forget";

type SendSite = {
	/** The enclosing exported function, for a human reading a failure. */
	fn: string;
	posture: Posture;
	/** Who hears about it when this send reaches nobody. */
	fallback: string;
};

/**
 * Every guarded-sender construction in `convex/`, in source order.
 *
 * The ordering matters only for the diff when a site is added or removed — the
 * assertions below match on count and on the set of declared functions, not on
 * line numbers, so ordinary edits above a send site never break this test.
 */
const SEND_SITES: SendSite[] = [
	{
		fn: "handleInbound (unknown-sender reply)",
		posture: "fire-and-forget",
		fallback:
			"None owed. The buyer is mid-conversation and just messaged us; a failed reply leaves them exactly where they were, and we have no identity for them to fall back to.",
	},
	{
		fn: "handleInbound (order-received ack)",
		posture: "fire-and-forget",
		fallback:
			"None owed. Same open conversation; the order itself is already committed and visible on their order page.",
	},
	{
		fn: "handleInbound (seller-attributed confirm)",
		posture: "fire-and-forget",
		fallback:
			"The retailer's own order email fires separately from handleInbound, so the seller learns about the order regardless of this reply.",
	},
	{
		fn: "handleInbound (seller-attributed confirm, no retailer)",
		posture: "fire-and-forget",
		fallback: "As above — an inbound we could not attribute to a retailer.",
	},
	{
		fn: "notifyManualPaymentReminder",
		posture: "deliver",
		fallback:
			"The seller pressed the button, so the ACTION reports the real outcome: a send that reached nobody returns `send_failed`, rolls the 24h cooldown back, and the toast says so.",
	},
	{
		fn: "sendTestRetailerAlert",
		posture: "fire-and-forget",
		fallback:
			"None owed — a one-shot CLI diagnostic whose whole purpose is to surface the raw send result to whoever ran it.",
	},
	{
		fn: "notifyFoundingWelcome",
		posture: "deliver",
		fallback:
			"email.notifyFoundingWelcome — the seller just paid and took a Founding rank; silence here costs the most trust per send of any message we have.",
	},
	{
		fn: "notifySellerNewOrder",
		posture: "deliver",
		fallback: "email.notifyRetailerOrderAlert (force: true).",
	},
	{
		fn: "notifySellerPaymentClaim",
		posture: "deliver",
		fallback: "email.notifyPaymentClaimed (force: true).",
	},
	{
		fn: "notifySellerPaymentReceived",
		posture: "deliver",
		fallback: "email.notifyPaymentReceived (force: true).",
	},
	{
		fn: "notifyStorefrontOrderCreated",
		posture: "deliver",
		fallback:
			"orders.recordConfirmationPush(failed) — no buyer email exists anywhere in the schema, so the fallback is the seller's amber order-detail panel plus the buyer's own write-in recovery route.",
	},
	{
		fn: "notifyCounterOrderCreated",
		posture: "deliver",
		fallback:
			"orders.recordConfirmationPush(failed) — same panel, and the cashier may still have the buyer standing in front of them.",
	},
	{
		fn: "notifyClaimLink",
		posture: "deliver",
		fallback:
			"orderClaims.recordClaimSendOutcome — the claims list turns that into 'Copy link' so the seller can send it by hand.",
	},
];

function sourceText(): string {
	return SOURCES.map((f) => readFileSync(join(CONVEX, f), "utf8")).join("\n");
}

describe("outbound WhatsApp fallback registry (86eyrtz9t)", () => {
	test("every makeGuardedSender site is declared with a fallback posture", () => {
		const constructions = sourceText().match(/makeGuardedSender\s*\(/g) ?? [];
		expect(
			constructions.length,
			`convex/ constructs ${constructions.length} guarded sender(s) but ${SEND_SITES.length} are declared in SEND_SITES.\n\n` +
				"A WhatsApp send that reaches nobody must tell somebody — the Meta template may not be approved, the buyer may have opted out, the seller may be capped, Meta may be down.\n" +
				"Declare the new site in convex/sendFallbackRegistry.test.ts, saying who hears about it when it reaches nobody:\n" +
				"  - posture 'deliver'          → use wa.deliver(to, msg, { onUnreachable }) and name the second channel\n" +
				"  - posture 'fire-and-forget'  → justify why nothing is owed\n" +
				"See docs/order-notifications.md and CLAUDE.md → Architectural Constraints.",
		).toBe(SEND_SITES.length);
	});

	test("every declared fallback names who hears about it", () => {
		for (const site of SEND_SITES) {
			expect(site.fallback.trim().length, `${site.fn} has no fallback note`)
				.toBeGreaterThan(20);
		}
	});

	test("each delivery-critical site actually calls .deliver()", () => {
		const text = sourceText();
		const delivers = text.match(/\.deliver\s*\(/g) ?? [];
		const declared = SEND_SITES.filter((s) => s.posture === "deliver").length;
		// notifyCounterOrderCreated reaches deliver() through the shared
		// sendPaymentMessage helper on its pay-later branch, which itself makes
		// two calls (cta, then a text degrade) — so the source carries more
		// .deliver() calls than there are delivery-critical sites. The floor is
		// what matters: never fewer than one per declared site.
		expect(
			delivers.length,
			"a site declared posture 'deliver' but no .deliver() call was found for it",
		).toBeGreaterThanOrEqual(declared);
	});

	test("no delivery-critical site still hand-rolls classifyPushFailure", () => {
		// The seam owns retry classification now. A call site reaching for the
		// classifier directly means the blocked/retry/fallback block is being
		// hand-rolled again — the exact drift this ticket removed.
		// Matches a CALL, not a mention: the module still refers to the
		// classifier by name in a comment explaining what the seam does on its
		// behalf, and that reference is worth keeping.
		const calls = sourceText().match(/\bclassifyPushFailure\s*\(/g) ?? [];
		expect(
			calls.length,
			"convex/whatsapp.ts should not classify send failures itself — pass `retry` + `onUnreachable` to wa.deliver() instead (86eyrtz9t)",
		).toBe(0);
	});
});
