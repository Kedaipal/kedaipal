import type { Country } from "../../convex/lib/country";
import {
	DAY_MS,
	formatFulfilmentDate,
	formatFulfilmentTime,
	todayMytMidnight,
	weekdayIndexMyt,
} from "../../convex/lib/fulfilmentDate";
import { isNewStore } from "../../convex/lib/marketplaceListing";
import {
	openNowStatus,
	WEEKDAY_NAMES_SHORT,
} from "../../convex/lib/openingHours";
import type { MarketplaceStoreCard } from "../../convex/marketplace";

/**
 * Marketplace page derivations (z8r3fdkmyp) — pure, so the search/chip/region
 * behaviour is unit-tested off the DOM. The server sends EVERY listable store
 * in one payload (see convex/marketplace.ts for why); everything the page
 * does with it — region split, filter chips, search, the sponsored/founding
 * shelves — happens here.
 */

export type MarketplaceChip = "all" | "open" | "new" | "delivers";

const FILTER_CHIPS: ReadonlyArray<Exclude<MarketplaceChip, "all">> = [
	"open",
	"new",
	"delivers",
];

/** Longest search kept in the URL — a query, not a paste of someone's essay. */
export const SEARCH_QUERY_MAX = 80;

/**
 * The page's URL state: `?q=` and `?filter=`. In the URL rather than component
 * state so Back from a storefront returns the buyer to the view they left,
 * and a filtered view is a link someone can share. "All" and an empty search
 * are the ABSENCE of a param, so the bare `/stores` stays the canonical page.
 * Anything hand-edited or stale degrades to that default, never to a crash.
 */
export function parseMarketplaceSearch(search: Record<string, unknown>): {
	q?: string;
	filter?: Exclude<MarketplaceChip, "all">;
} {
	const q =
		typeof search.q === "string" && search.q.trim().length > 0
			? search.q.slice(0, SEARCH_QUERY_MAX)
			: undefined;
	const filter = FILTER_CHIPS.find((chip) => chip === search.filter);
	return { ...(q ? { q } : {}), ...(filter ? { filter } : {}) };
}

/**
 * The card's one-line live status. Reuses the storefront's own authors
 * (`openNowStatus` + the fulfilment-date formatters), compressed to card
 * length: the storefront header explains ("Closed today · Hari Raya · opens
 * 9:00 AM Mon"); a card only has room to answer "can I order right now, and
 * if not, when?".
 *
 * Off-Season Hold outranks the clock: a paused store is browsable but not
 * orderable, and "Open now" over a storefront that then refuses the cart
 * would be the card lying about what the tap leads to.
 */
export function cardOpenStatus(
	card: Pick<
		MarketplaceStoreCard,
		"openingHours" | "closedDates" | "orderingPaused"
	>,
	now: number,
): { open: boolean; label: string } {
	if (card.orderingPaused)
		return { open: false, label: "On a break — browse only" };
	const status = openNowStatus(card.openingHours, now, card.closedDates);
	if (status.open) return { open: true, label: "Open now" };
	if (status.nextOpen) {
		const { daysAhead, openMinutes, allDay } = status.nextOpen;
		// "today" is silent — "opens 2:00 PM" already means today; tomorrow and
		// beyond are named ("opens 9:00 AM tomorrow" / "… Mon" / "… 12 Oct"),
		// same graduation as the storefront's whenAhead.
		const today = todayMytMidnight(now);
		const when =
			daysAhead === 0
				? ""
				: daysAhead === 1
					? " tomorrow"
					: daysAhead < 7
						? ` ${WEEKDAY_NAMES_SHORT[weekdayIndexMyt(today + daysAhead * DAY_MS)]}`
						: ` ${formatFulfilmentDate(today + daysAhead * DAY_MS, { year: false }).replace(",", "")}`;
		const reopens = allDay
			? `reopens${when || " today"}`
			: `opens ${formatFulfilmentTime(openMinutes)}${when}`;
		return { open: false, label: `Closed · ${reopens}` };
	}
	// Defensive — the hours sanitizer refuses an all-closed week.
	return { open: false, label: "Closed" };
}

/** One store, one search: name, description and area all match. */
function matchesSearch(card: MarketplaceStoreCard, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (q.length === 0) return true;
	return [card.storeName, card.storeDescription, card.storeArea].some((f) =>
		f?.toLowerCase().includes(q),
	);
}

/**
 * The visible store set for a region + chip + search. Region always applies
 * (MY and SG are never blended silently — the count fact names the region);
 * the chips are single-select refinements on top.
 */
export function filterStores(
	cards: MarketplaceStoreCard[],
	opts: { region: Country; chip: MarketplaceChip; search: string; now: number },
): MarketplaceStoreCard[] {
	return cards.filter((card) => {
		if (card.country !== opts.region) return false;
		if (!matchesSearch(card, opts.search)) return false;
		switch (opts.chip) {
			case "open":
				return cardOpenStatus(card, opts.now).open;
			case "new":
				return isNewStore(card.createdAt, opts.now);
			case "delivers":
				return card.offersDelivery;
			default:
				return true;
		}
	});
}

/**
 * The two shelves above the general list. Sponsored keeps the server's
 * (activity) order; the Founding shelf reads in rank order — rank IS its
 * meaning. Both draw from the region-filtered set, and every shelf store
 * still appears in "All stores": a store must never become unfindable in the
 * full list because it was promoted out of it.
 */
export function partitionStores(cards: MarketplaceStoreCard[]): {
	sponsored: MarketplaceStoreCard[];
	founding: MarketplaceStoreCard[];
} {
	const sponsored = cards.filter((c) => c.sponsored);
	const founding = cards
		.filter((c) => c.isFoundingMember && c.foundingMemberRank !== undefined)
		.sort((a, b) => (a.foundingMemberRank ?? 0) - (b.foundingMemberRank ?? 0));
	return { sponsored, founding };
}
