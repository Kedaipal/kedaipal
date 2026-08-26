import { describe, expect, test } from "vitest";
import { sellerWaAlertWillAttempt } from "./sellerAlerts";

/**
 * This predicate decides whether the seller's EMAIL stays quiet. Getting it
 * wrong in the "true" direction is the dangerous one: it suppresses an email
 * for a WhatsApp alert that never fires, and the seller hears nothing at all.
 * So every falsy input is asserted explicitly.
 */
const REACHABLE = { orderWaAlerts: true, notifyWaPhone: "60123456789" };
const LIVE = { templateConfigured: true };

describe("sellerWaAlertWillAttempt", () => {
	test("fully configured seller → WhatsApp covers it, email stays quiet", () => {
		expect(sellerWaAlertWillAttempt(REACHABLE, LIVE)).toBe(true);
	});

	test("template env unset → the alert can't fire, so email must", () => {
		expect(
			sellerWaAlertWillAttempt(REACHABLE, { templateConfigured: false }),
		).toBe(false);
	});

	test("toggle off (the default) → email must still fire", () => {
		expect(sellerWaAlertWillAttempt({ ...REACHABLE, orderWaAlerts: false }, LIVE)).toBe(
			false,
		);
		expect(sellerWaAlertWillAttempt({ notifyWaPhone: "60123456789" }, LIVE)).toBe(
			false,
		);
	});

	test("no number saved → email must still fire", () => {
		expect(sellerWaAlertWillAttempt({ orderWaAlerts: true }, LIVE)).toBe(false);
		expect(
			sellerWaAlertWillAttempt({ orderWaAlerts: true, notifyWaPhone: "" }, LIVE),
		).toBe(false);
	});

	test("an empty retailer never suppresses", () => {
		expect(sellerWaAlertWillAttempt({}, LIVE)).toBe(false);
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
