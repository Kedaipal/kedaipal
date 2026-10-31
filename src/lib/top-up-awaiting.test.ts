import { describe, expect, it } from "vitest";
import {
	AWAIT_TOP_UP_MS,
	awaitingTopUp,
	topUpLanded,
	topUpWaitingLine,
} from "./top-up-awaiting";

/**
 * "Waiting for your top-up" (z8r3fdx34j, Arif 24 Oct): derived from the trip
 * out (when, and the balance it left at) and the wallet's latest reading.
 */

const NOW = 1_800_000_000_000;
const trip = { at: NOW - 60_000, balanceBefore: 1240 };
const seen = (at: number | null, balanceMinor: number | null) => ({
	provider: "lalamove" as const,
	at,
	balanceMinor,
});

describe("awaitingTopUp / topUpLanded", () => {
	it("waits from the trip out until a newer, HIGHER balance lands", () => {
		expect(awaitingTopUp(trip, seen(NOW - 120_000, 1240), NOW)).toBe(true);
		expect(awaitingTopUp(trip, seen(null, null), NOW)).toBe(true);
		expect(awaitingTopUp(trip, seen(NOW - 1_000, 5240), NOW)).toBe(false);
		expect(topUpLanded(trip, seen(NOW - 1_000, 5240), NOW)).toBe(true);
	});

	it("a deduction, or a re-read with nothing paid, is not a top-up", () => {
		// Lalamove's webhook fires on a booking's spend too.
		expect(awaitingTopUp(trip, seen(NOW - 1_000, 80), NOW)).toBe(true);
		expect(topUpLanded(trip, seen(NOW - 1_000, 80), NOW)).toBe(false);
		// EasyParcel re-read on return: same balance, fresher reading.
		expect(awaitingTopUp(trip, seen(NOW - 1_000, 1240), NOW)).toBe(true);
	});

	it("Delyva waits like EasyParcel now its balance can be read; any trip lapses", () => {
		// Delyva became askable on 31 Oct 2026 (its customer profile).
		expect(
			awaitingTopUp(
				trip,
				{ provider: "delyva", at: null, balanceMinor: null },
				NOW,
			),
		).toBe(true);
		const old = { at: NOW - AWAIT_TOP_UP_MS - 1, balanceBefore: 1240 };
		expect(awaitingTopUp(old, seen(null, null), NOW)).toBe(false);
		expect(topUpLanded(old, seen(NOW - 1_000, 9999), NOW)).toBe(false);
		expect(awaitingTopUp(null, seen(null, null), NOW)).toBe(false);
	});

	it("with no balance before (never reported), any reported balance is the landing", () => {
		const blind = { at: NOW - 60_000, balanceBefore: null };
		expect(topUpLanded(blind, seen(NOW - 1_000, 500), NOW)).toBe(true);
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
