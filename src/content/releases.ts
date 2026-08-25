import type { Locale } from "../../convex/lib/locale";

/**
 * Seller-facing release notes (ClickUp 86eyqgxv9) — the content shown by the
 * "What's new" panel and modal in `/app`.
 *
 * ## Why this lives in the repo, not in Convex
 *
 * A release note describes **the code in this build**. Stored in the database
 * it can drift from what is actually deployed — announcing a feature that is
 * not live yet, or missing one that is. In the repo it ships with the build it
 * describes, and the note gets written in the **same PR as the feature**, which
 * is the existing "code + tests + docs together" rule with one more item.
 *
 * Trade-off accepted: fixing a typo needs a deploy.
 *
 * ## This is NOT the engineering shipped-log
 *
 * `docs/shipped-log.md` is the internal record — why a call was made, what was
 * rejected, which trap was found. This is what a **seller** reads. Keep them
 * apart: an entry here that reads like a commit message ("fix(delivery): arm
 * the dispatch button") is worse than no entry at all.
 *
 * ## How to add an entry
 *
 * - **Not every release earns one.** Most releases are internal and belong in
 *   `docs/shipped-log.md` only. An empty release is simply absent from this
 *   array — nothing is shown, nothing is stamped.
 * - Newest first. `version` must match the `package.json` version that shipped
 *   the change, in `YYYY.MM.N` form.
 * - `notable: true` interrupts every seller with a modal on their next `/app`
 *   visit. Reserve it for changes that alter how they work. Everything else
 *   gets the quiet dot on the More panel. A modal on every release trains
 *   sellers to dismiss reflexively, and then the one that matters is dismissed
 *   too.
 * - Write the **benefit**, not the change. "Print four labels on one A4 sheet"
 *   beats "added a6-4up paperSize option".
 * - Add an `href` wherever the feature has a home. The deep link is what turns
 *   an announcement into adoption — without it a seller reads the note, nods,
 *   and never finds the setting.
 */

/**
 * Copy in one or more locales. `en` is required; other locales are optional and
 * fall back to it.
 *
 * Deliberately not `Record<Locale, string>`: requiring BM and ZH for every
 * entry taxes each release enough that entries would quietly stop being
 * written, and a half-translated entry is worse than an English one. This shape
 * lets a locale be added per-entry, later, with no reshape — and `retailers.locale`
 * already drives seller emails and WhatsApp alerts, so a BM seller reading BM
 * here is a real (if deferred) goal, not a hypothetical.
 */
export type Localized = { en: string } & Partial<
	Record<Exclude<Locale, "en">, string>
>;

/**
 * Icons an entry may carry, rendered as a tinted tile beside its title.
 *
 * A closed allowlist rather than a free lucide name: it keeps the icon set
 * coherent across releases, makes a typo a compile error, and stops the bundle
 * pulling in an icon per entry forever. Omit it — most entries should — and the
 * entry gets the neutral default.
 */
export type ReleaseIconName =
	| "printer"
	| "clock"
	| "package"
	| "truck"
	| "wallet"
	| "megaphone"
	| "settings"
	| "chart";

export interface ReleaseEntry {
	/** One line, benefit-first. Shown as the entry heading. */
	title: Localized;
	/** A sentence or two of plain-language detail. */
	body: Localized;
	/** In-app deep link to where the feature actually lives, e.g. `/app/settings?tab=fulfilment`. */
	href?: string;
	/** Link text. Defaults to "Take a look" when omitted. */
	hrefLabel?: Localized;
	/** Optional icon tile. Omit for the neutral default — a wrong icon is worse than none. */
	icon?: ReleaseIconName;
}

export interface Release {
	/** The `package.json` version that shipped these entries (`YYYY.MM.N`). */
	version: string;
	/** ISO date the release shipped — display only, ordering always uses `version`. */
	date: string;
	/**
	 * `true` opens the modal for every seller who hasn't seen this version.
	 * `false` shows only the unseen dot on the More panel.
	 */
	notable: boolean;
	entries: ReleaseEntry[];
}

/**
 * Newest first. Ordering is enforced by test, not convention — an out-of-order
 * entry would make "everything newer than X" return the wrong set.
 */
export const RELEASES: Release[] = [
	{
		// package.json still reads 2026.08.1 — the bump happens in the
		// staging→main release PR, by hand (docs/ci.md). Until then these notes
		// are simply hidden: `visibleReleases` drops anything newer than the
		// running build, which is the case the "notes for a version newer than
		// the running build are hidden" test pins.
		version: "2026.08.2",
		date: "2026-08-26",
		// The one release this year that genuinely earns the modal: a seller who
		// doesn't read it will keep marking orders shipped believing the buyer was
		// told, and will wait on an automatic payment chase that no longer runs.
		notable: true,
		entries: [
			{
				title: {
					en: "Your customer gets one WhatsApp — everything else is on their order page",
				},
				body: {
					en: "When an order comes in they get a confirmation with a link, and that page then updates itself: packing, shipping, your mockup, the payment details, the tracking number. We no longer message them at each step. Worth saying \"keep this link\" when you chat — it's the one thing they need, and it's always current.",
				},
				icon: "package",
			},
			{
				title: {
					en: "Cancelling an order no longer messages the customer",
				},
				body: {
					en: "It shows on their order page, but nothing is sent — so if someone is expecting their order, tell them yourself. The cancel screen now says so before you confirm.",
				},
				icon: "clock",
			},
			{
				title: {
					en: "Get a WhatsApp the moment an online payment lands",
				},
				body: {
					en: "If you collect through HitPay, we'll message your own number as soon as the money arrives — and the order confirms itself, so there's nothing for you to check. Switch it on with the new-order and payment alerts under Store settings.",
				},
				href: "/app/settings?tab=store",
				hrefLabel: { en: "Turn on alerts" },
				icon: "wallet",
			},
			{
				title: {
					en: "Payment reminders are yours to send now",
				},
				body: {
					en: "We've stopped chasing unpaid orders automatically. Instead, an unpaid order shows a \"Send payment reminder\" button from day 11 — once a day, up to day 14. You choose who gets nudged and when, and nothing goes out behind your back.",
				},
				href: "/app/orders",
				hrefLabel: { en: "Open orders" },
				icon: "megaphone",
			},
		],
	},
	{
		version: "2026.08.1",
		date: "2026-08-25",
		notable: false,
		entries: [
			{
				title: {
					en: "See which version of Kedaipal you're running",
				},
				body: {
					en: "Open the More menu (or the sidebar on a computer) and you'll find the version at the bottom, with a one-tap copy. If you ever message us for help, sending that number tells us exactly what you're seeing.",
				},
			},
		],
	},
];
