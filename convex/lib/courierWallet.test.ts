import { describe, expect, test } from "vitest";
import { COURIER_PROVIDER_IDS, COUNTRY_COURIER_BOOKING } from "./courierProviders";
import {
	type CourierWalletView,
	defaultLowAlertMinor,
	FRESH_WALLET_MS,
	lowWalletNotice,
	parseDelyvaRefusal,
	TOP_UP_SUGGESTION_MIN_BOOKINGS,
	topUpSuggestions,
	WALLET_PROVIDERS,
	walletMoney,
	walletState,
	walletVerdict,
	withConnectionSnapshot,
} from "./courierWallet";

/**
 * What a courier wallet balance MEANS (z8r3fdrgxc + z8r3fdx34j) — the one
 * place every surface reads its state and the block-or-warn rule from.
 */

describe("walletState", () => {
	test("a known balance reads ok / low / empty against the wallet's own line", () => {
		const at = { balanceAt: 1, currency: "MYR" };
		expect(walletState("lalamove", { ...at, balance: 8450 })).toBe("ok");
		expect(walletState("lalamove", { ...at, balance: 1240 })).toBe("low");
		expect(walletState("lalamove", { ...at, balance: 0 })).toBe("empty");
		expect(walletState("lalamove", { ...at, balance: -50 })).toBe("empty");
		// The seller's own line wins over the RM 30 default.
		expect(
			walletState("lalamove", { ...at, balance: 4000, lowAlertMinor: 5000 }),
		).toBe("low");
	});

	test("SGD wallets default to an S$15 line, not a converted RM 30", () => {
		expect(defaultLowAlertMinor("SGD")).toBe(1500);
		expect(defaultLowAlertMinor("MYR")).toBe(3000);
		expect(
			walletState("easyparcel", { balance: 2000, currency: "SGD", balanceAt: 1 }),
		).toBe("ok");
	});

	test("nothing seen yet is its own state — 'unreported', or 'unshared' for a refusal-only courier", () => {
		expect(walletState("lalamove", null)).toBe("unreported");
		expect(walletState("easyparcel", {})).toBe("unreported");
		expect(walletState("delyva", null)).toBe("unshared");
	});

	test("a refusal newer than the balance is 'short'; an older one changes nothing", () => {
		expect(
			walletState("lalamove", { balance: 8450, balanceAt: 1, refusedAt: 2 }),
		).toBe("short");
		expect(
			walletState("lalamove", { balance: 8450, balanceAt: 3, refusedAt: 2 }),
		).toBe("ok");
		expect(walletState("lalamove", { refusedAt: 2 })).toBe("short");
	});
});

describe("walletVerdict — block only on a balance we just PULLED", () => {
	const now = 10_000_000;
	const view = (o: Partial<CourierWalletView>) =>
		({
			isTest: false,
			state: "low",
			currency: "MYR",
			balanceMinor: 800,
			at: now - 60_000,
			source: "pull",
			...o,
		}) as CourierWalletView;

	test("a fresh pull that can't pay blocks; one that can covers", () => {
		expect(walletVerdict(view({}), 1150, now, "MYR")).toBe("block");
		expect(walletVerdict(view({}), 700, now, "MYR")).toBe("covers");
	});

	test("a STALE pull only warns — EasyParcel is the final judge", () => {
		expect(
			walletVerdict(view({ at: now - FRESH_WALLET_MS - 1 }), 1150, now, "MYR"),
		).toBe("warn");
	});

	test("a pushed (Lalamove) or refusal-seen (Delyva) number only warns", () => {
		expect(walletVerdict(view({ source: "webhook" }), 1150, now, "MYR")).toBe("warn");
		expect(walletVerdict(view({ source: "refusal" }), 1150, now, "MYR")).toBe("warn");
	});

	test("short warns; nothing known is unknown", () => {
		expect(
			walletVerdict(view({ state: "short", balanceMinor: null }), 1150, now, "MYR"),
		).toBe("warn");
		expect(
			walletVerdict(view({ balanceMinor: null, state: "unreported" }), 1150, now, "MYR"),
		).toBe("unknown");
	});

	test("a TEST wallet is judged like a live one — a sandbox refuses too", () => {
		// Regression (test-code, 30 Oct 2026): J&T at RM 20.33 against a sandbox
		// read of RM 19.80 left Book live, one tap from a refusal.
		expect(walletVerdict(view({ isTest: true }), 1150, now, "MYR")).toBe("block");
		expect(
			walletVerdict(view({ isTest: true, source: "webhook" }), 1150, now, "MYR"),
		).toBe("warn");
		expect(walletVerdict(view({ isTest: true }), 700, now, "MYR")).toBe("covers");
	});
});

