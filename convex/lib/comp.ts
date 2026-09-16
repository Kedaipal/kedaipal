// Comp accounts (z8r3fdeub2) — the pure rules shared by the server
// (subscriptions.setComp / revokeComp, the cron) and the client (the admin
// comp dialog, chips, banner, tier pill, billing tab). No Convex imports,
// mirroring lib/plans.ts.
//
// A comp is a SUBSCRIPTION STATE, not a user type: `subscriptions.comped` is
// the read seam every consumer already gates on (cron skips, self-serve
// refuses, meter hides), and the `comp` object stamps who/why/until so an
// admin grant survives the backfill and can end on a date.
//
// What a comp GRANTS mirrors a Kedaipal admin on their own store: the highest
// tier's features and unlimited orders, never billed, never soft-locked — and
// nothing to subscribe to, change or pause. When it ENDS (revoked by an admin,
// or its end date passes) the store becomes an EXPIRED seller: `past_due`
// with no invoice, exactly the lock a lapsed subscription is in — storefront
// and buyer ordering stay live, dashboard growth-writes are refused until the
// seller picks a plan and pays.

import { capsForPlan, type Plan, type PlanCaps, UNLIMITED } from "./plans";

export type CompKind = "partner" | "sponsor" | "pilot" | "internal";

export const COMP_KINDS: CompKind[] = [
	"partner",
	"sponsor",
	"pilot",
	"internal",
];

/** Dialog + chip label per kind — capitalised, in the admin's words. */
export const COMP_KIND_LABEL: Record<CompKind, string> = {
	partner: "Partner",
	sponsor: "Sponsor",
	pilot: "Pilot",
	internal: "Internal",
};

/** Seller-facing sponsor line, e.g. "Sponsored by Maybank SME". Short enough
 * for the directory chip and the billing tab's one-liner. */
export const COMP_LABEL_MAX = 60;

/** Admin-only context (deal terms, contact person). Never on seller payloads. */
export const COMP_NOTE_MAX = 500;

/** How a comp ended — `revoked` by an admin, or `expired` at its end date. */
export type CompEndReason = "revoked" | "expired";

/** The tier whose FEATURES a comped store resolves to — the highest, exactly
 * what `resolveAccess` grants an admin on their own store. The stored `plan`
 * is left alone: it's what the store's plan picker defaults to once the comp
 * ends, not what the comp grants. */
export const COMP_FEATURE_PLAN: Plan = "scale";

/** Entitlement caps a comped store resolves to. Orders are UNLIMITED — the
 * point of a sponsorship. Seats and broadcasts take the highest tier's
 * allowance rather than unlimited: both cost Kedaipal real money per use the
 * day they're enforced (broadcasts are billed WhatsApp sends on the shared
 * WABA), so "unlimited" there is a decision for when they ship, not a default.
 * Resolved at read time (like a hold's effective order cap of 0), never
 * stored, so a revoke needs no cap rewrite. */
export function compedCaps(): PlanCaps {
	return { ...capsForPlan(COMP_FEATURE_PLAN), orderCap: UNLIMITED };
}

/** Days before a dated comp ends that the seller is warned — once by email
 * (the daily cron) and by a dismissable dashboard banner. A week, not the
 * trial's 3–5 days: a comp ending LOCKS editing the same day (no invoice
 * grace), so the seller needs time to decide on a plan. */
export const COMP_ENDING_WARN_DAYS = 7;

/** Whole days until a comp's end, rounded up (a comp ending later today reads
 * "1 day"); never negative. */
export function compDaysLeft(expiresAt: number, now: number): number {
	return Math.max(0, Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000)));
}

/** True while a dated comp is inside its warning window (and not yet over). */
export function compEndingSoon(
	expiresAt: number | undefined,
	now: number,
): boolean {
	if (expiresAt === undefined || expiresAt <= now) return false;
	return compDaysLeft(expiresAt, now) <= COMP_ENDING_WARN_DAYS;
}
