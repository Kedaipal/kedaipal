/**
 * Seller-to-seller referral (ClickUp z8r3fdetf5 / 86ey82hke / z8r3fdfp97,
 * terms re-scoped by Zaki 7 Oct 2026 — docs/referrals.md) — the PURE rules.
 * No Convex imports, so the signup mutation, the reward grant, the public
 * invite page, the dashboard card and the tests all read one author of every
 * rule below.
 *
 * The programme in one paragraph: a seller on an ACTIVE plan forwards
 * `kedaipal.com/referral/<their-slug>`. A seller who signs up through it is
 * recorded as their referee (`referrals` table). When the referee pays their
 * FIRST plan invoice, BOTH sides get bonus credits — 30% of a month of their
 * own tier's list grant — in the purchased bucket, so they last 12 months.
 * There is no subscription discount anywhere: rewards are credits only.
 *
 * Three rules are load-bearing and live here so no surface can drift:
 *  - the link IS the code. No typed codes, and a link only counts when the
 *    store behind it can refer RIGHT NOW (`referrerStanding`) — so the URL
 *    pattern is never a public coupon;
 *  - who referred whom comes from the `referrals` row, never parsed back out
 *    of the `referral-<slug>` analytics tag (`referralSourceTag` truncates at
 *    32 chars, and a slug can be 32 on its own);
 *  - the reward size is the LIST grant, Enterprise counted as Pro, so no
 *    reward can outgrow the revenue that triggered it (a literal 30% of a
 *    1,500-credit contract would hand out 450 credits for a RM79 referee).
 */

import { sanitizeAttributionSource } from "./attribution";
import type { CreditBillingStatus } from "./credits";
import { isListedPlan, type ListedPlan, PLAN_CREDIT_GRANT, type Plan } from "./plans";
import { MARKETING_SITE_URL, sanitizeReferrerSlug } from "./poweredBy";

/** The marketing route a referral link lands on: `/referral/<slug>`. `referral`
 * is a reserved slug (`reservedSlugs.ts`), so no store can shadow it. */
export const REFERRAL_PATH = "/referral";

/** Prefix of the analytics tag a referral signup carries (`referral-<slug>`),
 * the convention docs/analytics.md reserves. */
export const REFERRAL_SOURCE_PREFIX = "referral-";

/** The share of a month's list grant each side receives — a whole percent so
 * the arithmetic stays in integers (`200 * 0.3` is 60.00000000000001). */
export const REFERRAL_REWARD_PERCENT = 30;

/** The referral link a seller shares — absolute, because it travels outside
 * the app (WhatsApp, Instagram). One author for the URL shape. */
export function referralHref(slug: string): string {
	return `${MARKETING_SITE_URL}${referralPath(slug)}`;
}

/** The in-app path of a referral link (router-relative). */
export function referralPath(slug: string): string {
	return `${REFERRAL_PATH}/${slug}`;
}

/**
 * The `signupSource` tag a referral visit carries. Sanitized like every other
 * tag, so a long slug TRUNCATES here — which is why the referrer's identity
 * never comes from this string (it rides `store=` and lands on the
 * `referrals` row).
 */
export function referralSourceTag(slug: string): string {
	return sanitizeAttributionSource(`${REFERRAL_SOURCE_PREFIX}${slug}`) ?? "other";
}

/** Whether a stored `signupSource` came through a referral link. Analytics
 * only — the reward reads the `referrals` row, never this. */
export function isReferralSource(src: string | undefined): boolean {
	return src?.startsWith(REFERRAL_SOURCE_PREFIX) === true;
}

/**
 * Bonus credits for one side of a referral: 30% of a month of the tier's LIST
 * grant — Starter 30, Pro 60. Enterprise (no list grant — its credits are a
 * per-deal contract) counts as Pro, and so does a Founding Pro store (300 a
 * month for life): a referral is worth the same to every store on the same
 * tier, and the card, the invite page and the share message can quote fixed
 * numbers.
 */
export function referralRewardCredits(plan: Plan): number {
	const listed: ListedPlan = isListedPlan(plan) ? plan : "pro";
	return Math.floor((PLAN_CREDIT_GRANT[listed] * REFERRAL_REWARD_PERCENT) / 100);
}

/** What a referee is offered, per tier they might start on — the invite
 * page, onboarding and the plan picker all quote this pair. */
export function referralRefereeOffer(): Record<ListedPlan, number> {
	return {
		starter: referralRewardCredits("starter"),
		pro: referralRewardCredits("pro"),
	};
}

/** Why a store's referral link doesn't count right now. */
export type ReferrerIneligibleReason =
	/** On the free trial — refer once the plan is paid (Zaki, 7 Oct 2026). */
	| "trial"
	/** On an Off-Season Hold — ordering is off, so is referring. */
	| "paused"
	/** Past due or cancelled. */
	| "lapsed"
	/** A pre-built store nobody has claimed yet — nobody to refer from. */
	| "unclaimed"
	/** No subscription row at all (the fail-safe state). */
	| "no_plan";

