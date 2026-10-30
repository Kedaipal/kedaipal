import { describe, expect, it } from "vitest";
import {
	AWAIT_TOP_UP_MS,
	awaitingTopUp,
	topUpWaitingLine,
} from "./top-up-awaiting";

/**
 * "Waiting for your top-up" (z8r3fdx34j, Arif 24 Oct): derived from when the
 * seller left for the courier and when the wallet last heard from it.
 */

const NOW = 1_800_000_000_000;

describe("awaitingTopUp", () => {
	it("waits from the trip out until a NEWER balance lands", () => {
		const startedAt = NOW - 60_000;
		expect(
			awaitingTopUp(
				startedAt,
				{ provider: "lalamove", at: NOW - 120_000 },
				NOW,
			),
		).toBe(true);
		expect(
			awaitingTopUp(startedAt, { provider: "lalamove", at: null }, NOW),
		).toBe(true);
		// The webhook came in after the seller left: the top-up landed.
		expect(
			awaitingTopUp(startedAt, { provider: "lalamove", at: NOW - 1_000 }, NOW),
		).toBe(false);
	});

	it("never for a courier that doesn't tell us (Delyva), nor once it lapses", () => {
		expect(
			awaitingTopUp(NOW - 60_000, { provider: "delyva", at: null }, NOW),
		).toBe(false);
		expect(
			awaitingTopUp(
				NOW - AWAIT_TOP_UP_MS - 1,
				{ provider: "lalamove", at: null },
				NOW,
			),
		).toBe(false);
		expect(awaitingTopUp(null, { provider: "lalamove", at: null }, NOW)).toBe(
			false,
		);
	});
});

describe("topUpWaitingLine", () => {
	it("says how each courier's balance comes back", () => {
		expect(topUpWaitingLine({ provider: "lalamove" })).toMatch(
			/Waiting for Lalamove to report your top-up — this updates by itself/,
		);
		expect(topUpWaitingLine({ provider: "easyparcel" })).toMatch(
			/we check again when you come back here/,
		);
	});
});
