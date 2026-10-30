import { describe, expect, it } from "vitest";
import {
	type CourierWalletView,
	dispatchWalletLine,
	presentWallet,
	walletAmount,
	walletTopUpLinks,
} from "./courier-wallets";

/**
 * What each courier-wallet state SAYS (z8r3fdrgxc + z8r3fdx34j) — the one
 * source of words for Home, Deliveries, Integrations and the dispatch cards.
 */

const NOW = Date.UTC(2026, 9, 29, 6);
const min = 60_000;
const v = (o: Partial<CourierWalletView> = {}): CourierWalletView => ({
	provider: "lalamove",
	armed: true,
	isTest: false,
	state: "ok",
	balanceMinor: 8450,
	currency: "MYR",
	at: NOW - 3 * min,
	lowAlertMinor: 3000,
	lowAlertCustom: false,
	source: "webhook",
	refusedAt: null,
	refusedPriceMinor: null,
	...o,
});

describe("presentWallet — every state the row can be in", () => {
	it("healthy: the amount, quiet, with how fresh it is", () => {
		const p = presentWallet(v(), NOW);
		expect(p.figure).toMatch(/RM\s?84\.50/);
		expect(p.tone).toBe("neutral");
		expect(p.detail).toBe("Updated 3m ago");
		expect(p.needsTopUp).toBe(false);
	});

	it("low: amber, names the line — unless the row shows the line itself", () => {
		const low = v({ state: "low", balanceMinor: 1240 });
		expect(presentWallet(low, NOW).detail).toMatch(
			/^Low — under your RM\s?30 alert · updated 3m ago$/,
		);
		expect(presentWallet(low, NOW, { alertShown: true }).detail).toBe(
			"Low · updated 3m ago",
		);
		expect(presentWallet(low, NOW).tone).toBe("warn");
		expect(presentWallet(low, NOW).needsTopUp).toBe(true);
	});

	it("empty: red, says the next booking fails", () => {
		const p = presentWallet(v({ state: "empty", balanceMinor: 0 }), NOW);
		expect(p.tone).toBe("danger");
		expect(p.detail).toMatch(/^Empty — the next booking will fail/);
	});

	it("not reported yet is never RM 0, and says when it will appear", () => {
		const p = presentWallet(
			v({ state: "unreported", balanceMinor: null, at: null, source: null }),
			NOW,
		);
		expect(p.figure).toBe("Not reported yet");
		expect(p.figureIsAmount).toBe(false);
		expect(p.detail).toMatch(/after your next top-up or booking/);
	});

	it("an EasyParcel wallet not yet read says to refresh, not to wait", () => {
		const p = presentWallet(
			v({
				provider: "easyparcel",
				state: "unreported",
				balanceMinor: null,
				at: null,
				source: null,
			}),
			NOW,
		);
		expect(p.detail).toMatch(/refresh to check/);
	});

	it("Delyva: 'Not shared', then the last balance a refusal showed", () => {
		expect(
			presentWallet(
				v({
					provider: "delyva",
					state: "unshared",
					balanceMinor: null,
					at: null,
					source: null,
				}),
				NOW,
			).figure,
		).toBe("Not shared");
		const seen = presentWallet(
			v({
				provider: "delyva",
				state: "empty",
				balanceMinor: 0,
				source: "refusal",
			}),
			NOW,
		);
		expect(seen.detail).toMatch(/last seen .*, when Delyva refused a booking/);
	});

	it("short: a refusal with no amount reads 'Too low', in red", () => {
		const p = presentWallet(
			v({ state: "short", refusedAt: NOW - 40 * min }),
			NOW,
		);
		expect(p.figure).toBe("Too low");
		expect(p.tone).toBe("danger");
		expect(p.detail).toMatch(/refused a booking 40m ago/);
	});

	it("stale (over a day): greyed, and says it may be out of date", () => {
		const p = presentWallet(v({ at: NOW - 2 * 86_400_000 }), NOW);
		expect(p.stale).toBe(true);
		expect(p.detail).toMatch(/^May be out of date · updated 2d ago/);
	});

	it("a test account is play money — never a top-up", () => {
		const p = presentWallet(
			v({ isTest: true, state: "empty", balanceMinor: 0 }),
			NOW,
		);
		expect(p.isTest).toBe(true);
		expect(p.needsTopUp).toBe(false);
		expect(p.detail).toMatch(/play money/);
	});

	it("a test wallet with nothing seen names its state, never a bare dash", () => {
		const none = { balanceMinor: null, at: null, source: null } as const;
		expect(
			presentWallet(
				v({ ...none, isTest: true, provider: "delyva", state: "unshared" }),
				NOW,
			).figure,
		).toBe("Not shared");
		expect(
			presentWallet(v({ ...none, isTest: true, state: "unreported" }), NOW)
				.figure,
		).toBe("Not reported yet");
		const line = dispatchWalletLine(
			v({ ...none, isTest: true, provider: "delyva", state: "unshared" }),
			475,
			NOW,
			"MYR",
		);
		expect(line.text).toBe("Delyva wallet: Not shared · test account");
	});
});

