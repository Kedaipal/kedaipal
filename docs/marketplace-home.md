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

1. **Not opted out** — `retailers.marketplaceUnlistedAt` unset. Listing is the
   DEFAULT (the storefront is already a public URL; the directory is free
   distribution). The opt-out lives in **Settings → Store → Marketplace
   listing** (`MarketplaceCard`), which is also where sellers LEARN they're
   listed — the toggle shipped in the same PR as the page, per the
   no-hidden-behaviour rule. Stamped, not boolean; re-saving off keeps the
   first stamp.
2. **Has ≥ 1 storefront-visible product** — same filters as `products.list`
   (active, not `hidden`, not `hiddenByCategory`, not a finished event), first
   20 active rows checked. An empty storefront is a dead end we don't route
   buyers into.
3. **Not purging** (`purgeStartedAt` unset).

**Billing state is deliberately absent** — the storefront never hides on
subscription state (convex/subscriptions.ts invariant) and the directory
follows the storefront. An `on_hold` store lists as **browse only** (the card
says so via `orderingPaused`, outranking the open-now clock).

## Ordering

Client partitions one payload (`partitionStores` in `src/lib/marketplace.ts`):

- **Sponsored rail** — `marketplaceSponsoredUntil > now`
  (`sponsorshipActive`, read-time expiry, no cron). Every placement renders a
  visible **"Sponsored"** label; the rail is disclosed advertising, never
  covert ranking. **Admin-set only** (`admin.setMarketplaceSponsorship`,
  audited `marketplace.sponsor.set/clear`, future-only, from the seller
  directory's Manage menu → `SponsorDialog`; end date inclusive). V1 is
  manually invoiced — self-serve purchase is a future ticket.
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
empty region is an acquisition CTA, not a dead end. Search + chips (All /
Open now / New this month / Delivers) are client-side over the one payload
(`filterStores`, unit-tested); refining collapses the shelves into a flat
Results list. "Open now" derives client-side from `openingHours` +
`closedDates` via `openNowStatus` (`cardOpenStatus` — same author as the
storefront hours pill, minute tick, hydration-safe).

Cards: `StoreCard` (row on mobile, grid on desktop — one component, two
variants), `SponsoredCard` (the one cover-image shape; initials watermark
fallback), `FoundingShelf`. Logo tiles reuse `StoreLogoTile` (new `card`
size). `storeArea` (new optional profile field, ≤ 40 chars, Settings card) is
the card's one geographic hint — the profile has no city field.

## Payload safety

`MarketplaceStoreCard` is card fields ONLY — no `_id`, no contact numbers, no
subscription/payment/courier config (pinned by the leak test in
`convex/marketplace.test.ts`). Cover URLs resolve only for sponsored cards.

## Namespace + scale notes

- `stores` moved from the reserved GENERIC group into `LIVE_ROUTES`
  (`convex/lib/reservedSlugs.ts`); the gate test enforces the move. The
  reserved list never applied retroactively — **prod was to be checked for a
  pre-existing `stores` slug before merge** (release checklist item).
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
(toggle + area form + discoverability link).