describe("walletVerdict — never across currencies", () => {
	const now = 10_000_000;
	const view = {
		state: "low",
		currency: "MYR",
		balanceMinor: 300,
		at: now - 60_000,
		source: "pull",
	} as CourierWalletView;

	test("a balance in another currency than the price says nothing", () => {
		// Regression (test-code, 31 Oct 2026): the Delyva demo quotes HKD.
		expect(walletVerdict(view, 475, now, "HKD")).toBe("unknown");
		expect(walletVerdict(view, 475, now, "MYR")).toBe("block");
	});

	test("…but a refusal is the provider's own verdict, in any currency", () => {
		expect(
			walletVerdict(
				{ ...view, state: "short", balanceMinor: null },
				475,
				now,
				"HKD",
			),
		).toBe("warn");
	});
});

describe("withConnectionSnapshot — the connection's balance fills a bare row", () => {
	const snap = { balance: 1980, currency: "SGD", at: 500 };

	test("no row, or a row with no balance, reads the snapshot as a pull", () => {
		expect(withConnectionSnapshot(null, snap)).toEqual({
			balance: 1980,
			currency: "SGD",
			balanceAt: 500,
			source: "pull",
		});
		expect(
			withConnectionSnapshot({ lowAlertMinor: 5000 }, snap),
		).toMatchObject({ balance: 1980, lowAlertMinor: 5000, source: "pull" });
	});

	test("newest wins: a newer row keeps its balance, an older one yields", () => {
		const newer = { balance: 900, balanceAt: 600, source: "pull" as const };
		expect(withConnectionSnapshot(newer, snap)).toBe(newer);
		expect(
			withConnectionSnapshot({ balance: 900, balanceAt: 400 }, snap),
		).toMatchObject({ balance: 1980, balanceAt: 500 });
	});

	test("a refusal newer than the snapshot still reads short", () => {
		const obs = withConnectionSnapshot({ refusedAt: 700 }, snap);
		expect(walletState("easyparcel", obs)).toBe("short");
	});

	test("no snapshot leaves the row alone", () => {
		expect(withConnectionSnapshot(null, null)).toBeNull();
	});
});

describe("lowWalletNotice — once per crossing", () => {
	test("notifies on the first needs-top-up state, then stays quiet", () => {
		expect(
			lowWalletNotice({ state: "low", notifiedAt: undefined, isTest: false }),
		).toBe("notify");
		expect(
			lowWalletNotice({ state: "empty", notifiedAt: 5, isTest: false }),
		).toBeNull();
	});

	test("a healthy wallet re-arms; a test wallet never notifies", () => {
		expect(lowWalletNotice({ state: "ok", notifiedAt: 5, isTest: false })).toBe(
			"rearm",
		);
		expect(
			lowWalletNotice({ state: "ok", notifiedAt: undefined, isTest: false }),
		).toBeNull();
		expect(
			lowWalletNotice({ state: "short", notifiedAt: undefined, isTest: true }),
		).toBeNull();
	});

	test("'unreported' and 'unshared' are not news", () => {
		for (const state of ["unreported", "unshared"] as const)
			expect(
				lowWalletNotice({ state, notifiedAt: undefined, isTest: false }),
			).toBeNull();
	});
});

