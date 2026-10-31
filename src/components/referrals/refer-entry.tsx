/**
 * "Refer & earn" as an ENTRY POINT — the one control that opens `/app/refer`
 * from wherever a seller already is (Zaki, 31 Oct 2026: referrals belong in
 * the first view of Home, not at the foot of it). Three places, one look and
 * one set of words:
 *
 *  - the profile menu's featured row (`ReferEntryRow` inside a menu item);
 *  - Home's header, beside Open store and New order, on desktop
 *    (`HomeReferButton`);
 *  - Home, under the greeting, on a phone (`ReferEntryRow`) — the header
 *    buttons are desktop-only there, so the menu's row takes their place.
 *
 * The page (`/app/refer`) holds everything the old Home card did — the link,
 * WhatsApp and Copy, the stats, the fine print — so the card is gone and these
 * are doors to it. A referee waiting on their first invoice is the one piece
 * of news worth a badge ("1 waiting"); a store that can't refer yet still sees
 * the door, with why, because the page explains itself to a trial or paused
 * store.
 */

import type { FunctionReturnType } from "convex/server";
import { ChevronRight, Gift } from "lucide-react";
import type { api } from "../../../convex/_generated/api";
import { TONE_CHIP } from "../../lib/tone";
import { cn } from "../../lib/utils";

export type ReferEntryCard = NonNullable<
	FunctionReturnType<typeof api.referrals.myCard>
>;

/** The row's second line — the profile menu and the phone row. */
export function referEntryLine(card: ReferEntryCard): string {
	const offer = card.offer.pro;
	if (!card.standing.canRefer)
		return card.standing.reason === "paused" ||
			card.standing.reason === "lapsed"
			? "Paused until your plan is active again"
			: "Starts once your plan is active";
	return card.earns
		? `Refer a kedai, you both get ${offer} free orders`
		: `Refer a kedai, they get ${offer} free orders`;
}

/** The header button's short tail, beside "Refer & earn". */
export function referEntryHint(card: ReferEntryCard): string {
	const offer = card.offer.pro;
	if (!card.standing.canRefer)
		return card.standing.reason === "paused" ||
			card.standing.reason === "lapsed"
			? "paused"
			: "starts with your plan";
	return card.earns ? `${offer} free orders each` : `they get ${offer}`;
}

/** A referee who signed up and hasn't paid their first invoice yet — the
 * news that brings a seller back to the page. Amber through `TONE_CHIP.warn`,
 * the same chip the page's own waiting rows wear (one idea, one control). */
function WaitingBadge({ count }: { count: number }) {
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
				TONE_CHIP.warn,
			)}
			data-testid="refer-waiting"
		>
			<span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
			{count} waiting
		</span>
	);
}

/** The featured row's look: icon tile, name, line, then the waiting badge or
 * a chevron. Its parent is the link (a menu item, or Home's own). */
export const REFER_ROW_CLASS =
	"flex min-h-12 items-center gap-2.5 rounded-[10px] border border-dashed border-accent/35 bg-accent/10 px-2.5 py-2";

export function ReferEntryRowContent({ card }: { card: ReferEntryCard }) {
	return (
		<>
			<span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-card text-accent-emphasis">
				<Gift className="size-4" aria-hidden />
			</span>
			<span className="flex min-w-0 flex-1 flex-col leading-tight">
				<span className="text-xs font-semibold text-foreground">
					Refer &amp; earn
				</span>
				<span className="text-[11px] text-accent-emphasis">
					{referEntryLine(card)}
				</span>
			</span>
			{card.pending > 0 && card.standing.canRefer ? (
				<WaitingBadge count={card.pending} />
			) : (
				<ChevronRight className="size-3.5 text-accent-emphasis" aria-hidden />
			)}
		</>
	);
}

/** Home's header button (desktop): the same door, sized to sit beside Open
 * store and New order. */
export function HomeReferButtonContent({ card }: { card: ReferEntryCard }) {
	return (
		<>
			<Gift className="size-4" aria-hidden />
			Refer &amp; earn
			{card.pending > 0 && card.standing.canRefer ? (
				<WaitingBadge count={card.pending} />
			) : (
				<span className="text-xs font-medium text-muted-foreground">
					· {referEntryHint(card)}
				</span>
			)}
		</>
	);
}

export const HOME_REFER_BUTTON_CLASS =
	"inline-flex h-10 items-center gap-2 rounded-lg border border-dashed border-accent/50 bg-accent/10 px-3 text-sm font-semibold text-accent-emphasis outline-none transition-colors hover:bg-accent/15 focus-visible:ring-3 focus-visible:ring-ring/50";
