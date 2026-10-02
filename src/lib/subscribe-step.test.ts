import { describe, expect, it } from "vitest";
import {
	INVOICE_DUE_GRACE_DAYS,
	TRIAL_CREDIT_GRANT,
} from "../../convex/lib/plans";
import { subscribeStepCopy } from "./subscribe-step";

/**
 * The first-run hint (Credits T5, z8r3fdfu31): the dashboard's "Start your
 * plan" step says the real trial — N days or M orders from the first order,
 * whichever comes first — from the constants that enforce it, in every
 * free-period state a new store passes through.
 */
describe("subscribeStepCopy", () => {
	const bounds = `${INVOICE_DUE_GRACE_DAYS} days or ${TRIAL_CREDIT_GRANT} orders, whichever comes first`;

	it("while free: the countdown to the backstop, then the trial the first order starts", () => {
		const copy = subscribeStepCopy({ kind: "free", daysLeft: 9 });
		expect(copy.title).toBe("Start your plan");
		expect(copy.why).toContain("9 days left on that clock");
		expect(copy.why).toContain("or day 15");
		expect(copy.why).toContain(bounds);
		expect(copy.why).toContain("to try everything in Pro");
		expect(copy.cta).toBe("View billing");
	});

	it("counts a single day as a day", () => {
		expect(subscribeStepCopy({ kind: "free", daysLeft: 1 }).why).toContain(
			"1 day left",
		);
	});

	it("after the first order: the invoice is ready, and Pro stays open for the order bound", () => {
		const copy = subscribeStepCopy({ kind: "ended", reason: "first_order" });
		expect(copy.title).toBe("Pay your first invoice");
		expect(copy.why).toContain("Your first order came in");
		expect(copy.why).toContain(`for up to ${TRIAL_CREDIT_GRANT} orders`);
		expect(copy.why).toContain("switch plan first");
		expect(copy.cta).toBe("View invoice");
	});

	it("after the backstop: the same terms, framed by the free days running out", () => {
		const copy = subscribeStepCopy({ kind: "ended", reason: "backstop" });
		expect(copy.why).toContain("Your 14 free days are up");
		expect(copy.why).toContain(`for up to ${TRIAL_CREDIT_GRANT} orders`);
	});

	it("outside the free period: pick a plan — the two listed tiers, Enterprise being a conversation", () => {
		expect(subscribeStepCopy({ kind: "none" }).why).toContain("Starter or Pro");
	});
});
