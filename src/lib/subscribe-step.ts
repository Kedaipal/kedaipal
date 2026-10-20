// The dashboard setup checklist's last step — "Start your plan" — in the words
// of the real trial (Zaki, 30 Sep 2026; Credits T5 z8r3fdfu31): a store is free
// until its first order, and that order starts N days or M orders of everything
// in Pro, whichever comes first. This is where a new seller looks first, so the
// model is said here as one line of the step, never a modal. Pure, so the copy
// for each free-period state is tested (subscribe-step.test.ts).

import {
	INVOICE_DUE_GRACE_DAYS,
	TRIAL_CREDIT_GRANT,
	TRIAL_DAYS,
} from "../../convex/lib/plans";
import type { FreePeriodState } from "./subscription";

export type SubscribeStepCopy = {
	title: string;
	why: string;
	cta: string;
};

export function subscribeStepCopy(
	freePeriod: FreePeriodState,
): SubscribeStepCopy {
	if (freePeriod.kind === "free") {
		const days = freePeriod.daysLeft;
		return {
			title: "Start your plan",
			// Both trial numbers come from the constants the first invoice and
			// the ledger enforce — never literals.
			why: `You're free until your first live order, or day ${TRIAL_DAYS + 1} — ${days} day${days === 1 ? "" : "s"} left on that clock. Your first order then gives you ${INVOICE_DUE_GRACE_DAYS} days or ${TRIAL_CREDIT_GRANT} orders, whichever comes first, to try everything in Pro before your plan starts — nothing to do before then.`,
			cta: "View billing",
		};
	}
	if (freePeriod.kind === "ended") {
		const cause =
			freePeriod.reason === "first_order"
				? "Your first order came in, so your first invoice is ready."
				: `Your ${TRIAL_DAYS} free days are up, so your first invoice is ready.`;
		return {
			title: "Pay your first invoice",
			why: `${cause} Until it's due you have everything in Pro, for up to ${TRIAL_CREDIT_GRANT} orders. Pay it to start your plan — or switch plan first if another fits better. Your storefront stays live either way.`,
			cta: "View invoice",
		};
	}
	return {
		title: "Start your plan",
		why: "Pick the plan that fits — Starter or Pro — to keep your store live and accepting orders.",
		cta: "View billing",
	};
}
