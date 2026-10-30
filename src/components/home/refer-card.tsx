import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MyReferralCard } from "../../../convex/referrals";
import {
	type FixHighlight,
	highlightRingClass,
} from "../../lib/country-setup-copy";
import { SPOTLIGHT_ANCHOR } from "../../lib/spotlight";
import { cn } from "../../lib/utils";
import {
	offerHeadline,
	PausedReferNotice,
	PendingLine,
	ReferHeading,
	ReferShareActions,
	TrialReferNotice,
} from "../referrals/refer-sections";

/**
 * Home → "Refer & earn" (Referral T3, ClickUp z8r3fdfp97; reshaped by the
 * 28 Oct 2026 push — docs/referrals.md § The push).
 *
 * Its OWN section at the foot of Home, not inside the store-link card above
 * it: that card shares the store with BUYERS; this one refers another SELLER
 * to Kedaipal — a different audience and a different message. Last because
 * it is never urgent; every operational card outranks it.
 *
 * It is a TEASER now, not the whole programme: the headline in orders, the
 * pending line when a referee is waiting (the one line that gets the card
 * opened), WhatsApp + Copy, and a way into `/app/refer` for the rest. Half
 * the height of the T3 card, and the page carries what it dropped (the
 * three stats, the fine print, the share image and message).
 *
 * Who sees what (Zaki, 7 Oct 2026; the trial line added by the push):
 *  - an ACTIVE paid store: the teaser;
 *  - a COMPED or Kedaipal-owned store: the same, told it earns nothing;
 *  - a store whose plan is on hold or lapsed: PAUSED, with why and the way
 *    back — a link that silently stopped counting would be hidden behaviour;
 *  - a TRIAL store: a dashed "unlocks with your plan" card — the rule is
 *    unchanged (refer once the plan is paid), it is now SAID, because a
 *    feature a seller can't see is one they never plan around.
 *
 * `highlight` is the What's-new deep link's ring (`?spot=refer`,
 * src/lib/spotlight.ts): the section carries the registry anchor so Home can
 * scroll to it, and the card takes the mint ring.
 */
export function ReferCard({
	retailerId,
	highlight,
}: {
	retailerId: Id<"retailers">;
	highlight?: FixHighlight;
}) {
	const card = useQuery(convexQuery(api.referrals.myCard, { retailerId })).data;
	// Nothing while loading — not a skeleton: a storeless reader never shows
	// this card, so a placeholder would promise a section that then vanishes.
	// It is the last thing on Home, so arriving late moves nothing below it.
	if (card === undefined || card === null) return null;
	const { standing } = card;
	const ring = highlight ? highlightRingClass(highlight) : undefined;
	if (!standing.canRefer) {
		if (standing.reason === "trial")
			return (
				<Shell>
					<TrialReferNotice offer={card.offer} className={ring} />
				</Shell>
			);
		if (standing.reason === "paused" || standing.reason === "lapsed")
			return (
				<Shell>
					<PausedReferNotice reason={standing.reason} className={ring} />
				</Shell>
			);
		return null;
	}
	return (
		<Shell seeAll>
			<LiveTeaser card={card} className={ring} />
		</Shell>
	);
}

function Shell({
	seeAll,
	children,
}: {
	seeAll?: boolean;
	children: React.ReactNode;
}) {
	return (
		<section
			id={SPOTLIGHT_ANCHOR.refer.anchor}
			className="flex flex-col gap-3 scroll-mt-4"
			aria-labelledby="refer-heading"
		>
			<div className="flex items-center justify-between gap-3">
				<ReferHeading id="refer-heading" />
				{/* The page is the destination for everything the teaser doesn't
				    hold — but a trial or paused store has nothing more to see
				    there than the notice says, so the link is for live stores. */}
				{seeAll ? (
					<Link
						to="/app/refer"
						className="inline-flex min-h-11 items-center gap-0.5 text-[13px] font-semibold underline-offset-4 hover:underline"
					>
						See all
						<ChevronRight className="size-4" aria-hidden="true" />
					</Link>
				) : null}
			</div>
			{children}
		</section>
	);
}

function LiveTeaser({
	card,
	className,
}: {
	card: MyReferralCard;
	className?: string;
}) {
	const summary =
		card.signedUp === 0
			? "No sign-ups through your link yet — the kedai you refer appear on the Refer & earn page the moment they create their store."
			: [
					`${card.signedUp}${card.capped ? "+" : ""} signed up`,
					`${card.started} started`,
					...(card.earns ? [`${card.creditsEarned} orders earned`] : []),
				].join(" · ");
	return (
		<div
			className={cn(
				"flex flex-col gap-3 rounded-2xl border border-border bg-card p-4",
				className,
			)}
		>
			<p className="font-heading text-[17px] font-extrabold leading-snug tracking-tight">
				{offerHeadline(card)}
			</p>
			{card.earns ? null : (
				<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
					Your account is on the house, so there's nothing for you to earn — but
					every kedai you refer still gets their bonus.
				</p>
			)}
			<PendingLine card={card} />
			<ReferShareActions card={card} surface="home" />
			<p className="text-xs text-muted-foreground">{summary}</p>
		</div>
	);
}
