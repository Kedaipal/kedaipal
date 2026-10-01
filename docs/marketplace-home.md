# Marketplace home — the buyer directory at `/stores` (z8r3fdkmyp)

The first cross-store buyer surface: `kedaipal.com/stores` lists every listed
store — a labelled **sponsored highlights** rail, **The Founding 10** shelf,
then the full searchable list. Mockups that drove the build:
https://claude.ai/artifact/6jdpHLyCoi2wcdANAQt7HP (mobile, desktop, card
states).

## Who is listed — the listable rule

One author: `convex/lib/marketplaceListing.ts` (row rules, pure) +
`hasVisibleProduct` beside the query in `convex/marketplace.ts`.

A store lists when ALL hold:

0. **Not internal** — Kedaipal's own or a test store (`isInternalStore`: the
   founder report's `isExcludedRetailer` — admin-owned, internal email
   fragments, the `EXCLUDED_SLUGS` escape hatch — plus an `internal` comp).
   Caught before launch: prod held three such stores with live products
   (kp-demo, openmarket, deqly-cards). The seller card says so for these
   instead of claiming "Shown in the directory".
1. **Not hidden by an admin** — `retailers.marketplaceHidden` unset (see
   [Admin hide](#admin-hide--moderation-over-the-sellers-switch)). It
   outranks the seller's switch.
2. **Not opted out** — `retailers.marketplaceUnlistedAt` unset. Listing is the
   DEFAULT (the storefront is already a public URL; the directory is free
   distribution). The opt-out lives in **Settings → Store → Marketplace
   listing** (`MarketplaceCard`), which is also where sellers LEARN they're
   listed — the toggle shipped in the same PR as the page, per the
   no-hidden-behaviour rule. Stamped, not boolean; re-saving off keeps the
   first stamp. The card's status line tells the truth about the DIRECTORY,
   not the switch: ON with no visible product reads "On, but not shown yet"
   with an Add-a-product link — fed by `marketplace.myListingReadiness`, a
   separate query so the product read stays off `getMyRetailer`'s hot path.
3. **Has ≥ 1 storefront-visible product** — same filters as `products.list`
   (active, not `hidden`, not `hiddenByCategory`, not a finished event), first
   20 active rows checked. An empty storefront is a dead end we don't route
   buyers into.
4. **Not purging** (`purgeStartedAt` unset).

**Billing state is deliberately absent** — the storefront never hides on
subscription state (convex/subscriptions.ts invariant) and the directory
follows the storefront. An `on_hold` store lists as **browse only** (the card
says so via `orderingPaused`, outranking the open-now clock).

## Admin hide — moderation over the seller's switch

Zaki, 1 Oct 2026: an admin can take any store off `/stores` from the
directory's **Manage → Hide from /stores** (junk trials, quality, policy).
Written only by `admin.hideFromMarketplace` / `admin.showOnMarketplace`, each
audited under its own name with the store as `targetId`, so the log says
which happened. Both are idempotent: re-hiding keeps the first stamp and
note, and a double-click writes no second audit row. Hiding an internal store
is refused, since it's never listed anyway.

- **Only the directory changes.** The storefront link, orders and WhatsApp
  carry on. The confirm dialog says so before the admin commits.
- **The seller is told** (no hidden behaviour): their Settings → Store card
  reads "Kedaipal has hidden your store from the directory…" in place of the
  directory status. It shows the admin's optional **note to the seller**
  (`HIDDEN_NOTE_MAX` = 200, collected in the confirm dialog) and a WhatsApp
  "ask us" link. Their switch still works, and its toast now says what the
  switch did ("Marketplace listing turned on."), never "your store is listed".
  That was already false for a store with no visible product.
- **Not on the public payload.** Moderation state stays between Kedaipal and
  the seller: it rides `myListingReadiness` (seller-auth) and the admin row,
  never `getRetailerBySlug`. So the storefront's "Discover more stores" door
  still follows only the seller's own switch. A hidden seller who doesn't
  want to send buyers to the directory can turn the switch off themselves.
- **Admin surfaces:** a "Hidden from /stores" pill on the slug line (it
  outranks a highlight pill — a hidden store isn't on the rail); the Manage
  item reads "Show on /stores again · Hidden since …" and shows in one click
  (restoring the default; the toast warns when a seller opt-out still keeps
  it off). The details sheet shows the hide, the note, and "Seller opted out
  too" when both apply. The highlight dialog warns that a highlight won't show
  while hidden, and its settings are kept, marked "paused while hidden".

## Ordering

Client partitions one payload (`partitionStores` in `src/lib/marketplace.ts`):

- **Store highlights rail** — `highlightSource` (ONE author, shared by the
  buyer query and every admin surface) puts a store on the rail when:
  - **a paid window is live** — `marketplaceSponsoredUntil > now` (read-time
    expiry, no cron). Admin-set via `admin.setMarketplaceSponsorship` /
    `admin.endMarketplaceSponsorship`, each audited under its own function
    name, store as `targetId`. V1 is manually invoiced.
  - **or it's comped as partner / sponsor / pilot** (Zaki, 1 Oct 2026) —
    DERIVED from the subscription, never written, so revoking the comp takes
    it off with nothing to clean up (a far-future window would rot). The
    admin's one override is `marketplaceCompHighlightOffAt`
    (`admin.setCompHighlight`, audited; refused for a non-eligible store).
    `internal` comps never qualify — they're never listed.
  A paid window wins over the switch. Every card on the rail is labelled
  **"Sponsored"** to buyers whatever the reason — the label says the
  position is promoted, not earned by ranking, which is true of both; the
  reason never leaves the server (it would reveal billing state).
  **Admin vocabulary is "Highlight"**, not "Sponsored": "Sponsor" is already
  a comp kind in the same directory row, and the two were confused in
  testing. Surfaces: a `HighlightPill` on the slug line ("Highlight · to 8
  Oct" / "Highlight · comped"), a Manage item naming the state (incl.
  disabled-with-reason for internal stores), `HighlightDialog` (internal: no
  controls; comped: the switch; otherwise: the dated window with Update
  disabled until the date moves), and a Marketplace row in the details sheet.
- **The Founding 10** — `foundingMemberRank` ascending, shipped badge reused
  (as a plain emblem, not the popover button — the whole card is a link).
- **General list** — activated stores first (newest `activatedAt`), then
  never-activated by newest `createdAt`. Data-derived per the
  storefront-landing precedent (no hand-picked "featured"); the named upgrade
  path is a denormalized recent-order-activity rank.

Shelf stores still appear in "All stores" — promotion never makes a store
unfindable in the full list.

## The page

`src/routes/stores.tsx` — buyer surface, so it **SSRs** (`ssrRead` loader →
`head()` meta/canonical/**ItemList JSON-LD**, soft-degrade on upstream
failure), is in `sitemap.xml`, and the component re-reads through the TanStack
adapter. Region (MY/SG) reuses the landing's `useLandingRegion` + a
`RegionToggle` — regions never blend; the count fact names the region; an
empty region is an acquisition CTA, not a dead end (and the CTA band steps
aside there — one ask, once). Search + chips (All / Open now / New this
month / Delivers) are client-side over the one payload (`filterStores`,
unit-tested) but their STATE lives in the URL (`?q=`, `?filter=`,
`parseMarketplaceSearch`), so Back from a storefront returns the buyer to the
view they left; "all"/blank are the absence of a param, so bare `/stores`
stays canonical. Refining collapses the shelves into a flat Results list.
Snapping rails carry `scroll-px-*` matching their gutter — without it
`snap-start` pulls the first card flush to the screen edge. The one nav CTA
is navy (the buyer's search owns mint on this page); the mesh band is
full-bleed with content in the page column. "Open now" derives client-side from `openingHours` +
`closedDates` via `openNowStatus` (`cardOpenStatus` — same author as the
storefront hours pill, minute tick, hydration-safe).

Cards: `StoreCard` (row on mobile, grid on desktop — one component, two
variants), `SponsoredCard` (the one cover-image shape; initials watermark
fallback), `FoundingShelf`. Logo tiles reuse `StoreLogoTile` (new `card`
size). `storeArea` (new optional profile field, ≤ 40 chars, Settings card) is
the card's one geographic hint — the profile has no city field.

## How buyers reach `/stores`

- **Storefront footer** — "Discover more stores on Kedaipal →" above the
  Powered-by badge (`StorefrontFooter discover`). Opt-in per page and ON only
  where a buyer is browsing: store home, category, product, and the
  store-not-found dead end. Never at checkout, a claim or an order page.
  Hidden for a store that opted out (`marketplaceUnlisted` rides the by-slug
  payload — public-safe). **Deliberately NOT a Kedaipal logo top-left**
  (considered, 1 Oct 2026): the top of a storefront is the seller's brand,
  and a header logo would walk a seller's own buyers to competitors — and to
  paid highlights — before they've bought.
- **Landing** — a "Browse their stores →" link on the Real-sellers proof
  section (the landing's one buyer-shaped door; the hero stays the seller
  pitch), and a footer **Explore** column (Browse stores · Blog). Both also
  in the mobile menu. **Not in the desktop nav bar**: it's capped at
  `max-w-5xl`, and measured in Bahasa two more links squeezed the logo to its
  mark at every width — the crowding that already moved `/cost` out. The
  blog URL lives in `src/lib/site-links.ts`.

## Card interaction

One hover/focus treatment for every card on the page (`CARD_INTERACTION_CLASS`
in `store-card.tsx`): a 2px lift, mint border, soft mint glow; keyboard focus
gets the same plus a ring. `hover:` only fires on hover-capable devices, and
reduced-motion keeps the colour but drops the lift. Mobile list rows tint
mint and nudge the chevron instead. Note for v4: the lift is the `translate`
property, so an arbitrary transition list must name `translate`, not
`transform`.

## Payload safety

`MarketplaceStoreCard` is card fields ONLY — no `_id`, no contact numbers, no
subscription/payment/courier config (pinned by the leak test in
`convex/marketplace.test.ts`). Cover URLs resolve only for sponsored cards.

**The ItemList JSON-LD is built from every seller's store name on one shared
page**, so it goes through `jsonLdScript` (`src/lib/json-ld.ts`), which
escapes `<`, `>` and `&` as `\uXXXX`. TanStack SSRs a head script's
`children` with `dangerouslySetInnerHTML`, and `JSON.stringify` leaves `<`
alone, so a store name such as `</script><script …>` (it fits the 60-char
cap) would close the tag and run on every buyer's visit to `/stores`. Found in
PR #324 review. The same raw stringify sat on the storefront, product and
landing routes, and all four now use the helper. `json-ld.test.ts` lets the
HTML parser judge each hostile name and fails on any other source file naming
`application/ld+json`.

## Namespace + scale notes

- `stores` moved from the reserved GENERIC group into `LIVE_ROUTES`
  (`convex/lib/reservedSlugs.ts`); the gate test enforces the move. The
  reserved list never applied retroactively, so prod was read before merge
  (1 Oct 2026, read-only): no store or slug-history row held `stores`. The
  same round fenced the directory's next shelves (`events`, `categories`,
  `featured`, `sponsored`, `founding`, `near-me`, … — new MARKETPLACE group)
  and the in-flight features' public nouns (`enterprise`, `advertise`,
  `credits`, `top-up`, `rsvp`) — zero prod collisions across all 18.
- `listStores` does a full-table `.collect()` over `retailers` plus one
  bounded product read per store — fine at low hundreds of stores, and the
  documented ceiling. Upgrade path: denormalize a `marketplaceListedAt` and
  index it once the table warrants it.

## Tests

`convex/lib/marketplaceListing.test.ts` (each listable clause bites),
`convex/marketplace.test.ts` (rule end-to-end through real mutations, payload
leak pin, sponsorship admin gate + audit), `src/lib/marketplace.test.ts`
(status label, filters, partition), `src/components/marketplace/store-card.test.tsx`
(card states over a real router), `src/components/settings/marketplace-card.test.tsx`
(the four status-line states incl. ON-but-not-shown + loading, area saves in
the stored shape, discoverability link), `src/components/admin/highlight-dialog.test.tsx`
(start / update-needs-a-change / end via its own mutation, inclusive end date, opted-out warning, comp switch, internal store), the directory pill in `app.admin.sellers.test.tsx`,
`src/components/storefront/storefront-footer.test.tsx` (the discover link),
`parseMarketplaceSearch` cases for the URL state, and `src/lib/json-ld.test.ts`
(escaping + the gate). Admin hide: the clause in `marketplaceListing.test.ts`,
end to end in `marketplace.test.ts` (admin-only, the seller's switch can't
relist past it, the note reaches the seller card but never the public
payload, idempotent audit, internal refused), the pill + Manage item in
`app.admin.sellers.test.tsx`, the dialog warning in `highlight-dialog.test.tsx`,
and the seller's hidden line in `marketplace-card.test.tsx`.
