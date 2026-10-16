import type { CSSProperties } from "react";
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
import {
	type MarketplaceChip,
	matchesChip,
	matchesSearch,
} from "./marketplace";
import { customShowcasePalette } from "./showcase-color";

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
	return SHOWCASE_THEME_CLASS[theme];
}

/**
 * Everything an element needs to wear a showcase's look: the theme class,
 * and — for the `custom` look — the palette derived from its colour as
 * inline variables (a colour picked on a wheel can't be a pre-written
 * class). Every surface that paints a showcase ground goes through this, so
 * a custom look can't render as Campfire on one of them.
 */
export function showcaseLook(look: {
	theme: ShowcaseTheme;
	customColor?: string;
}): { className: string; style?: CSSProperties } {
	return {
		className: SHOWCASE_THEME_CLASS[look.theme],
		style:
			look.theme === "custom" && look.customColor
				? (customShowcasePalette(look.customColor) as CSSProperties)
				: undefined,
	};
}

/**
 * Every theme's class, spelled out IN FULL. Tailwind only emits a utility it
 * can find written in the source — a class assembled at runtime
 * (`kp-showcase-${theme}`) is never generated, and every showcase silently
 * rendered as the base (Campfire) palette until the hands-on test caught it.
 * `showcase.test.ts` fails if a theme is missing here or in styles.css.
 */
export const SHOWCASE_THEME_CLASS: Record<ShowcaseTheme, string> = {
	campfire: "kp-showcase kp-showcase-campfire",
	festive: "kp-showcase kp-showcase-festive",
	ocean: "kp-showcase kp-showcase-ocean",
	sunset: "kp-showcase kp-showcase-sunset",
	midnight: "kp-showcase kp-showcase-midnight",
	kedaipal: "kp-showcase kp-showcase-kedaipal",
	plain: "kp-showcase kp-showcase-plain",
	custom: "kp-showcase kp-showcase-custom",
};

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

/** A showcase that has stores matching the buyer's search/chip: its matching
 * tickets, and how many it carries in all (for "2 of 14 stores match"). */
export type ShowcaseMatch = {
	showcase: PublicShowcase;
	tickets: ShowcaseTicketData[];
	total: number;
};

/**
 * A refined `/stores` (search or chip) keeps each showcase's stores INSIDE
 * their showcase — a buyer who searches "Bearcamp" during Campfest finds it
 * on its Campfest ticket, booth label and all, not as a plain row that lost
 * the reason it was there. The rule:
 *
 * - a ticket matches on the directory's own rule (`matchesSearch` +
 *   `matchesChip`), plus its booth label, which only the ticket prints;
 * - a showcase with no matching ticket is not shown at all (a banner over
 *   nothing is a dead end);
 * - the focused showcase (`?showcase=`) leads, the rest keep admin order;
 * - a store in two showcases matches in BOTH — each ticket carries that
 *   event's booth, which is real information, not a duplicate;
 * - `slugs` is every matched store, which the plain Results list leaves out
 *   so a store never appears twice in one short list. Only while refining:
 *   the unrefined "All stores" keeps every store (`partitionStores`' rule).
 */
export function matchShowcases(
	showcases: ReadonlyArray<{
		showcase: PublicShowcase;
		tickets: ShowcaseTicketData[];
	}>,
	opts: { chip: MarketplaceChip; search: string; now: number },
	focusedSlug?: string,
): { matches: ShowcaseMatch[]; slugs: Set<string> } {
	const matches: ShowcaseMatch[] = [];
	const slugs = new Set<string>();
	for (const { showcase, tickets } of showcases) {
		const hit = tickets.filter(
			(t) =>
				matchesSearch(t.card, opts.search, [t.label]) &&
				matchesChip(t.card, opts.chip, opts.now),
		);
		if (hit.length === 0) continue;
		for (const t of hit) slugs.add(t.card.slug);
		const match = { showcase, tickets: hit, total: tickets.length };
		if (showcase.slug === focusedSlug) matches.unshift(match);
		else matches.push(match);
	}
	return { matches, slugs };
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
 * Which region a `/stores` visit shows, and whether a `?showcase=` link is
 * truly gone. The SHOWCASE's own country is authoritative for its link: a
 * booth QR at a Malaysian event scanned by an SG phone (roaming SIM, a VPN, an
 * SG pick from an earlier visit) must open that showcase, not say "that
 * showcase isn't on right now" over the SG directory — while its WhatsApp
 * unfurl names the event. The override is for THIS visit only, derived, never
 * written to the visitor's stored pick (which also sets their currency on the
 * pricing pages). `missing` is reserved for a slug that matches no live
 * showcase at all: ended, unpublished, or mistyped.
 */
export function resolveShowcaseFocus(
	showcases: PublicShowcase[] | undefined,
	focusedSlug: string | undefined,
	region: Country,
): { viewRegion: Country; overridden: boolean; missing: boolean } {
	if (focusedSlug === undefined || showcases === undefined)
		return { viewRegion: region, overridden: false, missing: false };
	const live = showcases.find((s) => s.slug === focusedSlug);
	if (!live) return { viewRegion: region, overridden: false, missing: true };
	return {
		viewRegion: live.country,
		overridden: live.country !== region,
		missing: false,
	};
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
	const daysAhead = showcaseDaysLeft(showcase.endsAt, now);
	const lastDay = todayMytMidnight(showcase.endsAt - 1);
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

/**
 * How many CALENDAR days (MYT) until a showcase's last day: 0 = it ends
 * today, 1 = tomorrow. The one author for "how long is left" — the buyer's
 * chip and the admin's status pill both read it. (The pill once counted
 * 24-hour blocks and rounded up, so Campfest read "ends in 2 days" in the
 * admin while buyers saw "Ends tomorrow".)
 *
 * The end is exclusive; the last DAY is the one holding the final
 * millisecond, so a showcase ending at midnight ends the day before.
 */
export function showcaseDaysLeft(endsAt: number, now: number): number {
	return Math.round(
		(todayMytMidnight(endsAt - 1) - todayMytMidnight(now)) / DAY_MS,
	);
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

/** The `/stores?showcase=` link for a showcase — one author, used by the
 * stage's "See all", the seller's card and the admin's copy button. */
export function showcasePath(slug: string): string {
	return `/stores?showcase=${encodeURIComponent(slug)}`;
}
