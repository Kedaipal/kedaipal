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

// NOTE: the day-11 unpaid-payment-reminder cron was removed with the
// one-message-per-order policy (86eyd63r8) — an order gets exactly one outbound
// WhatsApp, the confirmation push, and chasing payment is the seller's call from
// the inbox. See docs/one-message-per-order.md.

// Lalamove checkout-quote hygiene: abandoned deliveryQuotes rows (buyer never
// completed checkout) are transient by design — purge anything older than a
// day. See docs/delivery-lalamove.md.
crons.daily(
	"purge stale delivery quotes",
	{ hourUTC: 3, minuteUTC: 45 },
	internal.lalamove.purgeStaleCheckoutQuotes,
	{},
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

// PDPA retention: DELETE dead counter sessions (expired/cancelled) ~30 days
// after they died — they hold buyer phone numbers, and the store QR poster
// (86ey5m35w) increases junk-scan volume, so they must not live forever.
// Completed sessions are kept (order retention is the Compliance Pack's job,
// 86ey5m3hx). See docs/counter-checkout.md.
crons.daily(
	"purge stale counter checkout sessions",
	{ hourUTC: 3, minuteUTC: 45 },
	internal.counterCheckout.purgeStaleSessions,
	{},
);

export default crons;
