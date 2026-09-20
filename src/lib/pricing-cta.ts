import { PLANS, type Plan } from "../../convex/lib/plans";
import type { SubscriptionView } from "./subscription";

/**
 * The CTA a pricing tier card should show. Pure so the branch logic can be
 * unit-tested — the signed-in states can't be exercised in the signed-out
 * marketing preview. See src/routes/pricing.tsx.
 *
 * - `coming_soon` — Scale (not purchasable yet); a disabled pill.
 * - `trial` — signed-out visitor; the sign-up trial link.
 * - `dashboard` — signed in but plan not yet resolved (loading) or a storeless
 *    admin; safe fallback to the dashboard, never a wrong upgrade label.
 * - `subscribe` — signed in but NOT an active paying/comped subscriber (trialing,
 *    past_due, cancelled); every tier is a "subscribe to this" action → Billing.
 * - `current` — the tier the seller actively owns (active); disabled pill.
 * - `sponsored` — a comped store (z8r3fdeub2): every live tier is already
 *    included and there's nothing to subscribe to; a disabled pill, never a
 *    link into a billing tab that would refuse the action.
 * - `upgrade` / `manage` — a higher / lower tier than the one they own; both
 *    route to Settings → Billing (the manual contact-Arif flow).
 */
export type TierCtaKind =
	| "coming_soon"
	| "trial"
	| "dashboard"
	| "subscribe"
	| "current"
	| "sponsored"
	| "upgrade"
	| "manage";

export function resolveTierCta(
	tierId: string,
	opts: {
		isScale: boolean;
		isSignedIn: boolean;
		subscription: SubscriptionView | null;
	},
): TierCtaKind {
	const { isScale, isSignedIn, subscription } = opts;
	if (isScale) return "coming_soon";
	if (!isSignedIn) return "trial";
	if (!subscription) return "dashboard";

	// A comped store resolves to the highest tier with unlimited orders and can't
	// subscribe, change or cancel anything (z8r3fdeub2) — no tier is a door.
	if (subscription.comped === true) return "sponsored";

	// `subscription.plan` is the tier being *trialed/held*, not proof of ownership.
	// A trial stamps plan:"pro" the day an account is created (convex/retailers.ts
	// createSubscriptionForRetailer), and past_due/cancelled sellers still carry
	// their old plan. Ownership is real only for an active paid subscriber —
	// anyone else hasn't committed, so every tier is a "subscribe" action into
	// Billing, never a dead "Current plan" pill. See docs/pricing.md.
	const { plan, status } = subscription;
	if (status !== "active") return "subscribe";

	if (plan === tierId) return "current";
	const currentRank = PLANS.indexOf(plan);
	const tierRank = PLANS.indexOf(tierId as Plan);
	// A tier not in PLANS (tierRank === -1) shouldn't happen; treat as "manage"
	// so the seller lands on the billing surface rather than dead-ending.
	return tierRank > currentRank ? "upgrade" : "manage";
}
