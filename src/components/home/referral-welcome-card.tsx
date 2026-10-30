import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Gift } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { usePermission } from "../../hooks/usePermission";
import { referrerLabel } from "../settings/referral-bonus-note";
import { Button } from "../ui/button";

/**
 * Home, for a REFERRED store that hasn't paid its first plan invoice yet
 * (the 28 Oct 2026 push, docs/referrals.md § The push): who invited them
 * and what starting their plan brings, with the door to Billing.
 *
 * This is the "push them to subscribe" moment Zaki asked for, built as a
 * card and not as a redirect: a seller who has just created a store and is
 * bounced straight into Billing meets a paywall before any value, and the
 * trial exists so that value comes first. The card sits ABOVE the welcome
 * card and the checklist — the first thing a referred seller reads — and
 * says the same number the onboarding note and the billing tab say, from
 * the one author (`referrals.mine`). Gone the moment the first invoice is
 * paid; the Credit activity row takes over.
 *
 * Billing:read like the note it mirrors (`referrals.mine` refuses without
 * it), so the read is SKIPPED for a teammate without the grant — the way
 * Home skips its orders-gated reads — rather than fired and left to error:
 * they see nothing here, and can't reach Billing anyway.
 */
export function ReferralWelcomeCard({
	retailerId,
}: {
	retailerId: Id<"retailers">;
}) {
	const billing = usePermission("billing");
	const referral = useQuery(
		convexQuery(api.referrals.mine, billing.canRead ? { retailerId } : "skip"),
	).data;
	if (!referral || referral.firstInvoicePaid) return null;
	const who = referrerLabel(referral);
	return (
		<section
			className="flex flex-col gap-3 rounded-2xl border border-accent/40 bg-accent/5 p-4 sm:flex-row sm:items-center sm:justify-between"
			data-testid="referral-welcome"
			aria-labelledby="referral-welcome-heading"
		>
			<div className="flex items-start gap-3">
				<span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent-emphasis">
					<Gift className="size-5" aria-hidden="true" />
				</span>
				<div className="flex min-w-0 flex-col gap-0.5">
					<p id="referral-welcome-heading" className="text-sm font-semibold">
						{who} invited you — {referral.offer.pro} orders are waiting
					</p>
					<p className="text-[13px] leading-snug text-muted-foreground">
						Start Pro and {referral.offer.pro} free orders land with your first
						invoice ({referral.offer.starter} on Starter). They last 12 months,
						on top of your plan.
					</p>
				</div>
			</div>
			<Button asChild className="h-11 shrink-0">
				{/* Straight to the plan picker, which sits below the fold of the
				    Billing tab — the button promises a plan, not a tab. */}
				<Link
					to="/app/settings"
					search={{ tab: "billing", spot: "choose_plan" }}
				>
					Start your plan
				</Link>
			</Button>
		</section>
	);
}
