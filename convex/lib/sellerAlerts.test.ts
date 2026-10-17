import { describe, expect, test } from "vitest";
import {
	sellerWaAlertWillAttempt,
	subscriptionCoversWaAlerts,
} from "./sellerAlerts";

/**
 * This predicate decides whether the seller's EMAIL stays quiet. Getting it
 * wrong in the "true" direction is the dangerous one: it suppresses an email
 * for a WhatsApp alert that never fires, and the seller hears nothing at all.
 * So every falsy input is asserted explicitly.
 */
const REACHABLE = {
	orderWaAlerts: true,
	notifyWaPhone: "60123456789",
	subscriptionCovers: true,
};
const LIVE = { templateConfigured: true };

describe("sellerWaAlertWillAttempt", () => {
	test("fully configured seller → WhatsApp covers it, email stays quiet", () => {
		expect(sellerWaAlertWillAttempt(REACHABLE, LIVE)).toBe(true);
	});

	test("the switch is ON by default — never touched + a number = WhatsApp (z8r3fdv55f)", () => {
		expect(
			sellerWaAlertWillAttempt(
				{ notifyWaPhone: "60123456789", subscriptionCovers: true },
				LIVE,
			),
		).toBe(true);
	});

	test("template env unset → the alert can't fire, so email must", () => {
		expect(
			sellerWaAlertWillAttempt(REACHABLE, { templateConfigured: false }),
		).toBe(false);
	});

	test("switched OFF explicitly → email must still fire", () => {
		expect(
			sellerWaAlertWillAttempt({ ...REACHABLE, orderWaAlerts: false }, LIVE),
		).toBe(false);
	});

	test("no number saved → email must still fire, whatever the switch says", () => {
		expect(
			sellerWaAlertWillAttempt({ ...REACHABLE, notifyWaPhone: undefined }, LIVE),
		).toBe(false);
		expect(
			sellerWaAlertWillAttempt({ ...REACHABLE, notifyWaPhone: "" }, LIVE),
		).toBe(false);
		expect(sellerWaAlertWillAttempt({ subscriptionCovers: true }, LIVE)).toBe(
			false,
		);
	});

	test("subscription not covering → email must fire, even switched on with a number", () => {
		expect(
			sellerWaAlertWillAttempt({ ...REACHABLE, subscriptionCovers: false }, LIVE),
		).toBe(false);
	});

	test("counter order suppresses the NEW-ORDER alert, so email must fire", () => {
		// The seller rang it up in person; the WA alert deliberately skips it.
		// If the email also skipped, a counter order would notify nobody.
		expect(
			sellerWaAlertWillAttempt(REACHABLE, {
				templateConfigured: true,
				isCounterOrder: true,
			}),
		).toBe(false);
	});

	test("payment claim passes no counter flag — a counter claim IS alerted", () => {
		// The claim lands hours later when nobody is at the counter, so the
		// caller omits isCounterOrder and WhatsApp covers it.
		expect(sellerWaAlertWillAttempt(REACHABLE, { templateConfigured: true })).toBe(
			true,
		);
	});
});

describe("subscriptionCoversWaAlerts — the alert rides the subscription, not a tier", () => {
	test("a trial and an active subscription are covered, on any plan", () => {
		expect(subscriptionCoversWaAlerts({ status: "trialing" }, false)).toBe(true);
		expect(subscriptionCoversWaAlerts({ status: "active" }, false)).toBe(true);
	});

	test("locked (past_due), held and cancelled stores are not — the email covers them", () => {
		expect(subscriptionCoversWaAlerts({ status: "past_due" }, false)).toBe(false);
		expect(subscriptionCoversWaAlerts({ status: "on_hold" }, false)).toBe(false);
		expect(subscriptionCoversWaAlerts({ status: "cancelled" }, false)).toBe(
			false,
		);
	});

	test("comped and admin stores are covered whatever the status", () => {
		expect(
			subscriptionCoversWaAlerts({ status: "past_due", comped: true }, false),
		).toBe(true);
		expect(subscriptionCoversWaAlerts({ status: "cancelled" }, true)).toBe(true);
		expect(subscriptionCoversWaAlerts(null, true)).toBe(true);
	});

	test("a missing subscription row is covered — it resolves as comped full access everywhere else", () => {
		// Failing closed here would show "Paused" on the alerts card while the
		// Billing tab reports full access for the same store.
		expect(subscriptionCoversWaAlerts(null, false)).toBe(true);
	});
});
