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
   Separate from the hide: an admin can take the whole store **offline**
   ([store-availability.md](./store-availability.md), `z8r3fdudf7`), which
   also drops it from the directory and the sitemap, because its storefront
   is gone. Hiding only moves the listing.

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
stays canonical. Refining collapses the shelves into a flat Results list —
except a showcase's stores, which stay inside their showcase (see
[Searching keeps showcases](#searching-keeps-a-stores-showcase)).
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
  store-not-found dead end — **plus the order page**. Never at checkout or a
  claim page. Hidden for a store that opted out (`marketplaceUnlisted` rides
  the by-slug payload — public-safe — and the order read). **Deliberately NOT a Kedaipal logo top-left**
  (considered, 1 Oct 2026): the top of a storefront is the seller's brand,
  and a header logo would walk a seller's own buyers to competitors — and to
  paid highlights — before they've bought.
- **Order page** (`/track/<token>`, z8r3fducgw) — the same footer link, in
  **every** order state, unpaid included. **Decision (Arif, 14 Oct 2026)**,
  overriding the 1 Oct "never on an order page" rule for this page only:
  Yap's buyers found the order page a dead end, its only exit our seller
  landing. Trade-off accepted knowingly — more `/stores` traffic against some
  risk of an unpaid buyer wandering off — and mitigated by placement: below
  every payment card and below the page's own "Continue shopping at {store}"
  row, so the seller's store is always the first way out and other stores
  the second. **Revisit if the unpaid-order rate on stores with the link
  rises.** Checkout and claim pages stay off, pinned per page by
  `storefront-footer.test.tsx`. The link reads in Malay on a Malay store's
  order page (the only buyer page that localises its chrome).
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

## Showcases — a time-boxed section at the top, for an event (z8r3fdr6mv)

An admin can group the stores at an event — Malaysia Campfest, a Deepavali
bazaar, a partner pop-up — under one banner at the top of `/stores`, above
Store highlights, for as long as the event runs. Built for Campfest
(16–18 Oct 2026) and reusable for every fair after it, which is why nothing
in the code names an event. Mockups that drove the build (four rounds):
https://claude.ai/artifact/EsLcV4wWjkMnWJdbY9ZAkd — the picks were the D7
"stage" (the mobile ticket, unchanged, on a 2-column grid beside the title)
and a fanned **pile** of the real remaining tickets for "+N more".

**Vocabulary: a *showcase*, never an "event".** "Event" already means three
things in this codebase (an RSVP product, an event venue, the `event`
order-flow kind), and the directory was already bitten once by a name
collision ("Sponsor" the comp kind vs the "Sponsored" rail). Buyers never see
the word — they see the showcase's own title.

### The model

`marketplaceShowcases` (schema) — one row per showcase; the rules in
`convex/lib/showcase.ts`, the functions in `convex/showcases.ts`.

- **Members ride the row as a capped array** (`SHOWCASE_MEMBER_CAP` = 40)
  of `{ retailerId, label? }` — the booth label is the one per-store fact a
  showcase adds. A bazaar with more Kedaipal stores than that is a second
  showcase, so the document stays bounded.
- **The window is read-time, there is no cron.** `showcaseState(row, now)`
  is the one author: `draft` (unpublished — outranks the dates, a half-built
  showcase never reaches buyers) → `scheduled` (starts later) → `live` →
  `ended` (`endsAt` is exclusive, so a midnight end names the day before).
  The buyer page's minute tick re-evaluates it, so a showcase disappears
  from an open page the moment it ends.
- **The slug is minted once, from the title, and never rewritten**
  (`showcaseSlugFromTitle`, `-2`/`-3` on a clash). It is the
  `/stores?showcase=<slug>` handle on the booth QR, and a printed QR must
  survive a title edit.
- **Looks are a closed set of dark grounds** (`SHOWCASE_THEMES`), each a
  block of CSS variables in `styles.css` (`kp-showcase-<theme>`), so the
  banner, the ticket's info panel and the compact band carry one text
  treatment in light and dark mode. Six curated moods, plus:
  - **No tint** (`plain`) — the admin's cover in its own colours. The
    cover scrim reads its strengths from `--sc-scrim-*`, and this look turns
    it neutral and light: shade only behind the WORDS, because white text
    straight on a bright photo can't be read. With no cover it is plain
    charcoal.
  - **Custom** (`custom` + `customColor`, `#rrggbb`) — a colour wheel
    (`react-colorful`, pinned 5.6.1). **The admin picks the hue; we pick
    the shade:** `customShowcasePalette` (`src/lib/showcase-color.ts`)
    converts the pick to OKLCH and pins the lightness of the ground and the
    accent (perceptual, so a yellow and a blue at the same `L` read equally
    dark), capping chroma. No pick can put the white title on a pale
    ground. The palette is set inline by `showcaseLook`, which every surface
    that paints a showcase goes through; `update` refuses `custom` with no
    colour, and the colour is kept across look switches so switching back
    restores it (buyers only receive it while the look is `custom`).
  A cover photo is optional; the editor names a small one (< 1200px wide)
  the moment it lands rather than refusing it.
  **Every theme variable has ONE defining class** — the base holds what no
  look changes, each look its whole palette. Tailwind orders utilities by
  declaration count, not name, so a variable set in both is won by
  whichever sorts later; No tint lost its neutral ground to the base's green
  that way. `showcase.test.ts` fails on a duplicate. The cover fade is two
  utilities (`bg-showcase-cover-scrim` + `lg:bg-showcase-cover-scrim-wide`),
  never a media query, so the editor's phone preview on a desktop screen
  shades like a phone.
- **Every write is audited** under its own function name
  (`showcases.create` … `showcases.remove`) via `logGlobalAdminAction`,
  with the showcase as `targetId` — a showcase has no store in scope.
- **A deleted store leaves its showcases.** The account-deletion cascade
  has a `marketplaceShowcases` phase (paginated, like `optOuts`) that drops
  the tenant from every member list; the showcase itself survives — it is
  Kedaipal's curation, not the tenant's data, and holds no PII.

### Who shows — the directory's one rule, applied twice

A member only SHOWS if the store passes the directory's listable rule, and
that rule has one author: `notListedReason` (`convex/marketplace.ts`),
which `listStores` and the showcase functions both read.

- **Server side, `listShowcases` drops unlistable members** so the public
  payload never carries a store the directory hides — an admin-hidden
  store's cover must not ride out on a showcase. A showcase whose members
  are all unlistable is not in the payload at all (an empty banner is a dead
  end). The payload is slugs + labels + covers, no ids, no `publishedAt`.
- **Client side, `joinShowcaseMembers` joins each slug to its directory
  card** (name, logo, hours), in the admin's order, and drops a slug the
  directory doesn't carry — only possible in the moment between a store
  leaving the directory and the showcase payload catching up.
- **The admin is told, never surprised:** `getForAdmin` names the reason on
  every member row (`NOT_LISTED_COPY`: opted out, hidden by Kedaipal,
  taken offline by Kedaipal (the store on/off switch, z8r3fdudf7, read
  through `storeAvailabilityOf`), internal, purging, no visible product), and the editor's preview says
  "6 of 8 stores show to buyers". A store hidden by Kedaipal or opted out
  is still addable — it can come back, the booth may open tomorrow — but
  its row says so. **A Kedaipal or test store can't be added**: it never
  lists, so the picker greys it out with that reason and `setMembers`
  refuses it (a row already in the list is left alone, so a save never
  fails on a member the admin didn't touch).

### The buyer page

- **The stage** (`ShowcaseStage`, mode `stage`): the showcase's dark ground
  and art (or cover), the time chip ("Happening now", "Ends today", "Ends
  tomorrow", "Until Sun"/"Until 18 Oct" — `showcaseTimeFacts`), the title
  and tagline, and the stores as **tickets**. On a phone the tickets swipe
  in a rail (the next one peeks; the dots follow the swipe, measured on the
  rail's scroll event) with "See all N →";
  from `lg` the title stands left and up to five tickets stand on a 2-column
  grid, and past five the rest become a **fanned pile of the real tickets**
  in the sixth cell (`splitStage`, `PILE_FAN_MAX`) — honest about the
  count, each still a link to its store, tickets under the top one inert
  until the fan opens on hover/focus, the badge anchored to the cell so it
  never sits on a name.
- **The ticket** (`ShowcaseTicket`) is ONE shape at every size: an info
  panel (the store's own cover under a dark fade, or the showcase's theme
  ground with the initials watermarked large — so every panel is dark and
  every name is white whatever each store uploaded), the directory's own
  live status line under a dashed tear, and a stub with the booth label
  ("BOOTH / B4", "FOOD COURT / 7") or a tent mark reading "At event". The
  booth is said once, on the stub; the line under the name is the store's
  area. The notches are a real CSS-mask die-cut (`kp-ticket-cut`), so a
  cover or gradient behind the ticket shows through them. The
  paper is cream in every theme and in dark mode: it is a ticket.
- **Several live at once stack, never carousel**, under one "Happening now"
  heading (buyer words — they never see "showcase"). The first in admin
  order gets the stage; the rest get a `ShowcaseBand` (title, the time chip,
  a strip of store tiles, See all) under a centred **"More happening now"**
  divider (`ShowcaseDivider`), which the focused view uses too, so the
  other events read as a separate group from the one the buyer opened. Each stage already owns a sideways
  rail, and a carousel inside a carousel fights the thumb; and nothing
  auto-rotates — content that moves while someone is aiming a tap is
  frustrating and needs a pause control.
- **The focused view** (`/stores?showcase=<slug>`, mode `focused`) is the
  booth-QR landing: the hero's pitch, search and chips step aside, the
  compact header is DOCKED as the page's header (below), the
  showcase is the first thing under it with EVERY ticket laid out, an
  "Back to all stores" way back (not "All stores", which is also the
  filter chip's label in the docked header above it), and a Copy-link button. The loader reads the slug
  (`loaderDeps`) so the page's OG tags carry the showcase's title, tagline
  and cover — the link unfurls as the event in WhatsApp — while the
  canonical stays the bare `/stores`. A link to a live showcase in the OTHER
  region opens it anyway: the showcase's `country` is this visit's region
  (`resolveShowcaseFocus` — a roaming SG phone at a Malaysian fair must not
  read "isn't on right now"), derived per visit and never written to the
  visitor's stored pick, which also sets their pricing currency; picking the
  other region from the link leaves the showcase. A slug that is not live
  (the event ended, the QR outlived it) lands on the plain page with one
  line saying so; `parseShowcaseSlugParam` degrades anything else to "no showcase".
- **Searching keeps a store's showcase.** <a id="searching-keeps-a-stores-showcase"></a>
  A search or chip used to hide every showcase and list its stores as plain
  rows, so a buyer at Campfest who searched "Bearcamp" found the store but
  lost the booth label it was there for. Now (`matchShowcases`,
  `src/lib/showcase.ts`, unit-tested) each showcase with a matching store
  stays, as a `ShowcaseResults` container above the plain results: the
  showcase's ground, time chip and title, and EVERY matching ticket laid out
  (no rail, pile or band of faces, which would hide the store that was
  searched for), with "2 of 14 stores match · See all 14 →" to its focused
  view when the search left some out. The rules: a ticket matches on the
  directory's own rule (`matchesSearch` + `matchesChip`, the same predicates
  `filterStores` uses) **plus its booth label** ("A12" finds booth A12 — and
  both search boxes say "Search stores or booths…" while a live showcase in
  the region carries a label (the floating bar says "Stores or booths…" — its
  input is ~143px on a 375px phone and the long form was cut off),
  `storeSearchPlaceholder`, so the feature is discoverable and never
  promised where it can't match); a
  showcase with **no** match is not shown at all; the focused showcase
  leads, the rest keep admin order; a store in two showcases shows in
  **both** (each ticket carries that event's booth); and every matched store
  is **left out of the plain list**, which is headed "Other stores" when
  showcases matched, so no store appears twice in one short list. The
  "Results" heading counts every store that matched; "No stores match"
  shows only when nothing matched anywhere. Unrefined, "All stores" keeps
  every store, as before. The banner art and tagline step aside in this
  layout so two matching showcases don't push the plain results off a
  phone's first screen. On the booth-QR view "Clear search & filters"
  clears only what it names: a booth-QR visitor stays on their showcase. "See all" also clears the page's search box, which never reads
  `?q=` back mid-typing.
- **The compact header** (`StoresCompactHeader`) is **docked** on the
  booth-QR view (`docked`): there is no hero there, so it is the page's
  only search box and its header, rendered `sticky` in the flow, always
  shown, with the static header not rendered (nothing under it left in the
  tab order). The first cut kept the takeover and pinned it only while the
  buyer had refined, and the PR review caught the hole: backspacing to
  empty at `scrollY` 0 un-refined the page and slid the bar away under a
  still-focused input. Everywhere else: once the hero's chips
  scroll out above (one `IntersectionObserver` on a sentinel,
  `useScrolledPast`), a frosted bar takes over with the logo, a floating
  search, the region switch — and on desktop the chips and the seller CTA.
  It is a second VIEW of the hero's search/filter state, not a second
  control. On a phone an active filter rides inside the search pill as a
  removable token, so the bar stays one row. Shipped in the same PR because
  it is the same page; it is what makes a long showcase page navigable.
- **Every swipe rail hides its scrollbar** (`scrollbar-none` in
  `styles.css`, replacing three copy-pasted `[scrollbar-width:none]`
  hacks across eight rails): phones overlay theirs, but desktop browsers
  and devtools' phone emulation painted a permanent grey bar under every
  chip row. The peek says "there's more", never the bar.

### Admin · Showcases

A new admin tab (`/app/admin/showcases`, sidebar + bottom nav), named for
what it holds (it was briefly "Marketplace", which read as the whole
directory). Showcases are
listed in /stores order (drag to reorder, `SortableList`), each with a
thumbnail of its look, a status pill (Live · ends tomorrow / ends in N days — calendar days in MYT through
`showcaseDaysLeft`, the buyer chip's own count / Scheduled ·
starts 1 Nov / Draft · buyers can't see it / Ended), the facts an admin
scans for, and Edit / View on /stores / a menu (Copy link, Publish or
Unpublish, Delete…). Ended ones fold away but are kept. A note says Store
highlights are still set per store from Sellers → Manage.

**New showcase** asks two things — title and region — and lands in the
editor as a draft (the region can't change once stores are in, because
every member must share it). **The editor** (`ShowcaseEditor`): Details,
Look (eight swatches incl. No tint and Custom, the colour wheel under
Custom, cover upload that saves on upload), When buyers see it (show from /
until, "No end date", and a sentence naming when it goes on and when it
comes off), Stores (add via a picker sheet over the admin seller directory
narrowed to the region, with search and a tri-state select-all — the same
`BulkSelectRow` as the member list; drag to order; a booth label per row;
bulk remove), Take it down
(Unpublish keeps it as a draft; Delete is for good, behind a confirm). The
**buyer preview is the real `ShowcaseStage`** fed the draft (`forcePhone`),
so it never lies about a store's hours or cover, and the pinned save bar
names what is unsaved ("Unsaved: theme, 2 booth labels") with **Discard
changes** beside it. **Save says what it will do to buyers**
(`saveOutcome`, from the DRAFT's dates): "live on /stores now", "off
/stores until 17 Oct, 9:00 AM" when a new start moves a live showcase back,
"takes it off /stores now" for an end in the past — and the toast after it
says the same. Leaving with unsaved edits asks first (`useBlocker`, plus the
browser's own prompt on reload/close). When the saved row changes under an
open editor (a save, a cover upload, another admin), `rebaseDraft` merges
field by field — untouched fields take the new value, edited ones keep the
edit — so a cover upload can't eat an unsaved title. Publish is a separate
act from Save — `publish` is refused for an empty showcase by name.

### The seller is told

`marketplace.myListingReadiness` gained `featuredIn`: the published
showcases this store is in (drafts stay private). The Settings → Store →
Marketplace listing card shows a "You're featured in …" card per showcase
with the booth label Kedaipal gave them, the link to copy, and a WhatsApp
line to tell us the label is wrong — being featured without knowing is the
hidden behaviour the house rules forbid. The card never promises a ticket buyers
can't see: a showcase only shows members the directory lists, so when the
store isn't listed (`featuredBlocker` — the listable rule's order: internal,
hidden by Kedaipal, switched off, no visible product) it turns amber, reads
"In this showcase — not showing", and names the fix ("Turn on “List my
store” above to appear in it").

## Tests

`convex/lib/marketplaceListing.test.ts` (each listable clause bites),
`convex/marketplace.test.ts` (rule end-to-end through real mutations, payload
leak pin, sponsorship admin gate + audit), `src/lib/marketplace.test.ts`
(status label, filters, partition), `src/components/marketplace/store-card.test.tsx`
(card states over a real router), `src/components/settings/marketplace-card.test.tsx`
(the four status-line states incl. ON-but-not-shown + loading, area saves in
the stored shape, discoverability link), `src/components/admin/highlight-dialog.test.tsx`
(start / update-needs-a-change / end via its own mutation, inclusive end date, opted-out warning, comp switch, internal store), the directory pill in `app.admin.sellers.test.tsx`,
`src/components/storefront/storefront-footer.test.tsx` (the discover link,
and which pages may pass it: order page on, checkout and claim off),
`parseMarketplaceSearch` cases for the URL state, and `src/lib/json-ld.test.ts`
(escaping + the gate). Showcases (z8r3fdr6mv): `convex/lib/showcase.test.ts`
(state machine incl. the exclusive end, sanitizers, slug + param parsing),
`convex/showcases.test.ts` (admin gate, create → publish → buyers end to
end, the read-time window, unpublish/remove, members obeying the listable
rule with the reason named, region refusals, an internal store refused on
add but left alone once in, dedupe + cap, reorder, the custom look's colour
rules, every write in the audit log, the seller's `featuredIn`),
`src/lib/showcase.test.ts` (join, split, time facts, ranges, `showcaseDaysLeft`,
`showcaseLook`, the theme-class literal guard), `src/lib/showcase-color.test.ts`
(OKLCH anchors; every pick lands at the pinned shade), `src/lib/admin-showcase.test.ts`
(status labels, the unsaved-changes summary, `saveOutcome`, `rebaseDraft`,
MYT datetime round trip), `src/components/marketplace/showcase-ticket.test.tsx`
(ticket link + stub + cover/fallback + inert, the die-cut, the booth said
once, the rail dots following the swipe, stage "See all", the pile, the
focused view) and the Showcases tab in `bottom-nav.test.tsx`. Admin hide: the clause in `marketplaceListing.test.ts`,
end to end in `marketplace.test.ts` (admin-only, the seller's switch can't
relist past it, the note reaches the seller card but never the public
payload, idempotent audit, internal refused), the pill + Manage item in
`app.admin.sellers.test.tsx`, the dialog warning in `highlight-dialog.test.tsx`,
and the seller's hidden line in `marketplace-card.test.tsx`.
