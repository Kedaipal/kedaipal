import { Gift } from "lucide-react";
import type { ListedPlan } from "../../../convex/lib/plans";
import type { MyReferral } from "../../../convex/referrals";

/** Who referred them, for the copy — a deleted referrer's referral stands. */
export function referrerLabel(referral: MyReferral): string {
	return referral.referrerName ?? "a Kedaipal seller";
}

/**
 * Settings → Billing, for a REFERRED store that hasn't paid its first plan
 * invoice yet (z8r3fdetf5): the bonus credits that invoice brings. Said where
 * the money decision is made — on the first invoice itself (with the exact
 * number for its plan), or above the plan picker (both numbers) — because the
 * bonus depends on the tier they pay for. Silent once the first invoice is
 * paid: the reward has landed (or not) and the Credit activity list says so.
 */
export function ReferralBonusNote({
	referral,
	plan,
}: {
	referral: MyReferral;
	/** The invoice's plan, when there is one to pay. */
	plan?: ListedPlan;
}) {
	if (referral.firstInvoicePaid) return null;
	const who = referrerLabel(referral);
	return (
		<p className="flex items-start gap-2 rounded-lg bg-accent/10 px-3 py-2 text-xs text-foreground">
			<Gift className="mt-px size-3.5 shrink-0 text-accent" aria-hidden />
			<span>
				{plan ? (
					<>
						Referred by <span className="font-medium">{who}</span> — pay this
						invoice and {referral.offer[plan]} bonus credits land in your
						balance. They last 12 months.
					</>
				) : (
					<>
						Referred by <span className="font-medium">{who}</span> — your first
						invoice comes with bonus credits: {referral.offer.pro} on Pro,{" "}
						{referral.offer.starter} on Starter. They last 12 months.
					</>
				)}
			</span>
		</p>
	);
}
