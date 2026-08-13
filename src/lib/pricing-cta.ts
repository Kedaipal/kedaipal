import { PLANS, type Plan } from "../../convex/lib/plans";

/**
 * The CTA a pricing tier card should show. Pure so the branch logic can be
 * unit-tested — the signed-in states (upgrade / current / manage) can't be
 * exercised in the signed-out marketing preview. See src/routes/pricing.tsx.
 *
 * - `coming_soon` — Scale (not purchasable yet); a disabled pill.
 * - `trial` — signed-out visitor; the sign-up trial link.
 * - `dashboard` — signed in but plan not yet resolved (loading) or a storeless
 *    admin; safe fallback to the dashboard, never a wrong upgrade label.
 * - `current` — the seller's current tier; a disabled "Current plan" pill.
 * - `upgrade` / `manage` — a higher / lower tier than the seller's current one;
 *    both route to Settings → Billing, which owns the manual contact-Arif flow.
 */
export type TierCtaKind =
	| "coming_soon"
	| "trial"
	| "dashboard"
	| "current"
	| "upgrade"
	| "manage";

export function resolveTierCta(
	tierId: string,
	opts: { isScale: boolean; isSignedIn: boolean; currentPlan: Plan | null },
): TierCtaKind {
	const { isScale, isSignedIn, currentPlan } = opts;
	if (isScale) return "coming_soon";
	if (!isSignedIn) return "trial";
	if (currentPlan == null) return "dashboard";
	if (currentPlan === tierId) return "current";
	const currentRank = PLANS.indexOf(currentPlan);
	const tierRank = PLANS.indexOf(tierId as Plan);
	// A tier not in PLANS (tierRank === -1) shouldn't happen, but treating it as
	// "manage" keeps the seller on the billing surface rather than dead-ending.
	return tierRank > currentRank ? "upgrade" : "manage";
}
