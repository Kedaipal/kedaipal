import { describe, expect, test } from "vitest";
import {
	classifyPushFailure,
	PUSH_MAX_ATTEMPTS,
	PUSH_RETRY_DELAYS_MS,
	pushOwnsTheMessage,
} from "./confirmationPush";

describe("classifyPushFailure — retryable classes", () => {
	test("a request that never reached Meta always retries (nothing was sent)", () => {
		expect(classifyPushFailure({ responded: false }, 1)).toEqual({
			retry: true,
			delayMs: PUSH_RETRY_DELAYS_MS[0],
		});
	});

	test("5xx / 408 / 429 retry", () => {
		for (const httpStatus of [500, 502, 503, 504, 408, 429]) {
			expect(
				classifyPushFailure({ httpStatus, responded: true }, 1),
			).toMatchObject({ retry: true });
		}
	});

	test("explicit throttle codes retry even on a 4xx", () => {
		for (const metaCode of [130429, 131048, 131056, 80007]) {
			expect(
				classifyPushFailure({ httpStatus: 400, metaCode, responded: true }, 1),
			).toMatchObject({ retry: true });
		}
	});

	test("backoff lengthens with each attempt, then gives up", () => {
		expect(classifyPushFailure({ responded: false }, 1)).toEqual({
			retry: true,
			delayMs: PUSH_RETRY_DELAYS_MS[0],
		});
		expect(classifyPushFailure({ responded: false }, 2)).toEqual({
			retry: true,
			delayMs: PUSH_RETRY_DELAYS_MS[1],
		});
		expect(classifyPushFailure({ responded: false }, 3)).toEqual({
			retry: true,
			delayMs: PUSH_RETRY_DELAYS_MS[2],
		});
		// Final attempt — a transient cause still reports as ours, never the number.
		expect(
			classifyPushFailure({ responded: false }, PUSH_MAX_ATTEMPTS),
		).toEqual({ retry: false, kind: "system" });
	});
});

describe("classifyPushFailure — permanent rejects terminate on the first try", () => {
	test("unreachable recipient blames the number (buyer can repair it)", () => {
		for (const metaCode of [131026, 131030, 131047, 131051]) {
			expect(
				classifyPushFailure({ httpStatus: 400, metaCode, responded: true }, 1),
			).toEqual({ retry: false, kind: "unreachable" });
		}
	});

	test("template problems are attributed to us, not the buyer", () => {
		for (const metaCode of [132000, 132001, 132005, 132007, 132015, 132016]) {
			expect(
				classifyPushFailure({ httpStatus: 400, metaCode, responded: true }, 1),
			).toEqual({ retry: false, kind: "system" });
		}
	});

	test("an unrecognised 4xx is reported as ours — telling someone their good number is wrong is the worse error", () => {
		expect(
			classifyPushFailure({ httpStatus: 403, responded: true }, 1),
		).toEqual({ retry: false, kind: "system" });
	});

	test("a permanent code is never retried even when attempts remain", () => {
		expect(
			classifyPushFailure(
				{ httpStatus: 400, metaCode: 131026, responded: true },
				1,
			),
		).toMatchObject({ retry: false });
	});
});

describe("pushOwnsTheMessage — who is allowed to send the buyer's one message", () => {
	test("no push path (legacy order) → the inbound reply is the one message", () => {
		expect(pushOwnsTheMessage(undefined)).toBe(false);
	});

	test("a failed push reached nobody, so the inbound reply still goes", () => {
		expect(pushOwnsTheMessage("failed")).toBe(false);
	});

	test.each(["deferred", "sending", "sent", "recovered"] as const)(
		"%s → the push owns it; a free-form reply would be a second billable send",
		(status) => {
			expect(pushOwnsTheMessage(status)).toBe(true);
		},
	);

	test("deferred counts as owned even though nothing has been sent yet", () => {
		// The message is merely waiting on a final price. Replying now would mean
		// the buyer gets this reply AND the template later — the exact double-send
		// the guard exists to stop.
		expect(pushOwnsTheMessage("deferred")).toBe(true);
	});
});
