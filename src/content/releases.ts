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
 * - **Every entry declares its `kind`** — New feature / Enhancement / Bug fix.
 *   It is required, so this is a compile error rather than a convention. Judge
 *   it from the seller's side, not the diff's: see `ReleaseKind`.
 *
 * ## Touching this file means a release is going out — run the checklist
 *
 * Notes are only ever written for a staging→main merge, so editing this file
 * is the reliable signal that a **deploy** is imminent. Everything in
 * [`docs/release-checklist.md`](../../docs/release-checklist.md) is therefore
 * part of the same change, not a separate errand: bump `package.json` (a test
 * enforces it), then audit the diff for **environment variables, backfills,
 * schema/index changes, and anything an operator must switch on by hand** and
 * write what you find into the release PR body. The point is that the person
 * merging never has to ask "is there anything for me to do?" — the answer is
 * already in front of them, including when it is "nothing".
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
 * What KIND of change an entry is, rendered as a labelled chip above its title.
 *
 * Required, not optional: a panel where some entries are labelled and some are
 * not reads as a bug, and the label is the first thing a seller scans for —
 * "did something break and get fixed, or is there something new to learn?".
 * Making it a compile error is what keeps that true for every future entry.
 *
 * Three kinds, deliberately not more. A longer taxonomy (performance,
 * security, copy…) is an engineering view of the work; a seller only sorts
 * changes into "something I can now do", "something got better", and
 * "something that was wrong is fixed".
 */
export type ReleaseKind = "feature" | "enhancement" | "fix";

/**
 * The words the seller reads. Kept beside the type rather than in the
 * component so the copy and the union can never drift, and so a test can
 * assert every kind has a label.
 */
export const RELEASE_KIND_LABELS: Record<ReleaseKind, string> = {
	feature: "New feature",
	enhancement: "Enhancement",
	fix: "Bug fix",
};

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
	| "chart"
	// Deliberately the SAME glyph as the Table half of the Cards/Table switch in
	// the orders header, not a generic grid icon: an announcement whose tile
	// matches the control the seller has to find is a shorter walk than one that
	// merely decorates the row.
	| "table";

