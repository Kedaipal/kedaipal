import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Gift, PauseCircle } from "lucide-react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { referralShareMessage } from "../../../convex/lib/referral";
import type { MyReferralCard } from "../../../convex/referrals";
import {
	type FixHighlight,
	highlightRingClass,
} from "../../lib/country-setup-copy";
import { SPOTLIGHT_ANCHOR } from "../../lib/spotlight";
import { cn } from "../../lib/utils";
import { WhatsAppIcon } from "../dashboard/brand-icons";
import { Button } from "../ui/button";

/**
 * Home → "Refer a kedai" (Referral T3, ClickUp z8r3fdfp97, docs/referrals.md).
 *
 * Its OWN section at the foot of Home, not inside the store-link card above
 * it: that card shares the store with BUYERS; this one refers another SELLER
 * to Kedaipal — a different audience and a different message. Last because
 * it is never urgent; every operational card outranks it.
 *
 * Who sees what (Zaki, 7 Oct 2026):
 *  - an ACTIVE paid store: the link, the offer both ways, the counts;
 *  - a COMPED or Kedaipal-owned store: the same, but told plainly it earns
 *    nothing (already unlimited) while its kawan still does;
 *  - a store whose plan is on hold or lapsed: the card stays, PAUSED, with
 *    why and the way back — a link that silently stopped counting would be
 *    the hidden behaviour CLAUDE.md forbids;
 *  - a TRIAL store: nothing — a store refers once its plan is paid.
 *
 * `highlight` is the What's-new deep link's ring (`?spot=refer`,
 * src/lib/spotlight.ts): the section carries the registry anchor so Home can
 * scroll to it, and the card takes the mint ring. The ring class is applied
 * only when asked for — at rest `highlightRingClass` answers `border-input`,
 * which is not this card's border.
 */
export function ReferCard({
	retailerId,
	highlight,
}: {
	retailerId: Id<"retailers">;
	highlight?: FixHighlight;
}) {
	const card = useQuery(convexQuery(api.referrals.myCard, { retailerId })).data;
	// Nothing while loading — not a skeleton: a trial store never shows this
	// card, so a placeholder would promise a section that then vanishes. It is
	// the last thing on Home, so arriving late moves nothing below it.
	if (card === undefined || card === null) return null;
	const { standing } = card;
	if (!standing.canRefer) {
		if (standing.reason === "paused" || standing.reason === "lapsed")
			return <PausedReferCard reason={standing.reason} highlight={highlight} />;
		return null;
	}
	return <LiveReferCard card={card} earns={card.earns} highlight={highlight} />;
}

function Heading({ id }: { id?: string }) {
	return (
		<h2
			id={id}
			className="flex items-center gap-2 font-heading text-lg font-extrabold tracking-tight lg:text-xl"
		>
			<span className="flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-emphasis">
				<Gift className="size-3.5" aria-hidden="true" />
			</span>
			Refer a kedai
		</h2>
	);
}

