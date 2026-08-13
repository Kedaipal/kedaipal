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
 * - `current` — the tier the seller actively owns (active/comped); disabled pill.
 * - `upgrade` / `manage` — a higher / lower tier than the one they own; both
 *    route to Settings → Billing (the manual contact-Arif flow).
 */
export type TierCtaKind =
	| "coming_soon"
	| "trial"
	| "dashboard"
	| "subscribe"
	| "current"
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

	// `subscription.plan` is the tier being *trialed/held*, not proof of ownership.
	// A trial stamps plan:"pro" the day an account is created (convex/retailers.ts
	// createSubscriptionForRetailer), and past_due/cancelled sellers still carry
	// their old plan. Ownership is real only for an active paid subscriber or a
	// comped account — anyone else hasn't committed, so every tier is a "subscribe"
	// action into Billing, never a dead "Current plan" pill. See docs/pricing.md.
	const { plan, status, comped } = subscription;
	const owns = status === "active" || comped === true;
	if (!owns) return "subscribe";

	if (plan === tierId) return "current";
	const currentRank = PLANS.indexOf(plan);
	const tierRank = PLANS.indexOf(tierId as Plan);
	// A tier not in PLANS (tierRank === -1) shouldn't happen; treat as "manage"
	// so the seller lands on the billing surface rather than dead-ending.
	return tierRank > currentRank ? "upgrade" : "manage";
}
