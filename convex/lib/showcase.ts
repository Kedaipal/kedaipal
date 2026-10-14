import { v } from "convex/values";

/**
 * Marketplace showcases (z8r3fdr6mv) — the ONE author for every rule a
 * showcase obeys: the field caps, the theme set, the publish window and the
 * state a showcase is in at a given moment.
 *
 * A showcase is an admin-curated, time-boxed section at the top of
 * kedaipal.com/stores: "Malaysia Campfest 2026 · 16–18 Oct" with the stores
 * at the event grouped under it, each with an optional booth label. Built
 * for Campfest first, reusable for every bazaar, pop-up and partner fair
 * after it, which is why nothing here names an event.
 *
 * Pure — no Convex imports beyond `v` — so the admin editor's live counters,
 * the buyer page's "Happening now" chip and the unit tests load it directly,
 * the `marketplaceListing.ts` pattern.
 *
 * Vocabulary: the admin word is **showcase**, never "event". "Event" already
 * means three things in this codebase (an RSVP product, an event venue, the
 * `event` order-flow kind), and the directory has already been bitten by a
 * name collision once ("Sponsor" the comp kind vs the "Sponsored" rail).
 * Buyers never see the word at all — they see the showcase's own title.
 */

export const SHOWCASE_TITLE_MAX = 60;
export const SHOWCASE_TAGLINE_MAX = 140;
/** "Booth B4", "Food court 7", "Hall 2 · C12". A label, not a sentence. */
export const SHOWCASE_LABEL_MAX = 24;
/**
 * Members ride the showcase row as an array, so the cap is what keeps the
 * document bounded (the Convex guideline against unbounded arrays). A bazaar
 * with more than 40 Kedaipal stores in it would be a second showcase.
 */
export const SHOWCASE_MEMBER_CAP = 40;
/**
 * The admin list reads every showcase in one go — there are a handful, by
 * construction (an admin makes them by hand). This bounds that read so a
 * runaway never becomes a full-table scan.
 */
export const SHOWCASE_SCAN_CAP = 100;

/**
 * The curated looks. Every theme is a DARK ground with light text, so the
 * banner, the ticket fallback panel and the compact band read correctly in
 * light AND dark mode with one text treatment — which is also why an admin
 * picks a mood here and never a raw colour. The CSS for each lives in
 * `src/lib/showcase-theme.ts`; this is the closed set the schema, the editor
 * and the buyer page all agree on.
 */
export const SHOWCASE_THEMES = [
	"campfire",
	"festive",
	"ocean",
	"sunset",
	"midnight",
	"kedaipal",
] as const;

export type ShowcaseTheme = (typeof SHOWCASE_THEMES)[number];

export const SHOWCASE_THEME_LABELS: Record<ShowcaseTheme, string> = {
	campfire: "Campfire",
	festive: "Festive",
	ocean: "Ocean",
	sunset: "Sunset",
	midnight: "Midnight",
	kedaipal: "Kedaipal",
};

export const DEFAULT_SHOWCASE_THEME: ShowcaseTheme = "campfire";

export const showcaseThemeValidator = v.union(
	...SHOWCASE_THEMES.map((theme) => v.literal(theme)),
);

export function isShowcaseTheme(value: unknown): value is ShowcaseTheme {
	return (
		typeof value === "string" &&
		(SHOWCASE_THEMES as readonly string[]).includes(value)
	);
}

/** The fields the window rule reads — a structural subset of the row, so the
 * rule is testable without a database and the client can run it on the
 * public payload. */
export interface ShowcaseWindow {
	publishedAt?: number;
	startsAt?: number;
	endsAt?: number;
}

/**
 * A showcase's one state at a given moment, from the admin's point of view.
 * `draft` outranks the dates — an unpublished showcase never reaches buyers
 * whatever its window says — and the window is read at read time, so there
 * is no cron: the moment `endsAt` passes, the next render drops it.
 */
export type ShowcaseState = "draft" | "scheduled" | "live" | "ended";

export function showcaseState(row: ShowcaseWindow, now: number): ShowcaseState {
	if (row.publishedAt === undefined) return "draft";
	if (row.endsAt !== undefined && row.endsAt <= now) return "ended";
	if (row.startsAt !== undefined && row.startsAt > now) return "scheduled";
	return "live";
}

/** Buyers see exactly the LIVE ones. One author, read by the public query and
 * by the client's minute tick alike, so the two can never disagree. */
export function isShowcaseLive(row: ShowcaseWindow, now: number): boolean {
	return showcaseState(row, now) === "live";
}

/** Collapse inner whitespace and trim — the saved shape, so the editor can
 * compare "dirty" against what the server will actually store. */
export function collapseLine(input: string): string {
	return input.replace(/\s+/g, " ").trim();
}

export function sanitizeShowcaseTitle(input: string): string {
	const title = collapseLine(input);
	if (title.length === 0) throw new Error("Give the showcase a title");
	if (title.length > SHOWCASE_TITLE_MAX)
		throw new Error(`Title exceeds ${SHOWCASE_TITLE_MAX} characters`);
	return title;
}

/** Blank = unset (no bare empty line on the banner). */
export function sanitizeShowcaseTagline(
	input: string | undefined,
): string | undefined {
	const tagline = collapseLine(input ?? "");
	if (tagline.length === 0) return undefined;
	if (tagline.length > SHOWCASE_TAGLINE_MAX)
		throw new Error(`Tagline exceeds ${SHOWCASE_TAGLINE_MAX} characters`);
	return tagline;
}

export function sanitizeShowcaseLabel(
	input: string | undefined,
): string | undefined {
	const label = collapseLine(input ?? "");
	if (label.length === 0) return undefined;
	if (label.length > SHOWCASE_LABEL_MAX)
		throw new Error(`Booth label exceeds ${SHOWCASE_LABEL_MAX} characters`);
	return label;
}

/**
 * The window as a pair must make sense: an end before a start is a showcase
 * that can never be live, and the editor would show it as "Scheduled"
 * forever. Refused at the door rather than rendered as a riddle.
 */
export function assertValidShowcaseWindow(window: {
	startsAt?: number;
	endsAt?: number;
}): void {
	if (
		window.startsAt !== undefined &&
		window.endsAt !== undefined &&
		window.endsAt <= window.startsAt
	) {
		throw new Error("The showcase must end after it starts");
	}
}

/**
 * The URL handle for `/stores?showcase=<slug>` — the link on the booth QR
 * and in the WhatsApp group. Derived from the title ONCE, at create, and
 * never rewritten by a title edit: a printed QR must keep working after the
 * admin fixes a typo in the title. The year is kept ("campfest-2026") so next
 * year's showcase gets its own handle.
 */
export function showcaseSlugFromTitle(title: string): string {
	const base = title
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48)
		.replace(/-+$/g, "");
	return base.length > 0 ? base : "showcase";
}

/** `?showcase=` as typed by a human or copied from a QR: the same character
 * set the slug is made of, so a hand-edited value degrades to "no showcase",
 * never to a crash or a query against an arbitrary string. */
export function parseShowcaseSlugParam(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const slug = value.trim().toLowerCase();
	return /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(slug) ? slug : undefined;
}
