import type { Locale } from "../../convex/lib/locale";
import type { Localized, Release } from "../content/releases";
import { compareCalendarVersions } from "./app-version";

/**
 * Pure selection logic behind the "What's new" surfaces (ClickUp 86eyqgxv9).
 *
 * Kept out of the components so the rules that decide *whether a seller is
 * interrupted* are testable without rendering anything.
 */

/** Resolve localized copy, falling back to English. */
export function localized(text: Localized, locale: Locale): string {
	return text[locale] ?? text.en;
}

/**
 * Releases visible in this build — anything newer than the running version is
 * filtered out.
 *
 * Notes ship inside the bundle, so in practice the array can't contain a future
 * version. The filter is defence against the one case that does happen: a
 * release PR that adds notes but forgets to bump `package.json`, which would
 * otherwise announce a version the seller is demonstrably not running.
 */
export function releasesInBuild(
	releases: Release[],
	currentVersion: string,
): Release[] {
	return releases.filter(
		(r) => compareCalendarVersions(r.version, currentVersion) <= 0,
	);
}

/**
 * Releases this seller has not seen yet.
 *
 * `seenVersion` must be a real stored version. The "never stamped" case is
 * deliberately NOT handled here — see `resolveWhatsNew` for why it must never
 * be treated as "has seen nothing".
 */
export function unseenReleases(
	releases: Release[],
	seenVersion: string,
	currentVersion: string,
): Release[] {
	return releasesInBuild(releases, currentVersion).filter(
		(r) => compareCalendarVersions(r.version, seenVersion) > 0,
	);
}

/**
 * How many releases the panel renders before folding the rest behind a
 * "Show older" button.
 *
 * The array is the permanent changelog and keeps every entry — a dismissed
 * announcement must never become unreadable — but a seller opening the panel
 * wants what changed since they last looked, not the full history above the
 * fold. Five is roughly a month at the current cadence: enough that the last
 * thing they half-remember is still on screen, few enough that the newest
 * release is not one of a dozen. There is no separate changelog page, so the
 * older releases stay one tap away here rather than disappearing.
 */
export const PANEL_RELEASE_LIMIT = 5;

/**
 * Split the build's releases into the ones the panel shows at once and the
 * ones it folds. Unseen releases are NEVER folded — a seller returning after
 * a long gap (or a brand-new seller stamped with an old version by act-as)
 * must see everything they missed without knowing to tap "Show older". Since
 * releases are newest-first and unseen ones are by definition the newest, the
 * unseen set is always a prefix, so this is one slice.
 */
export function splitPanelReleases(
	all: Release[],
	unseenVersions: Set<string>,
	limit = PANEL_RELEASE_LIMIT,
): { shown: Release[]; older: Release[] } {
	const unseenCount = all.filter((r) => unseenVersions.has(r.version)).length;
	const cut = Math.max(limit, unseenCount);
	return { shown: all.slice(0, cut), older: all.slice(cut) };
}

export interface WhatsNewState {
	/** Every release in this build, newest first — the permanent changelog. */
	all: Release[];
	/** Versions the seller hasn't seen; drives the dot and the "New" chips. */
	unseenVersions: Set<string>;
	/** Open the modal unprompted — only ever true for a NOTABLE unseen release. */
	autoOpen: boolean;
	/**
	 * Stamp this version as seen without showing anything.
	 *
	 * Set when the seller has no stored version at all. Every seller reaching
	 * this feature for the first time — a brand-new signup AND every existing
	 * seller on the day it ships — has, in the only sense that matters, already
	 * seen everything released so far: they have been using it. Replaying a
	 * backlog of a dozen entries at them reads like the product is talking to
	 * somebody else.
	 *
	 * So "no stored version" means "caught up", not "has seen nothing". This one
	 * rule covers both cohorts with no signup-flow change and no backfill.
	 */
	silentCatchUp: boolean;
}

/**
 * Decide what the seller should see. Single entry point for both surfaces so
 * the dot, the modal and the stamp can never disagree.
 *
 * `seenVersion === undefined` means the query hasn't resolved. Nothing renders
 * and nothing is stamped until it does — that is also why no localStorage
 * mirror is needed to prevent a flash: the modal simply never opens against
 * unknown state, so there is nothing to flash and then retract.
 */
export function resolveWhatsNew(opts: {
	releases: Release[];
	/** `undefined` = still loading, `null` = never stamped, string = stored version. */
	seenVersion: string | null | undefined;
	currentVersion: string;
}): WhatsNewState {
	const { releases, seenVersion, currentVersion } = opts;
	const all = releasesInBuild(releases, currentVersion);
	const empty: WhatsNewState = {
		all,
		unseenVersions: new Set(),
		autoOpen: false,
		silentCatchUp: false,
	};

	if (seenVersion === undefined) return empty;
	if (seenVersion === null) return { ...empty, silentCatchUp: true };

	const unseen = unseenReleases(releases, seenVersion, currentVersion);
	return {
		all,
		unseenVersions: new Set(unseen.map((r) => r.version)),
		// Only a NOTABLE release interrupts. Everything else is discoverable via
		// the dot on the More panel — a modal on every release trains sellers to
		// dismiss reflexively, and then the one that matters is dismissed too.
		autoOpen: unseen.some((r) => r.notable),
		silentCatchUp: false,
	};
}
