import { describe, expect, it } from "vitest";
import type { CourierWalletView } from "../../lib/courier-wallets";
import { balancesPlacement, balancesWalletsFirst } from "./balances-card";

/** Home's Balances card goes where the more urgent half says (z8r3fdx34j). */

const wallet = (o: Partial<CourierWalletView>): CourierWalletView => ({
	provider: "lalamove",
	armed: true,
	isTest: false,
	state: "ok",
	balanceMinor: 8450,
	currency: "MYR",
	at: 1,
	lowAlertMinor: 3000,
	lowAlertCustom: false,
	source: "webhook",
	refusedAt: null,
	refusedPriceMinor: null,
	...o,
});

describe("balancesPlacement", () => {
	it("healthy everything sits down in Your store", () => {
		expect(balancesPlacement("ok", [wallet({})])).toBe("store");
		expect(balancesPlacement(null, [])).toBe("store");
	});

	it("credits out of orders go to the top, whatever the wallets say", () => {
		expect(balancesPlacement("out", [wallet({})])).toBe("top");
	});

	it("a booking courier that needs a top-up lifts the card under the strip", () => {
		expect(balancesPlacement("ok", [wallet({ state: "low" })])).toBe(
			"under-strip",
		);
		expect(balancesPlacement(null, [wallet({ state: "short" })])).toBe(
			"under-strip",
		);
	});

	it("…but not a paused courier, a test account, or one that never shares", () => {
		expect(
			balancesPlacement("ok", [wallet({ state: "low", armed: false })]),
		).toBe("store");
		expect(
			balancesPlacement("ok", [wallet({ state: "empty", isTest: true })]),
		).toBe("store");
		expect(balancesPlacement("ok", [wallet({ state: "unshared" })])).toBe(
			"store",
		);
	});
});

describe("balancesWalletsFirst — the half that moved the card leads it", () => {
	it("a wallet that lifted the card opens it", () => {
		expect(balancesWalletsFirst("ok", [wallet({ state: "low" })])).toBe(true);
		expect(balancesWalletsFirst(null, [wallet({ state: "empty" })])).toBe(true);
	});

	it("credits lead when they are urgent themselves, or nothing is", () => {
		expect(balancesWalletsFirst("low", [wallet({ state: "low" })])).toBe(false);
		expect(balancesWalletsFirst("out", [wallet({ state: "empty" })])).toBe(
			false,
		);
		expect(balancesWalletsFirst("ok", [wallet({})])).toBe(false);
		expect(
			balancesWalletsFirst("ok", [wallet({ state: "low", isTest: true })]),
		).toBe(false);
	});
});
