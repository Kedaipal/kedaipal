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
		// The FIRST versioned release. `package.json` is already `2026.08.1` and
		// no `v*` tag exists yet, so this one number covers everything shipping
		// in the staging→main merge — the in-app version display and this panel
		// included. Deliberately not split into 2026.08.1 + 2026.08.2: one
		// deploy is one version, and a changelog claiming two releases that
		// never separately existed makes the tag history a lie.
		version: "2026.08.1",
		date: "2026-08-27",
		// Earns the modal: a seller who doesn't read it will keep marking orders
		// shipped believing the buyer was told, and will wait on an automatic
		// payment chase that no longer runs.
		//
		// KNOWN, and deliberate: nobody is actually interrupted by THIS release.
		// The feature ships in it, so every seller has no stored version, which
		// `resolveWhatsNew` reads as "caught up" — they are stamped silently and
		// shown nothing. The notes are still readable in the panel; the first
		// release that can open the modal is the next notable one.
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
			},
			{
				title: {
					en: "Payment reminders are yours to send now",
				},
				body: {
					en: 'We\'ve stopped chasing unpaid orders automatically. Instead, an unpaid order shows a "Send payment reminder" button from day 11 — once a day, up to day 14. You choose who gets nudged and when, and nothing goes out behind your back.',
				},
				href: "/app/orders",
				hrefLabel: { en: "Open orders" },
				icon: "megaphone",
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
					en: "Send the rest of checkout to your buyer — built for live selling",
				},
				body: {
					en: 'Key what they claimed at the counter — items, quantity, the price you called out — add their phone number, and tap "Send to buyer". They get a WhatsApp link to a ready-made checkout where all they fill in is address and date. The price you keyed is locked, and you choose how long they have, from 10 minutes to a day. Your stock only leaves the shelf when they finish, and if they never pay, the order cancels itself and the stock comes back. Works just as well for phone orders and DM quotes.',
				},
				href: "/app/checkout",
				hrefLabel: { en: "Open counter checkout" },
				icon: "clock",
			},
			{
				title: {
					en: "Change a price on the spot at the counter",
				},
				body: {
					en: "Tap any price in the counter cart to key what you actually agreed — a discount, a top-up, a rounded-off cash price. Your usual price stays visible with a line through it, in the cart and again on the confirm screen, so a mis-typed figure is easy to spot before you submit. Reset puts it back.",
				},
				href: "/app/checkout",
				hrefLabel: { en: "Open counter checkout" },
			},
			{
				title: {
					en: "See which orders came from TikTok, your bio link, or your poster",
				},
				body: {
					en: "Your Home page now has ready-made links you can copy in one tap — one per place you post. Orders that arrive through them are labelled, so you can filter your orders by where they came from, and see the revenue behind each one. The labelling works on every plan, so your history is already building; the revenue breakdown in Insights is a Pro feature.",
				},
				href: "/app/insights",
				hrefLabel: { en: "See where orders come from" },
				icon: "chart",
			},
			{
				title: {
					en: "Your storefront loads much faster on a phone",
				},
				body: {
					en: "Photos are now resized for the screen they're shown on instead of sending the full-size original, so a customer on mobile data sees your products in a fraction of the time — and far fewer of them give up on a page that won't load. Photos you upload from now on are shrunk automatically too, and if one can't be shown on the web at all (iPhone HEIC files are the usual culprit) we tell you at upload, instead of leaving a broken picture on your storefront.",
				},
				href: "/app/products",
				hrefLabel: { en: "Check your photos" },
			},
			{
				title: {
					en: "Moving your store to Singapore is guided, not blocked",
				},
				body: {
					en: "Changing your store's country used to be refused outright, or quietly clear settings you'd spent time on. Now it goes through, and you get a short checklist of what still needs your attention — the currency your prices show in, your delivery setup, the address printed on parcel labels. Each item takes you straight to the card that fixes it.",
				},
				href: "/app/settings?tab=store",
				hrefLabel: { en: "Open store settings" },
				icon: "settings",
			},
			{
				title: {
					en: "Find your version — and this list — in the same place",
				},
				body: {
					en: "Tap \"More\" on your phone, or look at the bottom of the sidebar on a computer. You'll find which version of Kedaipal you're running, with one-tap copy — send us that number when you ask for help and we'll know exactly what you're seeing. \"What's new\" sits right there too, and shows a dot when there's something you haven't read.",
				},
			},
			{
				title: {
					en: "Your customers' payment screenshots stay in your dashboard",
				},
				body: {
					en: "When a customer says they've paid, the email we send you now points you to your dashboard to view their receipt, instead of carrying the image itself — so forwarding that email no longer hands their screenshot to whoever receives it. Our privacy policy has been rewritten to match, spelling out exactly what's stored and who handles it. That's the policy your checkout links to, so it's worth a read.",
				},
				href: "/app/orders",
				hrefLabel: { en: "Open orders" },
			},
		],
	},
];