describe("dispatchWalletLine — what Book is told", () => {
	it("warn: how short, and that the courier has the final say", () => {
		const line = dispatchWalletLine(
			v({ balanceMinor: 840, state: "low" }),
			1270,
			NOW,
			"MYR",
		);
		expect(line.verdict).toBe("warn");
		expect(line.text).toMatch(
			/RM\s?4\.30 short of this booking\. Lalamove has the final say\./,
		);
	});

	it("block: the balance we just read, against this booking's cost", () => {
		const line = dispatchWalletLine(
			v({
				provider: "easyparcel",
				currency: "SGD",
				source: "pull",
				at: NOW - min,
				balanceMinor: 800,
			}),
			1150,
			NOW,
			"SGD",
		);
		expect(line.verdict).toBe("block");
		expect(line.text).toMatch(
			/Your EasyParcel wallet has S\$\s?8\.00; this booking costs S\$\s?11\.50\. Top up first\./,
		);
	});

	it("block on a test wallet speaks sandbox, never 'top up'", () => {
		const line = dispatchWalletLine(
			v({
				provider: "easyparcel",
				isTest: true,
				source: "pull",
				at: NOW - min,
				balanceMinor: 1980,
			}),
			2033,
			NOW,
			"MYR",
		);
		expect(line.verdict).toBe("block");
		expect(line.text).toMatch(
			/Your EasyParcel test wallet has RM\s?19\.80; this booking costs RM\s?20\.33\. Add test credit in your EasyParcel sandbox first\./,
		);
		expect(line.text).not.toMatch(/Top up/);
	});

	it("covers: a quiet line with the balance and its age", () => {
		const line = dispatchWalletLine(v(), 600, NOW, "MYR");
		expect(line.verdict).toBe("covers");
		expect(line.text).toMatch(
			/^Lalamove wallet: RM\s?84\.50 · updated 3m ago$/,
		);
	});
});

describe("helpers", () => {
	it("thresholds read as whole amounts", () => {
		expect(walletAmount(3000, "MYR")).toMatch(/^RM\s?30$/);
		expect(walletAmount(1250, "SGD")).toMatch(/^S\$\s?12\.50$/);
	});

	it("top-up links follow the store's country", () => {
		expect(walletTopUpLinks({ provider: "easyparcel" }, "SG").guideUrl).toMatch(
			/helpcentre-sg\.easyparcel\.com/,
		);
		expect(walletTopUpLinks({ provider: "delyva" }, "MY").appUrl).toBe(
			"https://my.delyva.app/customer/topup",
		);
		// The bare app root lands on the Malaysian site for every account.
		expect(walletTopUpLinks({ provider: "easyparcel" }, "SG").appUrl).toBe(
			"https://app.easyparcel.com/sg/en/",
		);
		expect(walletTopUpLinks({ provider: "easyparcel" }, "MY").appUrl).toBe(
			"https://app.easyparcel.com/my/en/",
		);
	});
});
