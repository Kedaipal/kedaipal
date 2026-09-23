import type { Locale } from "../../convex/lib/locale";
import { spotlightHref } from "../lib/spotlight";

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
	| "table"
	// Same reasoning as "table": the glyph the Calendar segment of the orders
	// view switch actually uses (CalendarRange), so the booking announcements
	// point at the control they are announcing.
	| "calendar"
	// Same reasoning again: the glyph on the new-product wizard's Event card
	// (CalendarClock), so the events announcement's tile is the card the
	// seller taps — and not the Booking card's CalendarRange one row above it.
	| "calendar-clock";

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
	/**
	 * In-app deep link to where the feature actually lives, e.g.
	 * `/app/settings?tab=fulfilment`. When the feature is ONE card on a settings
	 * tab, use `spotlightHref("<key>")` (src/lib/spotlight.ts) — it lands the
	 * seller on that card and rings it in the brand mint, instead of the top
	 * of the tab.
	 */
	href?: string;
	/** Link text. Defaults to "Set it up" when omitted — but always write one. */
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
		version: "2026.09.7",
		date: "2026-09-23",
		// Notable, on the "whole new way of selling" trigger: a seller who
		// reads nothing will keep collecting RSVPs in a WhatsApp thread and
		// counting dishes by hand, because the Event card is the fifth of five
		// in the new-product wizard and nothing else in the app points at it.
		// The counter-argument (put to Zaki in the release PR): events are Pro,
		// so a Starter seller is interrupted for something behind a wall — the
		// body names the plan, and the Event card itself says "Pro" and why.
		notable: true,
		entries: [
			{
				kind: "feature",
				title: {
					en: "Host an event — guests RSVP, and the headcount counts itself",
				},
				body: {
					en: "A monthly networking breakfast, a Saturday baking class, a three-day camp: the RSVPs used to live in a WhatsApp thread while you counted by hand. Now pick Event when you add a product, then set the date (a last day too, if it runs longer), the time and how many seats. Guests RSVP on your storefront or at your counter and pick their set, package or tent, and the product page tallies each choice, so you know what to prepare. The date and venue are yours to set, never theirs to pick. RSVPs stop at your seat cap, and the day after it ends the listing leaves your storefront by itself. Price it at zero for a free RSVP. Events are on Pro.",
				},
				// `?card=event` opens the wizard with Event already selected
				// (z8r3fdhkr7) — not on the store's own type. Harmless before that
				// ships: the route drops a `card` it doesn't know.
				href: "/app/products/new?card=event",
				hrefLabel: { en: "Create an event" },
				icon: "calendar-clock",
			},
			{
				kind: "fix",
				title: {
					en: "Counter preorders show the day they're collected",
				},
				body: {
					en: "Take an order at the counter for Saturday and the day you picked used to vanish — the order list and the order itself hid every counter date, on the guess that it was just today's default. Now only that default stays hidden. A day you chose shows on the order card and inside the order, like any storefront order. On every plan.",
				},
				href: "/app/orders",
				hrefLabel: { en: "Open orders" },
			},
			{
				kind: "fix",
				title: {
					en: "Bookings in your order list use booking words",
				},
				body: {
					en: "A guest who'd checked in could read \"Shipped\" or \"Ready for Pickup\" in the order list, and a finished stay \"Delivered\" — your shop's wording, borrowed for a campsite. Each row now speaks its own: Checked In and Checked Out, or Active and Ended for a package. And on Pro, bulk-marking a mix of orders as Packed now leaves bookings alone, since a stay is never packed, and the toast says how many it skipped.",
				},
				// No link: a booking seller already works out of Orders, and a
				// second "Open orders" straight under the counter note's reads as
				// filler. The counter note keeps it — that seller lives on the
				// counter screen, so the link actually takes them somewhere.
			},
		],
	},
	{
		version: "2026.09.6",
		date: "2026-09-20",
		// Not notable, by the corpus's three triggers: nothing moved, no number
		// a seller pays changes, and everything here is additive — a seller who
		// reads nothing keeps exactly the behaviour they had yesterday. The
		// counter-argument (put to Zaki in the release PR): a store WITH opening
		// hours set will start seeing pickup times on self-collect orders
		// without having asked, which is new information arriving unbidden —
		// but it arrives labelled, on the order card, where it explains itself.
		notable: false,
		entries: [
			{
				kind: "feature",
				title: {
					en: "Say how long each product takes to make — and buyers book a time you can meet",
				},
				body: {
					en: "A cake that needs two hours shouldn't be collectable in fifteen minutes. Give any product a prep time and checkout does the maths: a buyer ordering for today is only offered times you can actually meet — and told why, \"needs 2 hours to prepare\", instead of a bare \"unavailable\" — while tomorrow's orders absorb the wait overnight. Self-collect orders now carry a pickup time inside your opening hours, so \"when are they coming?\" finally has an answer on the order. And the new pickup note — \"side counter\", \"bring an ice bag\" — travels the whole way: storefront, checkout, the WhatsApp confirmation and the buyer's order page. Counter sales skip all of it, because you're standing right there. On every plan.",
				},
				href: spotlightHref("prep_time"),
				hrefLabel: { en: "Set a prep time" },
				icon: "clock",
			},
			{
				kind: "feature",
				title: {
					en: "Open for breakfast, closed till dinner? Your hours can say so now",
				},
				body: {
					en: "A day in your opening hours can now hold two windows — 7:30 to 10:00 for the breakfast crowd, then 5:00 to 9:00 for dinner. Buyers picking a delivery or collection time are held to both windows, and the stretch between them counts as properly closed instead of something your hours couldn't express. Days with one window carry on untouched. On every plan.",
				},
				href: spotlightHref("opening_hours"),
				hrefLabel: { en: "Edit your hours" },
			},
			{
				kind: "enhancement",
				title: {
					en: "Give your address a unit number, and keep the map pin",
				},
				body: {
					en: "Riders and buyers were reaching the right block and phoning to ask which door. Your business address and every pickup point now take a unit line — floor, unit, building — typed once and printed everywhere the address already goes: checkout, the buyer's order page, delivery bookings, labels. It rides beside the map pick instead of replacing it, so the one-tap Waze button keeps working.",
				},
				href: spotlightHref("business_address"),
				hrefLabel: { en: "Add your unit" },
			},
			{
				kind: "enhancement",
				title: {
					en: "The new-order alert tells you who and how much",
				},
				body: {
					en: "The pop-up used to read \"New order ORD-XCVE\" — an order id, and nothing you can triage on. It now leads with the buyer's name and the total, and tapping anywhere on it opens the order, not just the small button. The phone notification carries the same facts.",
				},
			},
			{
				kind: "fix",
				title: {
					en: "Importing your own export updates your products, not copies them",
				},
				body: {
					en: "Export your catalogue, fix a cell, import it back — the exact loop the import screen suggests. But a product without a SKU (every booking listing, for a start) came back marked \"new\", and confirming would have created a duplicate. The sheet's own handle column now does the matching, so your export always finds the products it came from. Hand-typed sheets still match by SKU, exactly as before.",
				},
				href: "/app/products/import",
				hrefLabel: { en: "Open import" },
			},
			{
				kind: "fix",
				title: {
					en: "The orders table stopped shoving the whole page sideways",
				},
				body: {
					en: "Switch on enough columns with the sidebar open and the entire dashboard could scroll sideways, carrying the Columns and Export buttons off the edge of the screen. The table now scrolls inside its own box and the page stays put.",
				},
			},
		],
	},
	{
		version: "2026.09.5",
		date: "2026-09-15",
		// Notable, and not a close call — on two counts now. (1) MONEY MOVES:
		// the monthly order allowance drops on Pro and Scale and Scale's price
		// rises, and both land on every existing paying seller with no
		// grandfathering. A seller who reads nothing will meet the new number on
		// an invoice, which is the worst place to meet it. (2) A DAILY JOB MOVES:
		// tomorrow a seller opens the product editor and the stock box they have
		// always typed into is gone. The in-editor helper line only reaches
		// someone already looking at that row, and nothing at all would tell them
		// the products list grew a Stock button or that importing a sheet no
		// longer touches their counts.
		notable: true,
		entries: [
			{
				kind: "enhancement",
				title: {
					en: "New monthly order allowances, and a new price for Scale",
				},
				body: {
					en: "Two changes to plans, and we would rather you heard them here than on an invoice. The monthly order allowance is now 200 on Pro and 400 on Scale. It stays a soft line: passing it never stops an order, never closes your storefront and never turns a buyer away — it shows in your usage and we talk about the right plan. Scale moves to RM399 (S$149) from your next invoice; Starter and Pro keep their prices, and founding members keep their discount on the new numbers.",
				},
				href: spotlightHref("plan_change"),
				hrefLabel: { en: "See your plan" },
				icon: "wallet",
			},
			{
				kind: "feature",
				title: {
					en: "Nothing to pay until your first real order",
				},
				body: {
					en: "A new store now starts free and stays free until it actually sells something. Your first live order starts the billing — whichever door it comes through: storefront, counter, claim link or booking. If a fortnight goes by without one, day 14 starts it instead. The first invoice arrives minutes later rather than in the same breath as the order, and you can still switch plan before you pay it.",
				},
				href: "/app/settings?tab=billing",
				hrefLabel: { en: "Open billing" },
			},
			{
				kind: "feature",
				title: {
					en: "Going quiet for the season? Pause instead of cancelling",
				},
				body: {
					en: "The durian's done, the school holidays are over, the night market shuts for a month — whatever your quiet season looks like, you can park your subscription at RM19 a month (S$9) instead of paying the full tier or cancelling and losing the lot. Products, orders and customers all stay exactly where you left them, and your storefront tells buyers you are on a break. Resume whenever. We say what a pause and a resume will bill before you tap either.",
				},
				href: spotlightHref("seasonal_hold"),
				hrefLabel: { en: "Find the hold" },
			},
			{
				kind: "feature",
				title: {
					en: "Subscribe yourself, and let it renew itself",
				},
				body: {
					en: "Starting a subscription is now something you do in Settings — pick a plan, pay, done, with no message to us in the middle. Leave auto-renewal on and each month pays itself with the card or Touch 'n Go you set up; switch it off and you get a Pay-now link instead. A failed charge is retried and told to you, never quietly doubled.",
				},
				href: spotlightHref("auto_renewal"),
				hrefLabel: { en: "Set up auto-renewal" },
				icon: "wallet",
			},
			{
				kind: "enhancement",
				title: {
					en: "Change plan mid-month without losing what you paid",
				},
				body: {
					en: "Moving up used to mean waiting for the month to turn. Now it takes whatever is left of the period you already paid for, converts it into days on the new plan, and shows you that sum before you confirm. Moving down is scheduled for the end of the period instead, so you keep what you bought until it runs out. Both say what it costs and when it happens.",
				},
				href: spotlightHref("plan_change"),
				hrefLabel: { en: "Change your plan" },
			},
			{
				kind: "fix",
				title: {
					en: "Insights stopped counting deposits as money you earned",
				},
				body: {
					en: "A refundable security deposit is your customer's money right up until it isn't — but the revenue rows were adding it to your earnings, so every booking store's numbers read high. Deposits are now left out of the earned figures, and the page says so, instead of leaving you to wonder where the difference went.",
				},
				href: "/app/insights",
				hrefLabel: { en: "Open Insights" },
				icon: "chart",
			},
			{
				kind: "enhancement",
				title: {
					en: "An order card names the deposit inside its total",
				},
				body: {
					en: "A booking's total quietly included the refundable deposit, so the number on the card and the number you actually keep were two different things. The card now names the deposit inside the total — read a day's orders without doing the subtraction in your head.",
				},
				href: "/app/orders",
				hrefLabel: { en: "Open orders" },
			},
			{
				kind: "enhancement",
				title: {
					en: 'A small "Powered by Kedaipal" on your buyer pages',
				},
				body: {
					en: "A quiet line on your storefront, your order pages and your printed labels. It sits below your own content, never above it, and nothing about your branding changes. It is a link, so when someone arrives through it and opens their own shop, we can see the introduction came from you.",
				},
			},
			{
				kind: "fix",
				title: {
					en: "Confirm buttons stopped hiding below the bottom of the screen",
				},
				body: {
					en: "On a small phone a long dialog could push its own Cancel and confirm buttons off the bottom — a fine way to make a confirmation impossible. Dialogs now cap their height and scroll inside, so the buttons stay where your thumb is.",
				},
			},
			{
				kind: "feature",
				title: {
					en: "Stock has its own button now — and a save can't undo your sales",
				},
				body: {
					en: "Tap Stock on any product to add what you made or take off what you sold, and the count updates on its own. Before, stock was a box in the product form: if you opened it, sold a few, then saved a small edit like a spelling fix, the old number went back and those sales came back with it. That can't happen any more.",
				},
				href: "/app/products",
				hrefLabel: { en: "Open products" },
				icon: "package",
			},
			{
				kind: "enhancement",
				title: {
					en: "Importing a sheet won't overwrite your stock unless you say so",
				},
				body: {
					en: "A sheet you exported this morning holds this morning's counts, so importing it in the afternoon used to undo everything sold in between. Now stock is left alone unless you tick \"Update stock too\" — and when you do, we tell you how many counts it replaces and how many would go up, so a stock take still works and a price change can't cost you sales.",
				},
				href: "/app/products/import",
				hrefLabel: { en: "Open import" },
			},
			{
				kind: "fix",
				title: {
					en: "A cancelled order stays cancelled",
				},
				body: {
					en: "Marking a cancelled order as confirmed again used to hand its stock back a second time, so your counts could drift above what you actually had — and then the shop would keep taking orders for items you'd run out of. Cancelled orders can no longer be reopened; start a new order instead.",
				},
			},
		],
	},
	{
		version: "2026.09.4",
		date: "2026-09-08",
		// The modal, by owner call (Zaki, 8 Sep): the weekend rate was asked for
		// by the booking anchor seller, and a feature someone asked for should
		// greet them on their next open rather than wait behind a dot. The
		// entry's deep link makes the interruption worth it — one tap lands on
		// the card, ringed. The two fixes ride along.
		notable: true,
		entries: [
			{
				kind: "feature",
				title: {
					en: "Charge more for Friday and Saturday nights (at last)",
				},
				body: {
					en: "Campsites, chalets, homestays: the weekend is worth more, and your listing could only say one price. A stay listing now takes a second per-night rate, and you pick the nights it covers — Friday and Saturday by default, Thursday too if that's your crowd. It's the night you sleep that counts, so Sunday night into Monday morning is still a Sunday. Guests see both rates before they pick dates, the pricier nights wear a dot on the calendar, and the receipt itemises weekday nights and weekend nights on their own lines so nobody has to squint at the total — your order shows the same split, nights named. Packages sit this one out: a package is one flat price, and the form says so in the rate's place. On every plan.",
				},
				href: spotlightHref("weekend_rate"),
				hrefLabel: { en: "Set a weekend rate" },
				icon: "calendar",
			},
			{
				kind: "fix",
				title: {
					en: "A stay is not a parcel, and the app has stopped insisting",
				},
				body: {
					en: 'A few corners still treated a booking like a box: a Shipment tracking card on the order, "Delivery on 17 Sep" sitting under a card that already said Check-in, a little truck beside "Checked in", and the immortal "2 night(s)". All gone, on your order page and on the guest\'s tracking page alike. Riders, couriers and tracking numbers still turn up exactly where an actual parcel is involved.',
				},
				href: "/app/orders",
				hrefLabel: { en: "Open orders" },
			},
			{
				kind: "fix",
				title: {
					en: "A two-night package stays a two-night package",
				},
				body: {
					en: "Reopen a package listing sold in nights and it would greet you as months — and saving would make that true. The unit you chose is now the unit you get back. While we were in there: the deposit line in the listing wizard speaks your store's currency, instead of insisting on RM to Singapore sellers.",
				},
				href: "/app/products",
				hrefLabel: { en: "Open products" },
			},
		],
	},
	{
		version: "2026.09.3",
		date: "2026-09-07",
		// Earns the modal on two counts. (1) Things MOVED: Lalamove keys and the
		// HitPay card left the tabs sellers learned them in for a new
		// Integrations tab — the textbook "wait, where did that go?" moment, and
		// a seller hunting Settings for their payment gateway is exactly who the
		// modal exists for. (2) A NUMBER CAN MOVE for buyers: a store with both
		// riders and Delyva armed now charges the higher of the two quotes at
		// checkout, and a seller who can't explain their own delivery fee to a
		// customer loses more trust than one modal costs.
		notable: true,
		entries: [
			{
				kind: "feature",
				title: {
					en: "Meet Delyva: nationwide couriers and cold chain, booked from the order",
				},
				body: {
					en: "Riders are brilliant across town and a bit hopeless with a frozen box bound for Kuching. So: connect your Delyva account with one key (yes, one — we fetch the rest ourselves), set a pickup address and a default parcel type, and every confirmed delivery order grows a courier picker. Check the weight, see real prices with the cheapest already ticked, tap to book. The tracking number finds its way to the buyer's order page on its own. Riders and couriers can both be on at once — you pick per order. Delyva is on Pro, like rider booking.",
				},
				href: spotlightHref("delyva"),
				hrefLabel: { en: "Connect Delyva" },
				icon: "truck",
			},
			{
				kind: "enhancement",
				title: {
					en: "Your connected accounts moved into one tab (don't panic)",
				},
				body: {
					en: "Lalamove keys used to hide inside the delivery-charge settings and HitPay lived under Payments, which made sense to exactly nobody. Lalamove, Delyva and HitPay now share a Settings → Integrations tab: keys, webhooks, which account is connected, the lot. Fulfilment keeps the behaviour — what you charge, plus a Courier booking section with one toggle per provider. Nothing was disconnected; it simply has a proper home.",
				},
				href: "/app/settings?tab=integrations",
				hrefLabel: { en: "Open Integrations" },
				icon: "settings",
			},
			{
				kind: "enhancement",
				title: {
					en: "Live courier pricing now asks every courier you've switched on",
				},
				body: {
					en: "With riders and Delyva both on, checkout used to ask only Lalamove for a price — then you'd book Delyva at a different one and quietly eat the gap. Now every provider you've connected bids, and the buyer pays the higher quote, so whichever one you book, the fee covers it. Book the cheaper one and the difference is yours; the dispatch card shows \"buyer paid\" next to every price so it's an informed choice. With one provider on, nothing changes. Chilled or frozen carts only ask Delyva, because a rider is not a fridge. Under Delivery charges, on Pro.",
				},
				href: spotlightHref("delivery_charge"),
				hrefLabel: { en: "Check your delivery charge" },
				icon: "wallet",
			},
			{
				kind: "feature",
				title: {
					en: "Singapore stores: riders, at last",
				},
				body: {
					en: "If your store is in Singapore, Lalamove rider booking is now yours too — and in a city that is also the country, a rider covers pretty much every address. Paste your Singapore Lalamove keys under Integrations, switch on Courier booking under Fulfilment, and book from any confirmed delivery order. Live courier pricing works there as well. One heads-up: Lalamove keys belong to one market, so if you ever switch your store's country you'll need a fresh pair.",
				},
				href: spotlightHref("lalamove"),
				hrefLabel: { en: "Add your Lalamove keys" },
			},
			{
				kind: "feature",
				title: {
					en: "Pay for a year, get two months on the house",
				},
				body: {
					en: "Pro sellers with a couple of paid invoices behind them will find an annual option in Settings → Billing: pay for ten months, get twelve. One bank transfer instead of twelve reminders from us — which, frankly, we like too. Tap the card and the WhatsApp message is already written. Got a monthly invoice open? We'll swap it for the annual one before you pay, unless it's due within a few days, in which case settle that one and we'll switch you at the next renewal. Change your mind later and the unused months are credited to your next plan or invoice, never lost.",
				},
				href: spotlightHref("annual_billing"),
				hrefLabel: { en: "See the annual offer" },
				icon: "wallet",
			},
			{
				kind: "feature",
				title: {
					en: "Put your registered business on your invoices",
				},
				body: {
					en: "A corporate customer's finance team wants a registered name and an SSM number on paper, not just your store name. Fill in Business details under Settings → Store — legal name, SSM or UEN, billing address, tax number, a billing contact — and it prints in the From block of every invoice and receipt you issue. Every field is optional. It appears only on those PDFs: your storefront never shows it, and it is nothing to do with the pickup address you use for delivery pricing, which stays private.",
				},
				href: spotlightHref("business_details"),
				hrefLabel: { en: "Add business details" },
				icon: "printer",
			},
			{
				kind: "fix",
				title: {
					en: 'The button finally says "invoice" when it means invoice',
				},
				body: {
					en: "An unpaid order's PDF has always been an invoice — the download button just insisted on calling it a receipt. It now reads Download invoice until the order is paid, then Download receipt, on your order page, the counter screen and the buyer's tracking page alike. So a customer whose company pays for them can forward the right document without a raised eyebrow.",
				},
				href: "/app/orders",
				hrefLabel: { en: "Open orders" },
			},
			{
				kind: "feature",
				title: {
					en: "A proper receipt once you've paid us",
				},
				body: {
					en: 'Your paid subscription invoices used to keep saying "Total due" forever, which is an awkward thing to hand an accountant. Every paid invoice in Settings → Billing now has a second download: a receipt with the date, the method and the amount paid — and no payment instructions. The original invoice stays exactly as it was, right beside it, so your records still match ours.',
				},
				href: spotlightHref("invoice_history"),
				hrefLabel: { en: "Download a receipt" },
			},
			{
				kind: "fix",
				title: {
					en: "Wrong-country phone numbers now explain themselves",
				},
				body: {
					en: 'Type a +65 number into a Malaysian store (or a +60 into a Singapore one) and you used to get a flat "enter a valid mobile number". It now says what it saw — "that looks like a Singapore mobile number" — and in your Settings it points you to the Store tab, where your country lives. Singapore stores also stop hearing about DuitNow: the home checklist and the payment placeholders speak PayNow now.',
				},
				href: spotlightHref("store_country"),
				hrefLabel: { en: "Check your store country" },
			},
		],
	},
	{
		version: "2026.09.2",
		date: "2026-09-02",
		// Earns the modal even though 2026.09.1 shipped the day before —
		// considered, not overlooked. Two things here are invisible otherwise: a
		// NUMBER MOVES (an order that arrives confirmed leaves the "Confirmed"
		// count and lands on a new "Not yet opened" row), and a seller who reads
		// that count every morning and gets no explanation stops trusting the
		// inbox; and "pinned only" is the THIRD position of a chip nobody taps
		// twice on spec. Reach is barely the argument either way — `autoOpen`
		// fires on ANY unseen notable release, so a seller who missed 2026.09.1
		// already gets one modal carrying both. The cost falls only on sellers
		// who opened yesterday, and an unexplained count is worse than a tap.
		notable: true,
		entries: [
			{
				kind: "feature",
				title: {
					en: "See who's with you right now",
				},
				body: {
					en: "Three new chips for stays and packages: Active now, Ending this week, Upcoming. A member three weeks into their month used to sit buried below next week's arrivals, because a booking lists under the day it starts — tap Active now and you get everyone currently on your books. Bookings also show where they are in their span (\"Active · 4 days left\"), on the order and on the customer's card. On every plan, like the rest of bookings.",
				},
				href: "/app/orders",
				hrefLabel: { en: "Open orders" },
				icon: "calendar",
			},
			{
				kind: "enhancement",
				title: {
					en: "Your status chips and the Filters panel are one control now",
				},
				body: {
					en: 'They were two separate filters sharing one name: you could tick every status under "In progress" in the Filters panel and watch the "In progress" chip stay dark. They are one control now — tap a chip and the panel shows it, and back again. The panel lists each status under the chip that counts it, so a stage you renamed yourself is easy to place. Two chips together now mean either, not both, so "In progress" plus "Active now" no longer gives you an empty list. Filtering is part of the Order Inbox, on Pro.',
				},
				href: "/app/orders",
				hrefLabel: { en: "Open orders" },
			},
			{
				kind: "feature",
				title: {
					en: "Tap Pinned again for a list of just your pinned orders",
				},
				body: {
					en: 'The Pinned chip has three positions now: pinned first, pinned only, then off. "Only" is the shortlist — the handful of orders you are keeping an eye on and nothing else, still narrowed by whatever else you have set. Pins show on cards at last, not only in the table: a filled pin by the customer\'s name and a tinted edge, so "why is this one at the top?" has an answer on a phone. It is a marker there — pin and unpin from the order itself or a table row. On every plan, all three positions.',
				},
				href: "/app/orders",
				hrefLabel: { en: "Open orders" },
			},
			{
				kind: "fix",
				title: {
					en: "Orders that arrive already confirmed are counted where they belong",
				},
				body: {
					en: 'An order placed straight from your storefront arrives confirmed and counted towards New — but no status you could tick would find it, so your chips and your Filters panel disagreed about the numbers. It has its own status now, "Not yet opened", which you can see and filter for. Expect your Confirmed count — or whatever you renamed it to — to read a little lower, with the difference on that new row. Nothing moved; it is counted in the right place. "Awaiting approval" is filterable at last too.',
				},
				href: "/app/orders",
				hrefLabel: { en: "Open orders" },
			},
			{
				kind: "fix",
				title: {
					en: "An empty list now tells you why, and how to get back",
				},
				body: {
					en: "Filter down to nothing and you used to get a blank box. In Table view the message was there all along, just rendered far off to the right of the screen where nobody would ever see it. It sits where you are looking now, names the filter that emptied the list, and carries the button that undoes it — including when the pin was the culprit, which is easy to land on by accident now that the chip cycles.",
				},
				href: "/app/orders?view=table",
				hrefLabel: { en: "Open the table" },
				icon: "table",
			},
		],
	},
	{
		version: "2026.09.1",
		date: "2026-09-01",
		// Earns the modal: a whole new way of selling — date-range bookings with
		// approval, deposits, packages and a calendar — plus one change that
		// touches EVERY seller (a cancellation now carries a reason to the
		// buyer). A booking-capable seller who reads nothing keeps turning stays
		// away in chat by hand; that is the exact workflow this release replaces.
		notable: true,
		entries: [
			{
				kind: "feature",
				title: {
					en: "Take bookings — guests pick dates, you approve or decline",
				},
				body: {
					en: "If you rent out plots, rooms, gear or your time, create a booking listing: guests pick check-in and check-out on a calendar that already hides full or closed nights, and send you a request — nothing is charged and no dates are promised until you approve. Approving sends the usual confirmation with the payment link; declining asks you for a reason, which the guest sees word for word. A request you don't answer releases its dates on its own after 24 hours, and the order page counts that clock down for you.",
				},
				href: "/app/products/new",
				hrefLabel: { en: "Create a booking listing" },
				icon: "calendar",
			},
			{
				kind: "feature",
				title: {
					en: "A month calendar for your stays — and two taps to close dates",
				},
				body: {
					en: 'Once you have a booking listing, the top of your orders page gains a Calendar view: a month grid showing how many spots are taken each night, with a tap on any day listing that night\'s stays. Tap "Block days…" and then a start and an end to close a range — the whole store or one listing, with a note for yourself. Blocking only stops new requests; any stay already on those dates stays exactly where it is.',
				},
				href: "/app/orders/calendar",
				hrefLabel: { en: "Open the calendar" },
			},
			{
				kind: "feature",
				title: {
					en: "Collect a refundable security deposit in the same payment",
				},
				body: {
					en: "Set a deposit on a booking listing and it is stated on the listing page before anyone requests, carried as its own line on every total and receipt, and collected together with the stay in the one payment at approval. After check-out, the order page reminds you to return it — mark it returned in full, or keep part of it with a reason the guest sees. Deposits are held money, so they never count towards your revenue in Insights or a customer's spend.",
				},
				icon: "wallet",
			},
			{
				kind: "feature",
				title: {
					en: "Fixed-length packages and instant book",
				},
				body: {
					en: "Selling a one-month pass or a fixed 3-day package instead of an open-ended stay? Give a booking listing a package length and one flat price — the guest just picks a start date. Turn on Instant book and the approval step disappears: the booking confirms the moment it's placed, with the confirmation sent straight away. Capacity is now optional too — leave it empty and there's no daily limit at all.",
				},
				href: "/app/products",
				hrefLabel: { en: "Open your listings" },
				icon: "package",
			},
			{
				kind: "feature",
				title: {
					en: "See it all in Google Calendar",
				},
				body: {
					en: "Stores with a booking listing get a new Bookings section in Settings, holding a private calendar link. Paste it into Google Calendar (Other calendars → From URL) and your stays, your blocked dates — and every other order you have due, deliveries and pickups included, with their times — appear alongside the rest of your life. Google refreshes it on its own schedule, usually within a day; your Kedaipal calendar is always live. The link is a secret — you can replace it any time if it leaks.",
				},
				href: "/app/settings?tab=bookings",
				hrefLabel: { en: "Connect Google Calendar" },
			},
			{
				kind: "enhancement",
				title: {
					en: "Cancelling an order now tells the buyer why",
				},
				body: {
					en: "The cancel dialog asks for a reason and shows it on the buyer's order page, so nobody is left staring at a bare \"cancelled\". It's optional for everyday orders and required when you decline or cancel a booking — someone planned a trip around those dates. Cancelling several orders at once asks once and applies your reason to all of them. The reason is always visible to the buyer, so write it for them.",
				},
			},
		],
	},
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
					en: "Tap the pin on an order — on a table row or the order itself — and it stays at the top of your list. It stays there even when your filters would otherwise hide it, so you can park a problem order on top and carry on working through everything else. Nothing ever unpins itself, not even once the order is delivered: that stays your call, and the Pinned chip tells you how many you're holding.",
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
