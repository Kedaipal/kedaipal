import type { ReferralInvite } from "../../convex/referrals";

/**
 * The link-preview copy for a live referral invite (z8r3fdetf5) — what
 * WhatsApp shows under a forwarded `kedaipal.com/referral/<slug>`. English:
 * link unfurlers don't carry the visitor's locale, and a store name reads the
 * same in every one. Numbers come from the invite (one author,
 * `referralRefereeOffer`), never typed here.
 */
export function referralMeta(invite: ReferralInvite): {
	title: string;
	description: string;
} {
	return {
		title: `${invite.storeName} invited you to Kedaipal`,
		description: `Get ${invite.offer.pro} bonus credits when you start Pro, or ${invite.offer.starter} on Starter. Sell on WhatsApp and never lose an order or a payment.`,
	};
}
