# Store QR Poster (printable A4, EN/BM)

ClickUp: `86ey5m4m9` (poster v1) · `86ey65cx8` (v2 redesign, paired with Kris's
design task `86ey65cm6`) · pairs with `86ey5m35w` (static QR backend) ·
Route: `/app/poster` · v1 shipped Jul 2026, v2 re-skin Jul 2026, v3 single-QR
templates Jul 2026

## What / why

A self-serve, print-ready A4 poster a seller downloads from the dashboard. The
**v2 sheet** (Kris's approved redesign) is mint-led: a mint header with the
store name, a "Just Scan & Order" tagline, the navy storefront-URL pill and the
seller's logo on a white circle; a body with the two QR boxes stacked left and
their step lists on the right; and a decorative bottom band (white→mint
gradient, line-art doodles, and a WhatsApp phone mockup showing the seller's
own store) that bleeds off the page. It replaces the hand-built Mr Ganu counter
poster — every ICP seller with a physical point (counter, stall, pickup) gets a
day-one activation asset that converts walk-up buyers into orders (and into the
Customer DB).

**Two QRs, two flows:**
- **Top — "At the counter" (walk-in):** encodes the permanent
  `wa.me?text=…KPS-<token>` deep link from the static-QR feature (`86ey5m35w`).
  A buyer scans → WhatsApp opens → they're connected → **the cashier rings up
  the order** (it appears as a "Walk-in scan" on the counter-checkout desk).
- **Bottom — "Order online":** the storefront `?src=online` link — browse the
  full catalog and order from home.

**Relationship to the Counter-Checkout Store QR card (`86ey5m35w` / `86ey5neg6`).**
The `/app/checkout` `StoreQrCard` owns the counter QR's **token lifecycle**
(Generate / Rotate) + a quick on-screen QR; its **print button links here** — this
`/app/poster` A4 is the single poster renderer. Both surfaces share the **same**
`retailers.counterQrToken`, so rotating it in either place updates both.

- **Entry points:** a "Promote your store" card on the `/app` home (sits with
  the share actions in both new-user and returning-user layouts) and a
  cross-link inside the storefront QR dialog. No sidebar/bottom-nav item —
  deliberate, to keep nav lean.
- **Copy is buyer-facing**, so the seller picks its language on the page
  (BM | EN toggle, **default BM**), independent of any dashboard locale. Page
  chrome stays hardcoded English like every other `/app` route.
- **Download = browser print-to-PDF** (`window.print()`), no server-side PDF
  dependency. Works from mobile (iOS Share → Print).

## Header background toggle (v2)

The page has a second segmented control, **"Header background": Kedaipal green
| Cover photo**. The cover option swaps the mint header for the seller's
storefront **cover image** (`retailers.coverImageStorageId`, resolved to
`coverImageUrl` on the retailer payload) under a dark scrim with white text —
the same treatment the storefront header uses. Session-only state, brand green
is always the default.

- **No cover uploaded** → the option is disabled with an always-visible inline
  link ("Upload a cover photo in Settings to use it here" →
  Settings → Store → Cover image). Deliberately not a hover tooltip — mobile
  has no hover, and the visible nudge doubles as cover-upload enticement.
- **Print gating:** flipping to the cover variant preloads the photo and
  disables the print button ("Loading your cover photo…") until it's loaded,
  so a fast Print can't produce a poster with an empty header.
- The photo renders as an `<img>` + rgba overlay div, **not** CSS backgrounds,
  so it prints regardless of the "Background graphics" checkbox.

## Poster templates (v3)

A third segmented control — **"Poster type": Both QRs | Counter only | Online
only** — sits **first** in the control card (it's the structural choice; the
language and header-background toggles style whichever template is picked).
Session-only state, **default "Both QRs"**. v3 also touches the two-QR sheet
itself (owner call, deliberately departing from the strict v2 spec): both
56mm QRs get the **Kedaipal centre mark** (12.5mm panel) and the gap between
the counter and online sections widens 3mm → **6mm** (rows end ~200mm, ~4mm
clear of the 204mm footer — ~9mm is the gap's ceiling).

The two single-QR templates are for sellers who need one context per surface —
a stall counter that only rings up walk-ins, or an online flyer/story image —
and emphasize the QR the way DuitNow/TNG payment posters do:

- **Anatomy:** shared header (mint/cover, store lockup + URL pill) → hero
  badge (reuses `poster_counter_badge` / `poster_online_badge`, upsized to
  16pt) → one **giant 80mm QR** in a mint-bordered white card → the same
  numbered steps as the two-QR template (13pt, centered as a block) → the
  shared band + POWERED BY footer + phone mockup. No new copy keys — badge
  and steps are the existing `poster_counter_*` / `poster_online_*` strings.
- **Kedaipal mark in the QR centre** (`QrCenterMark`: `public/logo.svg` on a
  white rounded panel — 18mm panel/11.5mm mark on the 80mm hero QR, 12.5mm
  panel/8mm mark on the 56mm two-QR boxes; both ≈ 22% of the QR's side →
  **~5% of its area**). Safe by construction: level-H tolerates ~30% covered
  codewords; decode verified empirically against the real `wa.me` KPS payload
  at both sizes. The panel is centered with auto margins (no transforms —
  print-safe) and is an element `<img>`/div, so it prints without
  "Background graphics".
- **80mm is the QR's ceiling with the step list present:** the body region
  runs 63mm (header) → 204mm (footer pill); badge + gaps + card chrome +
  three step lines total ~138mm, ending ~3mm clear of the pinned
  footer/phone anchors. Enlarging the QR collides with the footer.
- The **helper text under the Print button adapts per template**
  (`TEMPLATE_HELP` in the route) so each poster names what its QR(s) do —
  no hidden behavior.
- Counter-only has no disabled state: while the walk-in token resolves (or if
  `WHATSAPP_CHECKOUT_PHONE` is unset) the giant QR uses the same storefront
  `?src=counter` fallback as the two-QR template, so it always prints.

## Files

| File | Role |
|---|---|
| `src/routes/app.poster.tsx` | Page: template + language + header-background toggles, print button (cover-load gated) with per-template helper text, rotate card, scaled preview, route-scoped print CSS, resolves the walk-in `waUrl` + ensures the token |
| `src/components/poster/store-poster.tsx` | Pure presentational A4 sheet (`counterUrl`/`onlineUrl`/`headerImageUrl`/`variant` props, `SingleQrHero` for the single-QR templates) + `posterQrUrls()` storefront fallback helper |
| `public/poster/*` | v2 static assets exported from Kris's Figma: `doodles-left/right.svg` (band line art), `phone-shell.png` (empty phone frame, live content overlaid), `kedaipal-lockup.svg` (footer wordmark) |
| `public/logo.svg` | The standalone Kedaipal mark, reused as the giant QR's centre overlay |
| `convex/counterCheckout.ts` | `getStoreQr` / `ensureCounterQrToken` (from `86ey5m35w`) — the counter QR's `KPS-` deep link |
| `src/lib/storefront-url.ts` | Canonical storefront origin/URL construction (also used by `/app` home) |
| `messages/en.json` / `messages/ms.json` | `poster_*` copy keys incl. the phone-mockup chat bubbles (guarded by `src/lib/i18n.test.ts` parity tests) |

## Print architecture (first print surface in the repo)

1. **Global `print:hidden` on shell chrome** — sidebar, mobile header, bottom
   nav, and dashboard banners never print, on any page. `app.tsx`'s `<main>`
   drops its padding/max-width in print (`print:p-0 print:max-w-none`).
2. **Route-scoped `@page` rule** — `@page { size: A4; margin: 0 }` lives in a
   `<style>` element rendered by `app.poster.tsx`. `@page` cannot be scoped by
   selector, so mounting it only while the poster route is mounted is the only
   way to keep `margin: 0` from leaking into printing other dashboard pages.
3. **Screen preview** — the sheet renders at its natural size (210mm ≈ 794px)
   and is `transform: scale()`-ed to the container width (~49% on a phone);
   the print rule resets the transform.
4. The sheet carries `print-color-adjust: exact` so the mint header and band
   print without the "Background graphics" checkbox. The v2 decorations are
   additionally checkbox-proof by construction: the band gradient is an
   **inline SVG rect** (element content, not a CSS background), the doodles and
   phone are `<img>`s, and the cover-photo header is an `<img>` + overlay div.
5. The sheet is a fixed `h-[296mm]` with `overflow-hidden` — the phone mockup
   bleeds off the bottom edge by design and the clip prevents a blank page 2
   on Chrome.

## Poster copy & locale override

Poster strings live in the Paraglide catalogs but are always called with an
explicit locale — `m.poster_headline({}, { locale })` — so the seller's toggle,
not the `PARAGLIDE_LOCALE` cookie, decides the language. BM copy is locked from
the Mr Ganu reference poster (v2 kept the same strings, casing per Kris's
spec); EN is a translation of it. v2 adds `poster_chat_*` — the phone mockup's
"online" status and two buyer-side sample bubbles. v3 adds **no new keys** —
the single-QR templates reuse the existing badge + step strings. **Keep step
copy ≤ ~60 chars**: the single-QR layout budgets one 13pt line per step, and
a wrap pushes the stack toward the pinned footer (~3mm clearance).

## QR codes

- `react-qr-code` SVG, `level="H"`, rendered into a fixed **56mm** box with a
  ≥3mm white quiet zone (the lib renders none itself). 56mm — not the 45mm
  acceptance floor — because iOS Safari ignores `@page` and scale-to-fits
  (~10% shrink): 56 × 0.9 ≈ 50mm, still ≥45mm. **Deliberate deviation from the
  v2 mockup**, which drew the QR boxes at ~47mm (≈36mm after the iOS shrink);
  the ticket AC overrides the mockup here.
- The single-QR templates render one **80mm** module area (72mm after the
  iOS shrink) with 5mm white padding ≈ 3 modules of quiet zone — parity
  with the 56mm boxes' 3mm. Same `level="H"`; the centre mark overlay math is
  in "Poster templates (v3)" above.
- **Counter QR (top)** = `getStoreQr().waUrl`, the permanent walk-in
  `wa.me?text=…KPS-<retailers.counterQrToken>…` deep link (`86ey5m35w`). The
  route **auto-provisions** the token on first visit — a one-shot
  `ensureCounterQrToken` (idempotent, owner-or-admin, so act-as mints it for the
  seller's store) — so the poster is self-serve with no "generate first" step.
  While the token resolves, and on deployments where `WHATSAPP_CHECKOUT_PHONE`
  is unset (so `waUrl` is `undefined`), the counter QR **falls back** to the
  storefront `?src=counter` link, so the poster always prints.
- **Online QR (bottom)** = storefront `?src=online` from `posterQrUrls()`.
  **`?src=` is reserved attribution** — the storefront ignores it today; PostHog
  wiring comes with S3.
- `StorePoster` is fully presentational: the route resolves both URLs and passes
  `counterUrl` / `onlineUrl` in. `posterQrUrls(origin, slug)` only builds the
  storefront pair used for the online QR + the counter fallback.
- **Rotation:** rotating the token (here or on the Counter Checkout Store QR
  card, `86ey5m35w`) kills old printed posters — both surfaces encode the same
  token. Re-print after a rotate.

## Design tokens (v2, from Kris's Figma `86ey65cm6`)

Fixed print values, deliberately not semantic theme tokens: navy `#0F172A`,
mint `#10B981` (header), badge green `#00BC7C` (the spec's second green, kept
exactly; step numbering stays navy per review), logo ring `#109B6D` (thin, a
hair darker than the header), chat bubble `#D1F498`, doodle stroke `#C7F0E2`,
band gradient white → `#D9F4EA`. Type: Red Hat Display (headings) / Geist
(body); store name 35pt (24pt past 24 chars), tagline 21pt, badges 15pt,
steps 13pt.

## Activation stamping

Pressing Print fires `api.retailers.markLinkShared` (fire-and-forget, one-time
set server-side) — printing a poster is a "shared their link" signal for the
activation checklist. Skipped in admin act-as: the mutation resolves by caller
identity and would stamp the admin's own store.

## Edge cases

- **No logo** → no header circle; the store-name text lockup carries the
  header, and the phone mockup's chat avatar falls back to the store initial.
  Download never blocked.
- **Dark/navy logos** → the logo always sits on a white circle panel (no
  luminance detection — deterministic beats clever at print time).
- **Long names/slugs** → store name and URL pill step down a font size past
  24 chars and wrap (`text-balance` / `break-all`); covered by 40+ char test
  fixtures.
- **Cover photo still loading** → print button disabled with a spinner until
  the image loads (or errors — a bad blob never wedges the button).

## Manual print checks (per release when touched)

- Chrome desktop: single full-bleed A4 page, colors without "Background
  graphics", no blank page 2 (the band + phone bleed is clipped by the sheet).
  Repeat for **each of the three templates**.
- iOS Safari: Share → Print → pinch preview; QR visually ≥45mm, nothing
  clipped (the sheet's 17mm internal padding absorbs printer margins).
- Single-QR templates: **scan the printed giant QR with a real phone**
  (Android camera + iPhone) — the centre-mark tolerance is theoretical until
  scanned. Counter → WhatsApp opens with the `KPS-` text; online →
  storefront. Confirm the hint line sits clear of the POWERED BY pill.
- Cover-photo variant: header prints the photo + scrim, not a white box.
- Print any *other* dashboard page: chrome hidden, normal margins (proves the
  `@page` rule didn't leak).
