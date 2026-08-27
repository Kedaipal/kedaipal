# Storefront source attribution (`?src=` / `utm_source`)

ClickUp `86eyq0eq9` ([TikTok Live] Storefront source attribution). The seller's
"orders from TikTok" stat: any storefront visit arriving with `?src=`
(fallback `utm_source`) carries that tag through the session and onto the
order it produces, and Insights shows a per-source order/revenue breakdown.
This is the **seller's** funnel measurement — distinct from `86eye3eyp`
(Kedaipal's own CAC ledger) and from the `storefront_badge` tag on the
powered-by link, which targets the kedaipal.com marketing site and never
reaches a storefront.

## The one author: `convex/lib/attribution.ts`

Pure module (no Convex imports), shared by client **and** server — the
`productCap.ts` posture — so capture, stamping, presets and report labels can
never disagree:

- `sanitizeAttributionSource(raw)` — lowercase, spaces→`-`, strip outside
  `[a-z0-9_-]`, collapse/trim separators, cap 32 chars. **Absent/blank →
  `undefined`** (= direct; an empty `?src=` is an authoring accident).
  **Present-but-garbage → `"other"`** (the tag existed, so the visit was NOT
  direct — reclassifying it as direct would hide tampering). Never throws — a
  bad tag must never block checkout (ticket AC).
- `attributionBucket(order)` — the report bucket: stamped tag → `counter`
  (when `orders.source === "counter"`) → `direct`.
- `KNOWN_SOURCE_LABELS` / `sourceLabel` — pretty labels for tags Kedaipal
  emits or promotes (TikTok, Instagram, Poster QR = `online`, Parcel label QR
  = `awb`, Counter, Direct / shared link, Other, and the reserved
  `tiktok-live` for claim-link orders `86eyq0epn`). **Free-form tags render
  verbatim** — a seller can invent `?src=raya-promo` and see it in the report
  without us shipping anything.
- `SHARE_TAG_PRESETS` — the channel presets the tagged-link builder renders
  (TikTok / Instagram / Facebook / WhatsApp).

## Capture (client, session-scoped)

`src/hooks/useSourceAttribution.ts`:

- `useCaptureAttribution(slug)` runs on mount of **all four buyer routes**
  (store home, category, product page, checkout — a tagged link can land on
  any of them). If the hit carries `?src=`/`utm_source`, the sanitized tag is
  written to `sessionStorage` under `kedaipal:src:<slug>` — **keyed per store**
  so two shops in one tab can't cross-attribute.
- **Last-touch within the session**: a later hit WITH a tag overwrites; a hit
  without one keeps the stored tag (in-store navigation never carries the
  param). A new tab/session starts clean — the ticket's "returns tomorrow
  direct" edge is direct, v1 keeps it simple.
- Everything is try/caught best-effort: storage being unavailable (some
  private modes) never breaks browsing or checkout. No cookies, no PII, and
  the `/track/*` analytics carve-out is untouched (this feature never touches
  GA/Clarity at all).
- `readAttributionSource(slug)` feeds the tag into `orders.create` from
  `checkout-form.tsx` (`attributionSource` arg).

## Stamping (server, authoritative)

- `orders.create` re-sanitizes (`sanitizeAttributionSource`) and stores
  **`orders.attributionSource`** (optional string, dev-only widen, nothing to
  backfill — absence = direct). Stamped **once at create**; nothing ever
  rewrites it.
- **Counter-checkout orders are never stamped** — `createOrderFromSession`
  is untouched. Their report bucket derives from the existing
  `orders.source === "counter"` at read time, so the Counter row costs no
  write and no backfill. (The poster's counter-QR *storefront fallback* link
  stamps `counter` explicitly; both land in the same bucket by design —
  "the buyer was at your counter".)
- **No index** — same posture as `orders.source`: per-row read only, consumed
  inside the insights range scan which is already bounded + indexed.

## Report (Insights, Pro)

- `reduceInsights` (`convex/lib/insights.ts`) gained `sources: SourceStat[]`
  (`{source, revenue, orderCount}`), bucketed by `attributionBucket` over
  **revenue orders**, revenue = **earned** — so Σ rows === the earned KPI
  ("which funnel produced the order", deliberately not collected).
  `mergeSourceStats` merges range + today client-side like the other stats.
- Rides the existing Pro gate for free: both analytics queries return
  `{gated: true}` for Starter; capture + stamping stay **all-tier** (ticket:
  capture on all tiers, report = Pro), so a Starter store's history is
  complete on upgrade day.
- UI: `src/components/insights/source-breakdown.tsx` — "Where orders come
  from", a bar list in the TopProducts idiom (no chart library), top 8
  sources. **Discoverability lives in the widget itself**: the header names
  the `?src=` mechanic and links the poster; when every order is untagged, a
  footer nudge explains pasting a tagged link in a TikTok bio/live chat.

## Where a seller gets a tagged link

**One surface: the dashboard Home store-link card** —
`src/components/dashboard/tagged-share-links.tsx`, a "Tagged links" row sitting
directly under **Copy link / Open live**. A tap copies
`<storefrontUrl>?src=<tag>` and stamps the same `linkSharedAt` "shared their
link" signal the plain copy button does (a denied clipboard shows the URL in
the toast rather than failing silently, so the seller can still copy by hand).
All-tier, matching capture — a Starter seller must be able to build a tagged
link even though the report is Pro.

The four presets render as an even **4-up grid of icon tiles**, each carrying
its channel's own mark from `dashboard/brand-icons.tsx`:

- **A grid, not a scroller.** Exactly four presets fit a 390px row, so a
  horizontal rail would hide the last one behind the edge and make the seller
  find it by swiping. Tiles are ≥64px tall, well over the 44px floor.
- **The glyph leads, the word confirms.** A seller scans for the TikTok mark,
  not the string "TikTok".
- **The pressed tile becomes a tick.** Confirmation lands under the thumb that
  pressed it, instead of only in a toast that can be missed or dismissed.
- **Marks are decorative** (`aria-hidden`, `data-brand` for tests) — each
  button already carries a real accessible name ("Copy TikTok link"), so a
  `role="img"` glyph would make a screen reader announce the brand twice.
- **Brand hex is hardcoded, not tokenised** — these are external identities
  and must not drift with our theme. TikTok is the exception: its mono mark is
  black-on-light / white-on-dark by design, so it rides `text-foreground`.
  Paths are the CC0 Simple Icons marks, inlined rather than adding a
  dependency (this repo exact-pins deps; four glyphs don't justify one).

**Deliberately NOT on any QR surface** (owner call, Arif):

- The **poster** (`/app/poster`) keeps its two fixed tags, `?src=counter` and
  `?src=online`. A printed sheet is a physical artifact that outlives any
  campaign, so it describes *itself* ("Poster QR") and must not carry a
  campaign tag — a poster printed for one live would misattribute every scan
  it collects for the rest of its life on the wall.
- The **StorefrontQrDialog** is untouched; its QR codes still encode the bare
  storefront URL.

Both files are byte-identical to their pre-feature state. The consequence is
that a QR scan is always attributable to the *surface* (poster / parcel label /
counter), never to a campaign — campaigns are links you paste, and that is the
one place the builder lives.

## Filtering and drilling down

- **Order inbox filter** — the filter sheet gains a **"Came from"** section
  (multi-select chips, OR within itself, ANDed with everything else). It is a
  separate dimension from the existing **"Order type"** filter: that one is the
  checkout SURFACE (online vs counter), this one is where the buyer came from.
  Both live in `OrderFilterValue`; the URL carries repeated `?asrc=` params, so
  a filtered inbox is shareable and survives a refresh.
- **The picker is data-driven.** Free-form tags mean the UI cannot hardcode a
  list, so `searchOrders` returns `availableSources` — the origins actually
  present in the scanned window, tallied over the **full** scan (never the
  filtered set, or picking one origin would make the others vanish and strand
  the seller). Most-used first, ties broken **alphabetically** so the list
  doesn't reshuffle as orders arrive. The section hides itself below two
  origins — one origin is every order, nothing to narrow.
- **CSV export honours it too** — `attributionSources` is in
  `exportFilterValidators`, so an export of a filtered view contains exactly
  the rows the seller was looking at. That parity is the whole reason
  `orderInboxFilter.ts` exists.
- **Insights drills down.** Every row of "Where orders come from" is a link to
  `/app/orders?asrc=<bucket>`: "TikTok made RM400" immediately raises "which
  orders?", so the widget answers it in one tap. Both ends bucket through the
  same `attributionBucket`, so the report and the inbox it opens can never
  disagree about which orders count.

## Emitters today (all captured for free)

| Tag | Emitter |
| --- | --- |
| `counter` / `online` | poster QR fallbacks (`posterQrUrls`) |
| `awb` | despatch-label QR (`convex/awb.ts` `storeUrlFor`) |
| any preset / free-form | Home's tagged share links, or a seller's own hand-written tag |

(`storefront_badge` is NOT in this system — it tags kedaipal.com itself.)

## Edge cases

- Garbage/spoofed tag → `"other"` row, never a checkout error.
- Claim-link orders (`86eyq0epn`, unbuilt) will stamp `tiktok-live` — the
  sanitizer round-trips it and the label already exists.
- Legacy orders (no `source`, no `attributionSource`) bucket as `direct`.
- A hostile 100k-char `?src=` is capped at 32 chars before storage.

## Tests

- `convex/lib/attribution.test.ts` — sanitizer table (incl. hostile input +
  every Kedaipal-emitted tag round-tripping), bucket derivation, preset↔label
  consistency.
- `convex/lib/insights.test.ts` — by-source reduce (Σ rows === earned,
  counter derivation, stamped-tag-wins) + `mergeSourceStats`.
- `convex/orders.test.ts` — create stamps sanitized tag / leaves absent unset
  / buckets garbage to `other` without failing the order.
- `src/hooks/useSourceAttribution.test.tsx` — capture precedence, last-touch
  overwrite, per-store keying, empty-vs-garbage, no-slug no-throw.
- `src/components/dashboard/tagged-share-links.test.tsx` — a tile per preset,
  each with its own decorative brand mark, the copied URL carries that preset's
  tag, the copy counts as sharing and confirms in the pressed tile, and a
  denied clipboard surfaces the link instead of failing silently.
- `convex/lib/orderInboxFilter.test.ts` — the "Came from" predicate: empty =
  no filtering, multi-select ORs, `direct` reaches untagged + legacy rows,
  `counter` reaches unstamped counter orders, and it ANDs with the other
  filters rather than replacing them.
- `convex/orders.test.ts` — `availableSources` is tallied over the full window
  (filtering by one origin must NOT shrink the picker), multi-select ORs, and
  an origin nothing matches returns an empty list rather than everything.

## Not in v1

- Cross-session attribution (cookie/localStorage last-touch) — sessionStorage
  only, per the ticket.
- An index on `attributionSource` — revisit only if a by-source query ever
  needs to run outside the insights scan.
- PostHog funnel events — PostHog isn't integrated in the repo at all yet.