describe("parseDelyvaRefusal", () => {
	test("reads both numbers (major units) out of Delyva's sentence", () => {
		expect(
			parseDelyvaRefusal(
				"Payment failed, You don't have enough credit balance. Bal: 0, Price: 5.00",
			),
		).toEqual({ balanceMinor: 0, priceMinor: 500 });
		expect(parseDelyvaRefusal("Bal: 1,203.45, Price: 12.5")).toEqual({
			balanceMinor: 120345,
			priceMinor: 1250,
		});
		expect(parseDelyvaRefusal("Bal: -2.10, Price: 4.00")?.balanceMinor).toBe(
			-210,
		);
	});

	test("anything without both numbers is null, never a guess", () => {
		expect(parseDelyvaRefusal(undefined)).toBeNull();
		expect(parseDelyvaRefusal("Insufficient credit")).toBeNull();
		expect(parseDelyvaRefusal("Bal: 0")).toBeNull();
	});
});

describe("WALLET_PROVIDERS — where a seller tops up", () => {
	test("every country a courier can be booked in has a top-up destination", () => {
		for (const provider of COURIER_PROVIDER_IDS)
			for (const [country, allowed] of Object.entries(
				COUNTRY_COURIER_BOOKING[provider],
			))
				if (allowed)
					expect(
						WALLET_PROVIDERS[provider].appUrl[country as "MY" | "SG"],
					).toMatch(/^https:\/\//);
	});

	test("money reads in the provider's currency", () => {
		expect(walletMoney(1240, "MYR")).toBe("RM 12.40");
		expect(walletMoney(1500, "SGD")).toBe("S$ 15.00");
	});
});

describe("topUpSuggestions — what to top up, from the store's own bookings", () => {
	test("too few bookings to go on says nothing", () => {
		expect(
			topUpSuggestions(Array(TOP_UP_SUGGESTION_MIN_BOOKINGS - 1).fill(1160)),
		).toBeNull();
	});

	test("average × trips, rounded UP to a whole 5, cheapest first", () => {
		// 10 bookings of RM 11.60 in 30 days: ~2.3 a week → 2 trips, 5 for two weeks.
		const out = topUpSuggestions(Array(10).fill(1160), 30);
		expect(out).toEqual([
			{ label: "~1 week", trips: 2, minor: 2500 },
			{ label: "~4 trips", trips: 4, minor: 5000 },
			{ label: "~2 weeks", trips: 5, minor: 6000 },
		]);
	});

	test("options that come out the same are said once", () => {
		// 30 bookings a month ≈ 7 a week — '~4 trips' and the weeks all differ;
		// 5 bookings ≈ 1 a week, so '~1 week' (1 trip) and '~2 weeks' (2) stay
		// distinct from '~4 trips' — but equal amounts collapse.
		const out = topUpSuggestions([500, 500, 500, 500, 500], 30) ?? [];
		const amounts = out.map((o) => o.minor);
		expect(new Set(amounts).size).toBe(amounts.length);
	});
});

describe("auto top-up — only where the courier has one", () => {
	test("EasyParcel links its own Auto Topup page per country; the others have none", () => {
		expect(WALLET_PROVIDERS.easyparcel.autoTopUpUrl.MY).toMatch(
			/app\.easyparcel\.com\/my\/en\/account\/auto-topup/,
		);
		expect(WALLET_PROVIDERS.easyparcel.autoTopUpUrl.SG).toMatch(
			/app\.easyparcel\.com\/sg\/en\/account\/auto-topup/,
		);
		expect(WALLET_PROVIDERS.lalamove.autoTopUpUrl).toEqual({ MY: null, SG: null });
		expect(WALLET_PROVIDERS.delyva.autoTopUpUrl).toEqual({ MY: null, SG: null });
	});
});

