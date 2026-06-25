import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
	"purge expired slug history",
	{ hourUTC: 3, minuteUTC: 17 },
	internal.retailers.internalPurgeExpiredSlugHistory,
);

// Manual-billing status transitions: trial expiry + founding/renewal overdue
// (trialing/active → past_due) + renewal-chase logging. See
// docs/manual-subscription.md.
crons.daily(
	"daily billing status",
	{ hourUTC: 3, minuteUTC: 30 },
	internal.subscriptions.internalDailyBillingStatus,
);

// Counter Checkout housekeeping: flip unscanned sessions past their ~10min TTL
// to `expired`. Reads already compute effective expiry, so this just keeps stale
// rows out of active-session listings. See docs/counter-checkout.md.
crons.interval(
	"expire stale counter checkout sessions",
	{ minutes: 5 },
	internal.counterCheckout.expireStaleSessions,
	{},
);

export default crons;