/**
 * Whether a store can refer, and whether it earns a reward when it does.
 *
 *  - ACTIVE paid plan → refers, earns.
 *  - COMPED (partners, sponsors) → refers, earns NOTHING: their account is
 *    already unlimited, but their referee still gets the referee reward.
 *  - An ADMIN-owned store (Kedaipal's own, never billed) → same as comped.
 *  - Trial, hold, past due, cancelled, unclaimed, no row → cannot refer; a
 *    signup through such a link records no referral and promises nothing.
 *
 * A zero credit balance is irrelevant — credit state is not a plan state.
 */
export type ReferrerStanding =
	| { canRefer: true; earnsReward: boolean }
	| { canRefer: false; reason: ReferrerIneligibleReason };

export function referrerStanding(args: {
	status: CreditBillingStatus;
	comped: boolean;
	ownerIsAdmin: boolean;
	unclaimed: boolean;
}): ReferrerStanding {
	if (args.unclaimed) return { canRefer: false, reason: "unclaimed" };
	if (args.comped || args.ownerIsAdmin)
		return { canRefer: true, earnsReward: false };
	switch (args.status) {
		case "active":
			return { canRefer: true, earnsReward: true };
		case "trialing":
			return { canRefer: false, reason: "trial" };
		case "on_hold":
			return { canRefer: false, reason: "paused" };
		case "past_due":
		case "cancelled":
			return { canRefer: false, reason: "lapsed" };
		case null:
			return { canRefer: false, reason: "no_plan" };
	}
}

/**
 * The WhatsApp message the Refer & earn surfaces pre-fill (T3, z8r3fdfp97;
 * personalised in the 28 Oct 2026 push) — one author, so copy changes never
 * touch a component. Three rules, each a lesson:
 *  - the STORE'S OWN NAME comes first. "I run Kek Mak Jah on Kedaipal" is a
 *    friend vouching; "I use Kedaipal" is an ad. The unfurl card below the
 *    message already says "Kek Mak Jah invited you", so the two agree;
 *  - the offer is said in ORDERS ("60 free orders"), the unit a seller thinks
 *    in — "bonus credits" needed a conversion the prospect wouldn't make;
 *  - the link is the LAST line, on its own, so WhatsApp renders the invite
 *    page's preview card under the text instead of burying the URL.
 * The house register: "refer", "kedai", orders — never "commission",
 * "affiliate" or a money amount.
 */
export function referralShareMessage(link: string, storeName: string): string {
	const offer = referralRefereeOffer();
	const name = storeName.trim() || "my kedai";
	return `Hi! I run ${name} on Kedaipal now — no more orders lost in the WhatsApp chat, and payments are tracked for me.\n\nSign up through my link and you get ${offer.pro} free orders when you start Pro (${offer.starter} on Starter):\n${link}`;
}

/**
 * The share IMAGE's lines (the 1080² card a seller posts to an Instagram
 * story, a Facebook seller group or a WhatsApp status — places a text link
 * can't travel). Same offer, same author; the canvas only draws them.
 */
export function referralShareImageCopy(storeName: string): {
	eyebrow: string;
	headline: string;
	body: string;
} {
	const offer = referralRefereeOffer();
	return {
		eyebrow: `${storeName.trim() || "A Kedaipal seller"} invites you`,
		headline: `${offer.pro} orders on us.`,
		body: `Run your WhatsApp orders on Kedaipal. Start Pro through my link and your first ${offer.pro} orders are free (${offer.starter} on Starter).`,
	};
}

/**
 * One person, two stores? A self-referral is the one way to farm the
 * programme: pay a first invoice on a second login and collect both halves.
 * The guard is the referee sharing the referrer's contact — the owner's email
 * or the store's WhatsApp number — which a second account for the same
 * business almost always does. Not airtight (a fresh email and number slip
 * through), but a real RM79+ invoice buys at most ~90 credits, so there is
 * little left to game. The referee still gets THEIR half: they are a paying
 * store either way; only the referrer's half is withheld.
 */
export function looksLikeSelfReferral(args: {
	refereeEmails: Array<string | undefined>;
	refereePhone: string | undefined;
	referrerEmails: Array<string | undefined>;
	referrerPhone: string | undefined;
}): boolean {
	const norm = (list: Array<string | undefined>) =>
		new Set(
			list
				.filter((e): e is string => typeof e === "string" && e.trim() !== "")
				.map((e) => e.trim().toLowerCase()),
		);
	const a = norm(args.refereeEmails);
	for (const e of norm(args.referrerEmails)) if (a.has(e)) return true;
	const digits = (p: string | undefined) => (p ?? "").replace(/\D/g, "");
	const rp = digits(args.refereePhone);
	return rp.length > 0 && rp === digits(args.referrerPhone);
}

/**
 * What a referee types or pastes into onboarding's "Referred by" field,
 * reduced to the store slug: a bare slug, the full
 * `https://kedaipal.com/referral/<slug>` link, or the storefront link
 * `kedaipal.com/<slug>` all resolve to `<slug>`. Shape-checked only — whether
 * a store can refer is the server's answer (`referrals.invite`).
 */
export function parseReferralInput(raw: string): string | undefined {
	let s = raw.trim();
	if (s === "") return undefined;
	s = s.replace(/[?#].*$/, "").replace(/\/+$/, "");
	const slash = s.lastIndexOf("/");
	if (slash >= 0) s = s.slice(slash + 1);
	return sanitizeReferrerSlug(s);
}