function LiveReferCard({
	card,
	earns,
	highlight,
}: {
	card: MyReferralCard;
	earns: boolean;
	highlight?: FixHighlight;
}) {
	const [copied, setCopied] = useState(false);
	const waUrl = `https://wa.me/?text=${encodeURIComponent(referralShareMessage(card.link))}`;

	async function copy() {
		try {
			await navigator.clipboard.writeText(card.link);
			setCopied(true);
			setTimeout(() => setCopied(false), 1800);
		} catch {
			// The seller can still read the link off the card.
		}
	}

	return (
		<section
			id={SPOTLIGHT_ANCHOR.refer.anchor}
			className="flex flex-col gap-3 scroll-mt-4"
			aria-labelledby="refer-heading"
		>
			<Heading id="refer-heading" />
			<div
				className={cn(
					"flex flex-col gap-4 rounded-2xl border border-border bg-card p-4",
					highlight ? highlightRingClass(highlight) : undefined,
				)}
			>
				{/* One number for both sides, sized by the tier the kawan starts on
				    (Zaki, 20 Oct 2026) — so the sentence says it once: "and so do
				    you". A comped store's sentence stops at the kawan. */}
				<p className="text-sm leading-relaxed">
					Know another kedai that sells on WhatsApp? When they sign up through
					your link and pay their first invoice, they get{" "}
					<span className="font-semibold">{card.offer.pro} bonus credits</span>{" "}
					on Pro ({card.offer.starter} on Starter)
					{earns ? (
						<>
							{" "}
							— <span className="font-semibold">and so do you</span>.
						</>
					) : (
						"."
					)}
				</p>
				{earns ? null : (
					<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
						Your account is on the house, so there's nothing for you to earn —
						but every kedai you refer still gets their bonus.
					</p>
				)}

				<div className="flex flex-col gap-2">
					<span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
						Your referral link
					</span>
					<span className="flex min-w-0 font-mono text-sm font-medium">
						<span className="shrink-0">kedaipal.com/referral/</span>
						<span className="kp-highlight truncate">{card.slug}</span>
					</span>
					{/* Two equal columns, not two `flex-1`s: the labels differ in
					    length, and flex-basis sizes from content, so "Copy link"
					    came out visibly narrower than its sibling on a phone. */}
					<div className="grid grid-cols-2 gap-2">
						<Button onClick={copy} className="h-11">
							{copied ? "Copied!" : "Copy link"}
						</Button>
						<Button asChild variant="outline" className="h-11 min-w-0">
							{/* "Share on WhatsApp" needs ~173px; a phone column is ~156px.
							    The icon + "WhatsApp" says the same thing there, and the
							    accessible name stays whole at every width. */}
							<a
								href={waUrl}
								target="_blank"
								rel="noopener noreferrer"
								aria-label="Share on WhatsApp"
							>
								<WhatsAppIcon className="size-4" />
								<span className="sm:hidden">WhatsApp</span>
								<span className="hidden sm:inline">Share on WhatsApp</span>
							</a>
						</Button>
					</div>
				</div>

				{card.signedUp === 0 ? (
					<p className="border-t border-border pt-3 text-xs text-muted-foreground">
						No sign-ups through your link yet. The kedai you refer appear here
						once they create their store.
					</p>
				) : (
					<dl
						className={`grid gap-2 border-t border-border pt-3 ${earns ? "grid-cols-3" : "grid-cols-2"}`}
					>
						<Stat
							label="Signed up"
							value={`${card.signedUp}${card.capped ? "+" : ""}`}
						/>
						<Stat label="Started their plan" value={String(card.started)} />
						{earns ? (
							<Stat label="Credits earned" value={String(card.creditsEarned)} />
						) : null}
					</dl>
				)}
				<p className="text-xs text-muted-foreground">
					Bonus credits land when they pay their first invoice, and last 12
					months.
				</p>
			</div>
		</section>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-col gap-0.5">
			<dt className="text-[11px] font-semibold text-muted-foreground">
				{label}
			</dt>
			<dd className="font-heading text-xl font-extrabold tabular-nums">
				{value}
			</dd>
		</div>
	);
}

function PausedReferCard({
	reason,
	highlight,
}: {
	reason: "paused" | "lapsed";
	highlight?: FixHighlight;
}) {
	return (
		<section
			id={SPOTLIGHT_ANCHOR.refer.anchor}
			className="flex flex-col gap-3 scroll-mt-4"
		>
			<Heading />
			<div
				className={cn(
					"flex items-start gap-3 rounded-2xl border border-border bg-card p-4",
					highlight ? highlightRingClass(highlight) : undefined,
				)}
			>
				<PauseCircle
					className="mt-0.5 size-5 shrink-0 text-muted-foreground"
					aria-hidden="true"
				/>
				<div className="flex min-w-0 flex-col gap-2 text-sm">
					<p className="font-semibold">Your referral link is paused</p>
					<p className="text-muted-foreground">
						{reason === "paused"
							? "While your store is on an Off-Season Hold, kedai who sign up through your link don't get a bonus, and neither do you. Resume your plan to turn it back on."
							: "Your plan isn't active, so kedai who sign up through your link don't get a bonus, and neither do you. Renew your plan to turn it back on."}
					</p>
					<Link
						to="/app/settings"
						search={{ tab: "billing" }}
						className="inline-flex min-h-11 w-fit items-center text-sm font-semibold underline-offset-4 hover:underline"
					>
						{reason === "paused" ? "Resume in Billing" : "Renew in Billing"}
					</Link>
				</div>
			</div>
		</section>
	);
}
