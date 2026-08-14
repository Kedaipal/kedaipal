/**
 * Retry policy for the storefront order-confirmation push (86eyf1rck).
 *
 * The confirmation is the ONE outbound message a storefront order sends, and
 * the buyer is told at checkout that it's coming — so a transient Meta blip
 * must not be turned into "please go send us a WhatsApp message yourself".
 * This module decides, from a failed send, whether another attempt could ever
 * help, and how the buyer should be told about it.
 *
 * Pure + Convex-free so the policy is unit-testable and can't drift from the
 * action that applies it.
 */

/**
 * Why a push ultimately failed, as told to the humans involved:
 *  - `unreachable` — the number itself is the problem (typo'd, not on
 *    WhatsApp, not reachable). The buyer can fix it; retrying cannot.
 *  - `system` — our side or Meta's (outage, throttle, misconfigured template).
 *    The number is probably fine, so we never ask the buyer to compensate.
 */
export type PushFailureKind = "unreachable" | "system";

/** Backoff before attempts 2, 3 and 4. Deliberately minutes, not hours: the
 * buyer is looking at the order page now, and a confirmation that lands 20
 * minutes later is worth little. Four attempts inside ~10 minutes covers the
 * realistic blip without hammering Meta. */
export const PUSH_RETRY_DELAYS_MS = [30_000, 120_000, 480_000] as const;
export const PUSH_MAX_ATTEMPTS = PUSH_RETRY_DELAYS_MS.length + 1;

/**
 * Meta error codes that are permanent for this (recipient, template) pair.
 * Retrying any of these produces the identical rejection, so they terminate
 * immediately — and they split into the two buyer-facing kinds:
 *
 *   131026  Message undeliverable — recipient not on WhatsApp / can't receive
 *   131030  Recipient not in allowed list (test-number restriction)
 *   131047  Re-engagement required (no template, outside window)
 *   131051  Unsupported message type
 *   132000  Template param count mismatch
 *   132001  Template does not exist in this language
 *   132005  Template hydrated text too long
 *   132007  Template format/policy violation
 *   132012  Template param format mismatch
 *   132015  Template is paused
 *   132016  Template is disabled
 *   132068  Flow is blocked
 *   132069  Flow is throttled
 */
const UNREACHABLE_CODES = new Set([131026, 131030, 131047, 131051]);
const TEMPLATE_CODES = new Set([
	132000, 132001, 132005, 132007, 132012, 132015, 132016, 132068, 132069,
]);

/** Meta codes that are explicitly throttling — the send is fine, just later. */
const THROTTLE_CODES = new Set([130429, 131048, 131056, 80007]);

export type PushAttemptOutcome =
	| { retry: true; delayMs: number }
	| { retry: false; kind: PushFailureKind };

export type FailedSend = {
	/** HTTP status Meta answered with, if it answered at all. */
	httpStatus?: number;
	/** Meta's own error code from the response body. */
	metaCode?: number;
	/** False when the request never produced a response (nothing was sent). */
	responded: boolean;
};

/**
 * Whether a failed send is worth another attempt, and if not, how to describe
 * it. `attempt` is 1-based (the first try is attempt 1).
 *
 * The double-send guard is the load-bearing rule: Meta exposes no idempotency
 * key, so a retry can duplicate a message that actually went out. We therefore
 * only retry when the evidence says nothing was delivered — either no response
 * at all, or a status/code that Meta only returns *instead of* accepting the
 * message (5xx, 408, 429, explicit throttle codes). An ambiguous success is
 * never retried.
 */
export function classifyPushFailure(
	fail: FailedSend,
	attempt: number,
): PushAttemptOutcome {
	const exhausted = attempt >= PUSH_MAX_ATTEMPTS;
	const delayMs = PUSH_RETRY_DELAYS_MS[attempt - 1];

	// Hard rejects first — a permanent code must terminate even on attempt 1.
	if (fail.metaCode !== undefined) {
		if (UNREACHABLE_CODES.has(fail.metaCode)) {
			return { retry: false, kind: "unreachable" };
		}
		if (TEMPLATE_CODES.has(fail.metaCode)) {
			return { retry: false, kind: "system" };
		}
	}

	const transient =
		// Never reached Meta → nothing sent, always safe to retry.
		!fail.responded ||
		(fail.metaCode !== undefined && THROTTLE_CODES.has(fail.metaCode)) ||
		fail.httpStatus === 408 ||
		fail.httpStatus === 429 ||
		(fail.httpStatus !== undefined && fail.httpStatus >= 500);

	if (transient && !exhausted && delayMs !== undefined) {
		return { retry: true, delayMs };
	}
	// Out of attempts, or a 4xx we don't recognise. Either way it's reported as
	// ours to fix, not the buyer's number to blame — telling someone their
	// number is wrong when it isn't is the worse of the two errors.
	return { retry: false, kind: "system" };
}