export interface ReleaseEntry {
	/**
	 * New feature / Enhancement / Bug fix. Required — see `ReleaseKind`.
	 *
	 * Judge it from the SELLER's side, not the diff's: a change that only
	 * stopped something being wrong is a `fix` however much code it took, and a
	 * change that lets them do something they could not do before is a
	 * `feature` however small the diff.
	 */
	kind: ReleaseKind;
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
		version: "2026.08.3",
		date: "2026-08-31",
		// Earns the modal: the table shipped in 2026.08.2 is the surface a seller
		// now works in daily, and this release changes how they FILTER it — the
		// funnels moved onto the column headers, the chips went multi-select, and
		// search reaches columns it never used to. A seller who reads nothing
		// keeps using the one filter path they already found and never learns the
		// table has become the faster one.
		notable: true,
		entries: [
			{
				kind: "feature",
				title: {
					en: "Filter straight from any column heading",
				},
				body: {
					en: "In Table view, tap the funnel on a heading — Status, Payment, Order type, Categories, where the order came from — and tick as many values as you want. Filters stack across columns, the heading shows a dot while one is on, and the URL carries them, so the exact view you built is a link you can bookmark or send. Your export follows the same filters, so what you download is what you were looking at. Filtering and searching your orders is part of the Order Inbox, so the table and its funnels are on Pro.",
				},
				href: "/app/orders?view=table",
				hrefLabel: { en: "Open the table" },
				icon: "table",
			},
			{
				kind: "enhancement",
				title: {
					en: "Look at more than one status at a time",
				},
				body: {
					en: 'The chips above your orders used to be one-at-a-time. Tap several now — "Completed" and "Cancelled" together to see everything closed, or "New" and "Paid" to see what needs packing. "All" is still there to clear them in one tap. Every count stays on its own chip so you can see the shape of your week before you tap anything — the counts are there on every plan, filtering by them is on Pro.',
				},
				href: "/app/orders",
				hrefLabel: { en: "Open orders" },
			},
			{
				kind: "enhancement",
				title: {
					en: "Search now looks in every column, not just four",
				},
				body: {
					en: "Search used to read the order number, customer name, phone and item names, and nothing else — so a tracking number, a payment reference, a street name or a pickup outlet found nothing. It now reads every column the table can show, including the categories an order's items were filed under. Phone numbers still match on the last digits, so 123456789 finds +60123456789 however it was saved. Search is part of the Order Inbox, on Pro.",
				},
				href: "/app/orders",
				hrefLabel: { en: "Try a search" },
			},
			{
				kind: "feature",
				title: {
					en: "Make the table yours — drag, resize, and tick columns in bulk",
				},
				body: {
					en: "Drag a heading sideways to move that column, or drag its edge to set the width — both are remembered per store on this device, so your layout is waiting for you next time. The Columns panel now has select-all for the whole list and for each group, so setting up a packing view is a couple of taps instead of thirty-six. On a computer the heading row stays put while the rows scroll under it.",
				},
				href: "/app/orders?view=table",
				hrefLabel: { en: "Set up your columns" },
				icon: "table",
			},
			{
				kind: "enhancement",
				title: {
					en: "Every cell reads like words, not like a database",
				},
				body: {
					en: 'Your orders showed raw values in places — "self_collect", "received", "payment_window_expired". They now read as Self-collect, Paid and Payment window expired, and the filters offer exactly the same wording as the column beside them. Your CSV export is deliberately unchanged: it still carries the stored values, so any spreadsheet formula you have built on it keeps working.',
				},
			},
			{
				kind: "fix",
				title: {
					en: "Categories are recorded at the moment of sale",
				},
				body: {
					en: "An order now remembers which categories its items were filed under when it was sold, instead of looking them up fresh every time. Reorganise your catalogue and last month's orders keep telling the truth about last month — and you can search and filter your orders by category, which was never possible before.",
				},
				href: "/app/orders",
				hrefLabel: { en: "Open orders" },
			},
			{
				kind: "fix",
				title: {
					en: "Long status labels no longer break in half",
				},
				body: {
					en: '"Ready for Pickup" and longer custom stage names used to wrap mid-phrase in a narrow space, splitting the coloured pill into two ragged pieces on cards, in the table and on the order page. A status is one pill now — it shortens with a "…" when it has to, and the full wording is there when you hover.',
				},
			},
			{
				kind: "fix",
				title: {
					en: "Re-uploading your product export can't bring back an archived product",
				},
				body: {
					en: "The export carries a product_status column. Uploading that file back used to ignore it, so an archived product quietly returned to your catalogue. The upload now reads it, the same way it already read variant_status — a round-trip leaves your catalogue exactly as it was.",
				},
				href: "/app/products/import",
				hrefLabel: { en: "Open product upload" },
			},
		],
	},
	{
		version: "2026.08.2",
		date: "2026-08-28",
		// Earns the modal: the orders page a seller opens every morning now has a
		// second view, a pin, and an export that answers questions the old one
		// could not. A seller who reads nothing keeps exporting to Excel out of
		// habit — which is the exact behaviour this release exists to end.
		//
		// This is also the FIRST release that can actually open it. 2026.08.1
		// shipped the feature itself, so every seller was silently caught up to
		// it (see `resolveWhatsNew`); they now hold a stored version, and this one
		// is newer.
		notable: true,
		entries: [
			{
				kind: "feature",
				title: {
					en: "Your orders as a table — the spreadsheet view, without leaving Kedaipal",
				},
				body: {
					en: "Switch between Cards and Table at the top of your orders page. Table gives you one row per order and sorts on any heading you tap. Use Columns to choose what you see and drag them into the order you want — we remember your layout for next time. It scrolls sideways on a phone, so it's there when you're on the move. Unlike a spreadsheet, what you're looking at is live, and you can still act on every order in front of you.",
				},
				href: "/app/orders",
				hrefLabel: { en: "Open orders" },
				icon: "table",
			},
			{
				kind: "feature",
				title: {
					en: "Pin the orders you need to keep an eye on",
				},
				body: {
					en: "Tap the pin on any order — on a card, a table row, or the order itself — and it stays at the top of your list. It stays there even when your filters would otherwise hide it, so you can park a problem order on top and carry on working through everything else. Nothing ever unpins itself, not even once the order is delivered: that stays your call, and the Pinned chip tells you how many you're holding.",
				},
				href: "/app/orders",
				hrefLabel: { en: "Open orders" },
			},
			{
				kind: "enhancement",
				title: {
					en: "See a photo of every item while you pack",
				},
				body: {
					en: "Open an order and each line now carries its product photo — the variant's own picture where you've set one. Less squinting at three near-identical names to work out which box to reach for.",
				},
				href: "/app/orders",
				hrefLabel: { en: "Open orders" },
				icon: "package",
			},
			{
				kind: "fix",
				title: {
					en: "Your order export finally has the address — and the totals add up",
				},
				body: {
					en: "The download was missing where the order was going: no delivery address, no pickup point, for any order. Both are in there now, along with your categories, the payment reference, the date it was paid, and the custom-work quote that used to sit inside the total with no column of its own — so Subtotal + Custom work + Pickup fee + Delivery fee now matches Total on every order, including made-to-order ones. In Table view, Export lets you take just the columns you're looking at, or every column we hold.",
				},
				href: "/app/orders",
				hrefLabel: { en: "Open orders" },
			},
			{
				kind: "enhancement",
				title: {
					en: "Your product export is a full catalogue report now",
				},
				body: {
					en: "It used to be only the re-upload template. It now also shows each product's categories, whether it's on your storefront and its link, stock policy and reserved stock, minimum order rules, and how many photos it has. The first eleven columns haven't moved, so editing the file and uploading it back works exactly as before — and if you edit one of the new columns, the upload screen now tells you it won't be applied instead of quietly ignoring it.",
				},
				href: "/app/products",
				hrefLabel: { en: "Open products" },
			},
		],
	},
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
				kind: "enhancement",
				title: {
					en: "Your customer gets one WhatsApp — everything else is on their order page",
				},
				body: {
					en: "When an order comes in they get a confirmation with a link, and that page then updates itself: packing, shipping, your mockup, the payment details, the tracking number. We no longer message them at each step. Worth saying \"keep this link\" when you chat — it's the one thing they need, and it's always current.",
				},
				icon: "package",
			},
			{
				kind: "enhancement",
				title: {
					en: "Cancelling an order no longer messages the customer",
				},
				body: {
					en: "It shows on their order page, but nothing is sent — so if someone is expecting their order, tell them yourself. The cancel screen now says so before you confirm.",
				},
			},
			{
				kind: "enhancement",
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
				kind: "feature",
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
				kind: "feature",
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
				kind: "feature",
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
				kind: "feature",
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
				kind: "enhancement",
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
				kind: "fix",
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
				kind: "feature",
				title: {
					en: "Find your version — and this list — in the same place",
				},
				body: {
					en: "Tap \"More\" on your phone, or look at the bottom of the sidebar on a computer. You'll find which version of Kedaipal you're running, with one-tap copy — send us that number when you ask for help and we'll know exactly what you're seeing. \"What's new\" sits right there too, and shows a dot when there's something you haven't read.",
				},
			},
			{
				kind: "fix",
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
