import type { Country } from "../../convex/lib/country";
import {
	DAY_MS,
	formatFulfilmentDate,
	todayMytMidnight,
	weekdayIndexMyt,
} from "../../convex/lib/fulfilmentDate";
import { WEEKDAY_NAMES_SHORT } from "../../convex/lib/openingHours";
import type { ShowcaseTheme } from "../../convex/lib/showcase";
import type { MarketplaceStoreCard } from "../../convex/marketplace";
import type { PublicShowcase } from "../../convex/showcases";

/**
 * Marketplace showcase derivations for the buyer page (z8r3fdr6mv) — pure,
 * so the time chip, the member join and the stage split are unit-tested off
 * the DOM. The server sends every LIVE showcase in one payload
 * (`showcases.listShowcases`) with member SLUGS; everything the page does
 * with it happens here.
 */

/** One ticket on the stage: the directory's card for the store, plus what
 * the showcase adds to it (a booth label, the store's own cover). */
export type ShowcaseTicketData = {
	card: MarketplaceStoreCard;
	label?: string;
	coverImageUrl?: string;
};

/** The theme's CSS class — the palette is variables on it (styles.css). */
export function showcaseThemeClass(theme: ShowcaseTheme): string {
	return `kp-showcase kp-showcase-${theme}`;
}

/**
 * Join a showcase's members to the directory's cards. A member whose slug the
 * directory doesn't carry is dropped: the server already applied the
 * listable rule, so this only happens in the moment between a store leaving
 * the directory and the showcase payload catching up — and a ticket for a
 * store the page can't link to would be a dead end. Showcase order is kept
 * (it is the admin's order).
 */
export function joinShowcaseMembers(
	showcase: PublicShowcase,
	cards: MarketplaceStoreCard[],
): ShowcaseTicketData[] {
	const bySlug = new Map(cards.map((c) => [c.slug, c]));
	const out: ShowcaseTicketData[] = [];
	for (const member of showcase.members) {
		const card = bySlug.get(member.slug);
		if (!card) continue;
		out.push({
			card,
			label: member.label,
			coverImageUrl: member.coverImageUrl,
		});
	}
	return out;
}

/** The showcases a buyer in this region should see — regions never blend,
 * the directory's own rule. */
export function showcasesForRegion(
	showcases: PublicShowcase[],
	region: Country,
): PublicShowcase[] {
	return showcases.filter((s) => s.country === region);
}

/**
 * Desktop stage: how many tickets stand on the grid before the rest go into
 * the pile. Five tickets + the pile cell fill a 2 × 3 grid exactly; a sixth
 * store on its own would leave the pile cell empty and the grid ragged.
 */
export const STAGE_GRID_TICKETS = 5;

/**
 * The pile fans out the REAL remaining tickets, so its count is honest — but
 * a 20-deep fan is unreadable, so past this many the fan stops growing and
 * the badge carries the number ("+12 more").
 */
export const PILE_FAN_MAX = 5;

/**
 * Split the stage: the tickets that stand on the grid, and the ones that go
 * into the pile. With one store over the grid, that store is shown rather
 * than piled alone — a pile of one is a ticket with a badge on it, which is
 * both odd and worse than just showing the ticket.
 */
export function splitStage(tickets: ShowcaseTicketData[]): {
	shown: ShowcaseTicketData[];
	pile: ShowcaseTicketData[];
} {
	if (tickets.length <= STAGE_GRID_TICKETS + 1)
		return { shown: tickets, pile: [] };
	return {
		shown: tickets.slice(0, STAGE_GRID_TICKETS),
		pile: tickets.slice(STAGE_GRID_TICKETS),
	};
}

/**
 * The window as two short facts for the banner.
 *
 * `live` is the chip ("Happening now", or how long is left — "Ends today",
 * "Ends tomorrow", "Until Sun"/"Until 18 Oct"); `range` is the dates
 * ("16–18 Oct"), or just the end when there is no start. A showcase with no
 * dates at all gets the chip and no range: it is simply on.
 *
 * Day arithmetic is in MYT, the house clock for dates (fulfilmentDate.ts).
 */
export function showcaseTimeFacts(
	showcase: Pick<PublicShowcase, "startsAt" | "endsAt">,
	now: number,
): { live: string; range?: string } {
	// With no start there is no range to print — the live chip already says
	// "Until Fri", and "Until 16 Oct" beside it would be the same fact twice.
	const range =
		showcase.startsAt !== undefined
			? dateRange(showcase.startsAt, showcase.endsAt)
			: undefined;
	if (showcase.endsAt === undefined) return { live: "Happening now", range };
	const today = todayMytMidnight(now);
	// The end is exclusive; the showcase's last DAY is the day before the end
	// instant when it ends at a midnight, so judge the day that contains the
	// final millisecond.
	const lastDay = todayMytMidnight(showcase.endsAt - 1);
	const daysAhead = Math.round((lastDay - today) / DAY_MS);
	if (daysAhead <= 0) return { live: "Ends today", range };
	if (daysAhead === 1) return { live: "Ends tomorrow", range };
	if (daysAhead < 7)
		return {
			live: `Until ${WEEKDAY_NAMES_SHORT[weekdayIndexMyt(lastDay)]}`,
			range,
		};
	return {
		live: `Until ${formatFulfilmentDate(lastDay, { weekday: false, year: false })}`,
		range,
	};
}

/** "16–18 Oct", "16 Oct – 3 Nov", "Until 3 Nov", or nothing. */
export function dateRange(
	startsAt: number | undefined,
	endsAt: number | undefined,
): string | undefined {
	const last = endsAt !== undefined ? todayMytMidnight(endsAt - 1) : undefined;
	const short = (epoch: number) =>
		formatFulfilmentDate(epoch, { weekday: false, year: false });
	if (startsAt !== undefined && last !== undefined) {
		const a = new Date(startsAt + 8 * 60 * 60 * 1000);
		const b = new Date(last + 8 * 60 * 60 * 1000);
		if (
			a.getUTCMonth() === b.getUTCMonth() &&
			a.getUTCDate() !== b.getUTCDate()
		)
			return `${a.getUTCDate()}–${short(last)}`;
		if (a.getUTCMonth() === b.getUTCMonth()) return short(last);
		return `${short(startsAt)} – ${short(last)}`;
	}
	if (last !== undefined) return `Until ${short(last)}`;
	if (startsAt !== undefined) return `From ${short(startsAt)}`;
	return undefined;
}

/** The ticket's one-line "where" under the name — the booth label when the
 * admin gave one, else the store's area. */
export function ticketPlace(ticket: ShowcaseTicketData): string | undefined {
	return ticket.label ?? ticket.card.storeArea;
}

/** The `/stores?showcase=` link for a showcase — one author, used by the
 * stage's "See all", the seller's card and the admin's copy button. */
export function showcasePath(slug: string): string {
	return `/stores?showcase=${encodeURIComponent(slug)}`;
}
