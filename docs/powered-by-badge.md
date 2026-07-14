# "Powered by Kedaipal" badge (buyer-facing growth loop)

ClickUp `86ey8zh3r`. Every storefront visit and every WhatsApp order confirmation
becomes a Kedaipal impression with a click path back to the marketing site. This
is the **buyer-facing** loop — distinct from the retailer-facing Founding Member
badge, and the digital twin of the physical **Store QR Poster** (`86ey5m4m9`).

**Locked decision (Arif, 13 Jul 2026): always-on, no retailer toggle.** Universal
or the loop doesn't compound. There is deliberately no setting for it.

## Two surfaces

### 1. Storefront footer

[`src/components/storefront/storefront-footer.tsx`](../src/components/storefront/storefront-footer.tsx) —
a quiet, centered footer (small navy logomark `logo.svg` + "Powered by
**Kedaipal**") rendered on **every** `kedaipal.com/<slug>` page. Mounted on both
storefront routes:

- [`src/routes/$slug.tsx`](../src/routes/$slug.tsx) — the store home
- [`src/routes/$slug_.c.$categorySlug.tsx`](../src/routes/$slug_.c.$categorySlug.tsx) — a category page

Placed after the product `<section>` and before the fixed `<CartBar>`, with
`mt-auto` so it sinks to the bottom of the `min-h-dvh` column (bottom of the
page on short catalogs, after the content on long ones). Muted text + small mark
so it never competes with the retailer's brand.

- Links to `https://kedaipal.com?src=storefront_badge`. The `?src=` tag is the
  repo's reserved PostHog attribution convention (same as the poster QR links in
  `store-poster.tsx`), so the click path is measurable.
- Opens in a new tab (`target="_blank" rel="noopener noreferrer"`) so the buyer
  never loses the store they were browsing.
- The logomark is `aria-hidden`/`alt=""`; the visible "Powered by Kedaipal" text
  carries the meaning for screen readers.

### 2. WhatsApp order-confirmation line

[`poweredByLine(locale)`](../convex/lib/whatsappCopy.ts) — a pure, locale-aware
suffix appended to the buyer's order-confirmation message:

- EN: `This shop runs on Kedaipal 🛒 kedaipal.com`
- BM: `Kedai ini guna Kedaipal 🛒 kedaipal.com`

Appended at the **send site** in [`convex/whatsapp.ts`](../convex/whatsapp.ts),
**not** inside the override-able `confirm` template — a retailer editing their
template can't strip it out (that's what keeps it universal). It lands as the
**last** block of the message, under the payment details, so it stays out of the
way of the actionable content:

- **Normal storefront confirm** — passed as `sendPaymentMessage({ footerLine })`
  so it sits after the payment block / QR intro.
- **Custom-order ("mockup pending") confirm** — appended to the gated confirm
  body directly (that path doesn't send a payment ask yet).

**Scope — storefront online orders only.** Counter-checkout confirmations
(`counterOrderConfirmed*`) deliberately do **not** carry the line: those buyers
are physically at the store, where the printed Store QR Poster is the growth
surface. Keeping counter out avoids a redundant impression and matches the
ticket's "storefront visit + WA confirmation" framing.

## Tests

- [`convex/lib/whatsappCopy.test.ts`](../convex/lib/whatsappCopy.test.ts) —
  `poweredByLine` exact EN/BM copy, blank-line lead, and that it's independent of
  a retailer's `confirm` override.
- [`src/components/storefront/storefront-footer.test.tsx`](../src/components/storefront/storefront-footer.test.tsx) —
  wordmark text, attributed marketing link in a new tab, decorative logomark.
