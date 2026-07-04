# Store QR Poster (printable A4, EN/BM)

ClickUp: `86ey5m4m9` · Route: `/app/poster` · Shipped: Jul 2026

## What / why

A self-serve, print-ready A4 poster a seller downloads from the dashboard: their
logo + store name on a navy header, two QR codes pointing at their storefront
("At the counter" / "Order online"), a store URL pill, and a powered-by-Kedaipal
footer. It replaces the hand-built Mr Ganu counter poster — every ICP seller
with a physical point (counter, stall, pickup) gets a day-one activation asset
that converts walk-up buyers into storefront orders (and into the Customer DB).

- **Entry points:** a "Promote your store" card on the `/app` home (sits with
  the share actions in both new-user and returning-user layouts) and a
  cross-link inside the storefront QR dialog. No sidebar/bottom-nav item —
  deliberate, to keep nav lean.
- **Copy is buyer-facing**, so the seller picks its language on the page
  (BM | EN toggle, **default BM**), independent of any dashboard locale. Page
  chrome stays hardcoded English like every other `/app` route.
- **Download = browser print-to-PDF** (`window.print()`), no server-side PDF
  dependency. Works from mobile (iOS Share → Print).

## Files

| File | Role |
|---|---|
| `src/routes/app.poster.tsx` | Page: locale toggle, print button, scaled preview, route-scoped print CSS |
| `src/components/poster/store-poster.tsx` | Pure presentational A4 sheet + `posterQrUrls()` |
| `src/lib/storefront-url.ts` | Canonical storefront origin/URL construction (also used by `/app` home) |
| `messages/en.json` / `messages/ms.json` | `poster_*` copy keys (guarded by `src/lib/i18n.test.ts` parity tests) |

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
4. The sheet carries `print-color-adjust: exact` so the navy header and mint
   bars print without the "Background graphics" checkbox.

## Poster copy & locale override

Poster strings live in the Paraglide catalogs but are always called with an
explicit locale — `m.poster_headline({}, { locale })` — so the seller's toggle,
not the `PARAGLIDE_LOCALE` cookie, decides the language. BM copy is locked from
the Mr Ganu reference poster; EN is a translation of it.

## QR codes

- `react-qr-code` SVG, `level="H"`, rendered into a fixed **56mm** box with a
  ≥4mm white quiet zone (the lib renders none itself). 56mm — not the 45mm
  acceptance floor — because iOS Safari ignores `@page` and scale-to-fits
  (~10% shrink): 56 × 0.9 ≈ 50mm, still ≥45mm.
- Targets from `posterQrUrls(origin, slug)`:
  `…/<slug>?src=counter` and `…/<slug>?src=online`. **`?src=` is reserved
  attribution** — the storefront ignores it today; PostHog wiring comes with S3.
- **Counter QR is interim-static:** real counter checkout still runs on
  per-session single-use `KP-<token>` QRs, so the poster's counter QR points at
  the plain storefront for now. When static counter-checkout tokenisation
  ships (Zaki), swap the `counter` target inside `posterQrUrls` — single seam.

## Activation stamping

Pressing Print fires `api.retailers.markLinkShared` (fire-and-forget, one-time
set server-side) — printing a poster is a "shared their link" signal for the
activation checklist. Skipped in admin act-as: the mutation resolves by caller
identity and would stamp the admin's own store.

## Edge cases

- **No logo** → the store name renders as a large text lockup; download never
  blocked.
- **Dark/navy logos** → the logo always sits on a white rounded panel (no
  luminance detection — deterministic beats clever at print time).
- **Long names/slugs** → store name and URL pill step down a font size past
  24 chars and wrap (`text-balance` / `break-all`); covered by 40+ char test
  fixtures.

## Manual print checks (per release when touched)

- Chrome desktop: single full-bleed A4 page, colors without "Background
  graphics", no blank page 2.
- iOS Safari: Share → Print → pinch preview; QR visually ≥45mm, nothing
  clipped (the sheet's 12mm internal padding absorbs printer margins).
- Print any *other* dashboard page: chrome hidden, normal margins (proves the
  `@page` rule didn't leak).
