// The balance-driven credit copy, while the seller lock is switched off
// (CREDIT_LOCK_ENABLED, convex/lib/credits.ts).
//
// The lock's own gate lives at ONE resolver, which covers everything
// conditioned on `locked`. These three surfaces are conditioned on the BALANCE
// instead, so the gate never sees them — and each one kept promising a pause
// that no longer happens until review caught it. They are pinned here because
// nothing else can: a green server suite says nothing about a string chosen by
// `creditTone`.
import { describe, expect, test } from "vitest";
import { CREDIT_LOCK_ENABLED } from "../../convex/lib/credits";
import { creditTone } from "./credits-ui";
import { resolveBannerState } from "./subscription";

const PERIOD_GRANT = 200;

function bannerFor(total: number) {
	return resolveBannerState(
		{ status: "active", plan: "pro", billingCycle: "monthly" } as never,
		undefined,
		Date.now(),
		undefined,
		{
			total,
			periodGrant: PERIOD_GRANT,
			locked: false,
			customGrant: false,
			exempt: false,
			route: "topup" as const,
			ordersWaiting: 0,
		},
	);
}

describe("balance-driven credit copy while the lock is off", () => {
	test("the switch is off — the premise of every assertion below", () => {
		expect(CREDIT_LOCK_ENABLED).toBe(false);
	});

	test("a store IN DEBT still gets a banner", () => {
		// `creditsLocked` outranks this branch while the lock is on, and reads
		// `locked` — so with the lock off, gating on tone === "low" alone left a
		// store already into next month's credits with nothing at all.
		expect(creditTone(-15, PERIOD_GRANT)).toBe("out");
		expect(bannerFor(-15)?.kind).toBe("creditsLow");
	});

	test("a store running low still gets one, and a comfortable store does not", () => {
		expect(creditTone(10, PERIOD_GRANT)).toBe("low");
		expect(bannerFor(10)?.kind).toBe("creditsLow");
		expect(creditTone(180, PERIOD_GRANT)).toBe("ok");
		expect(bannerFor(180)?.kind).not.toBe("creditsLow");
	});

	test("the top-up CTA appears at the WORST balance, not only the second-worst", () => {
		// credit-meter's card variant offers it on `out || low`. The locked
		// branch used to cover `out`; gating on `low` alone inverted the urgency
		// ladder — debt got no button, running-low did.
		for (const total of [-15, 0, 10]) {
			const tone = creditTone(total, PERIOD_GRANT);
			expect(tone === "out" || tone === "low").toBe(true);
		}
	});
});
