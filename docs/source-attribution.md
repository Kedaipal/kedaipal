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
- `SHARE_TAG_PRESETS` — the channel presets both preset surfaces render
  (TikTok / Instagram / Facebook / WhatsApp), one list so they can't drift.

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

## Preset surfaces (where a seller gets a tagged link)

- **`/app/poster`** — a "Track orders from" segmented row (rendered whenever
  the sheet carries an online QR; hidden on the counter-only template):
  `Poster` (= the default `?src=online`) or a `SHARE_TAG_PRESETS` channel.
  Retags **only the online QR** (`posterQrUrls(origin, slug, onlineTag?)`) —
  the counter QR/fallback keeps its own meaning. Helper line under the row
  names the consequence and links Insights.
- **StorefrontQrDialog** (dashboard Home) — a "Tagged share links" card: one
  tap copies `<storefrontUrl>?src=<tag>` per preset, for pasting into a
  TikTok bio / live chat / IG profile.

## Emitters today (all captured for free)

| Tag | Emitter |
| --- | --- |
| `counter` / `online` | poster QR fallbacks (`posterQrUrls`) |
| `awb` | despatch-label QR (`convex/awb.ts` `storeUrlFor`) |
| any preset / free-form | poster "Track orders from", QR-dialog share links, seller's own links |

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
- `src/components/poster/store-poster.test.tsx` — the preset retags only the
  online QR.

## Not in v1

- Cross-session attribution (cookie/localStorage last-touch) — sessionStorage
  only, per the ticket.
- An index on `attributionSource` — revisit only if a by-source query ever
  needs to run outside the insights scan.
- PostHog funnel events — PostHog isn't integrated in the repo at all yet.
