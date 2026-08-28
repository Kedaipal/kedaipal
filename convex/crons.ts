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

// Booking requests the seller never answered auto-release after 24 h
// (86eyj70z1 decision 3 — the buyer was promised "confirms within 24 hours"
// up front, so the hold must actually die on schedule, not at the next
// midnight). 15-min cadence keeps the worst-case overshoot ~1% of the window.
crons.interval(
	"expire stale booking requests",
	{ minutes: 15 },
	internal.bookings.expireStaleRequests,
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

// Claim links (86eyq0epn): auto-cancel orders whose payment deadline passed —
// the carried timer's teeth (stock decremented at commit comes back). Every
// minute so "time's up" on the buyer's page and the actual cancel stay close;
// the by_payment_due index keeps each run a near-empty range read. The
// predicate protects claimed / fee-pending / live-payment-session orders —
// see convex/lib/orderClaims.ts isAutoCancelDue.
crons.interval(
	"cancel unpaid orders past their payment deadline",
	{ minutes: 1 },
	internal.orderClaims.cancelUnpaidDueOrders,
	{},
);

// Claim links (86eyq0epn): flip open claims past their fixed deadline to
// `expired`. Reads judge expiry live, so this keeps the status buckets true
// (claims list, purge eligibility). Every 5 min like the session sweep — a
// 15-minute live window reads expired instantly either way.
crons.interval(
	"expire stale claim links",
	{ minutes: 5 },
	internal.orderClaims.expireStaleClaims,
	{},
);

// PDPA retention: DELETE dead claims (expired/cancelled) ~30 days after they
// died — they hold buyer phone numbers + names. Completed claims are kept
// (they link to an order; order retention is the Compliance Pack's job).
crons.daily(
	"purge stale claim links",
	{ hourUTC: 3, minuteUTC: 45 },
	internal.orderClaims.purgeStaleClaims,
	{},
);

// Log retention (86eyetzt7) — windows live in convex/lib/retention.ts, policy
// table in docs/data-retention.md. Three daily purges; orderEvents (tied to
// order retention, 86eydwct5) and optOuts (a standing legal instruction) are
// deliberately NOT purged.

// outboundMessageLog rows older than 90 days: each expiring row is first
// folded into its messageLogRollups (retailer × MYT month × category × status)
// bucket, so the WhatsApp cost ledger survives in aggregate, then deleted.
crons.daily(
	"purge expired outbound message log",
	{ hourUTC: 4, minuteUTC: 5 },
	internal.wabaProtection.purgeExpiredOutboundLog,
	{},
);

// wabaHealth history older than 90 days — the newest row is ALWAYS kept
// (canSend reads the latest row as the live quality state; purging it would
// fail the gateway open to HIGH).
crons.daily(
	"purge expired waba health history",
	{ hourUTC: 4, minuteUTC: 15 },
	internal.wabaProtection.purgeExpiredWabaHealth,
	{},
);

// adminAuditLog rows older than 24 months (the stated compliance window).
crons.daily(
	"purge expired admin audit log",
	{ hourUTC: 4, minuteUTC: 25 },
	internal.admin.purgeExpiredAdminAudit,
	{},
);

export default crons;
