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
