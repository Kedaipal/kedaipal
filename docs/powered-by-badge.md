# "Powered by Kedaipal" badge (buyer-facing growth loop)

ClickUp `86ey8zh3r` (storefront footer + WhatsApp line), widened to **every**
buyer-facing surface in `z8r3fdcwd0`. Every buyer-facing page, document and
message becomes a Kedaipal impression with a click path back to the marketing
site — and, since z8r3fdcwd0, one that says WHICH surface and WHOSE badge the
click came from. This is the **buyer-facing** loop — distinct from the
retailer-facing Founding Member badge, and the digital twin of the physical
**Store QR Poster** (`86ey5m4m9`). Every buyer of a Kedaipal seller is a peer
WhatsApp seller (the ICP); Take.app and Orderla both gate badge *removal*
behind paid plans, which is the proof the loop drives signups.

**Locked decision (Arif, 13 Jul 2026): always-on, no retailer toggle.** Universal
or the loop doesn't compound. There is deliberately no setting for it. Paid
badge removal is a pricing decision and deliberately unbuilt (z8r3fdcwd0 scope).

## The link — one builder

[`convex/lib/poweredBy.ts`](../convex/lib/poweredBy.ts) (pure; shared by the
web footer, the PDF renderer and the server) is the only place the badge URL
is spelled: `poweredByHref(surface, slug)` →
`https://kedaipal.com/?src=<tag>&store=<slug>`.

| Surface | `?src=` tag | Where it renders |
| --- | --- | --- |
| `storefront` | `powered-by` | store home, category, product, checkout — and their not-found states |
| `track` | `powered-by-track` | `/track/<token>` — order page, skeleton, not-found |
| `claim` | `powered-by-claim` | `/claim/<token>` — every state |
| `receipt` | `powered-by-receipt` | the order receipt / invoice PDF (a link annotation) |

- **Per-surface tags, not one tag.** "Does the receipt badge convert at all" is
  the question that decides whether a surface is worth polishing, and GA4 only
  segments on `src`. The storefront keeps the bare `powered-by` so its history
  stays continuous. `POWERED_BY_TAGS` enumerates them; a test pins that every
  tag survives the marketing-side sanitizer unchanged.
- **`&store=<slug>` = whose badge.** `sanitizeReferrerSlug` is stricter than the
  tag sanitizer: a value not shaped like one of our slugs is dropped, never
  bucketed — there is no "other" store. Omitted where no store is in scope
  (skeletons, an unknown slug or token).
- The link targets the kedaipal.com **marketing site**, never a storefront, so
  the seller-facing storefront attribution (`86eyq0eq9`,
  [`source-attribution.md`](./source-attribution.md)) never sees it. It tags
  **Kedaipal's own** acquisition — see "Where the click lands" below.

## Surfaces

### 1. Web pages — `StorefrontFooter`

[`src/components/storefront/storefront-footer.tsx`](../src/components/storefront/storefront-footer.tsx)
`({ slug, surface })` — a quiet, centered footer. **The lockup mirrors the
Store QR Poster** (`store-poster.tsx`): a mint **"POWERED BY"** pill (border
`#B9D9CC`, text `#7BA394`, uppercase, wide tracking) stacked above the Kedaipal
wordmark (`/poster/kedaipal-lockup.svg`), so the printed poster and every buyer
web page carry one uniform brand mark, quiet enough never to compete with the
seller's own brand. Mounted as a **direct child** of each route's
`min-h-dvh flex-col` container so `mt-auto` sinks it to the bottom (wrapping it
in a breakpoint div silently breaks that — it has regressed once already).

Mounted on:

- **Storefront:** `$slug.tsx`, `$slug_.c.$categorySlug.tsx`,
  `$slug_.p.$productSlug.tsx`, `$slug_.checkout.tsx` (both states), plus all
  four not-found components (an unknown slug renders it store-less).
- **Order page:** `track.$token.tsx` — the resolved page, the skeleton (so the
  badge never pops in under the content) and `OrderNotFound`. **The page's
  eyebrow is now the store's name, not "Kedaipal":** it's the seller's order
  page as far as the buyer is concerned (as on the storefront, where the store
  brand leads), and the platform is named once, in the footer. This is the
  badge's highest-volume home — every order's confirmation links here.
- **Claim page:** `claim.$token.tsx` — the open checkout, the expired /
  withdrawn dead-ends, completed, skeleton, not-found.

Opens in a new tab (`target="_blank" rel="noopener noreferrer"`) so the buyer
never loses the page they were on; the link carries
`aria-label="Powered by Kedaipal"`.

### 2. Order receipt / invoice PDF

[`convex/lib/pdf/render.ts`](../convex/lib/pdf/render.ts) `poweredByMark` — the
last footer line on the buyer's order document (both faces, one builder — see
[`invoices-receipts.md`](./invoices-receipts.md)): a mint-outlined
"POWERED BY" pill, **Kedaipal**, `· kedaipal.com`. Text rather than the logo
image, because the letterhead already carries the lockup at the top of the same
sheet. The whole mark is a **PDF link annotation** (`linkAnnotation`) to
`poweredByHref("receipt", storeSlug)` — every phone's PDF viewer honours it, so
a buyer reading their receipt is one tap from kedaipal.com with the attribution
intact; on paper the printed site name is the fallback.
`OrderReceiptData.storeSlug` exists only for this link and is never printed.

The **subscription invoice** (Kedaipal → seller) deliberately keeps the plain
`kedaipal.com` line: a document Kedaipal issues doesn't say "powered by" about
itself, and the ticket's scope is buyer surfaces, not the seller's billing tab.

### 3. Despatch label

The last line of every label: `Powered by Kedaipal · kedaipal.com`
(`POWERED_BY_PRINT_LINE`, 6.5pt, faint, under the seller's own footer text). A
parcel is seen by the buyer — and by the peer sellers who receive parcels all
day — so it's a growth surface like the receipt. Plain text only: a label is
stuck to a box, there's nothing to click. It has a fixed `BRAND_LINE_H` in the
label's measured bottom stack, so a long seller footer or contents list can
never squeeze it out (see [`despatch-labels.md`](./despatch-labels.md)).

### 4. WhatsApp order-confirmation line

[`poweredByLine(locale)`](../convex/lib/whatsappCopy.ts) — a pure, locale-aware
suffix appended to the buyer's free-form order-confirmation message:

- EN: `This shop runs on Kedaipal 🛒 kedaipal.com`
- BM: `Kedai ini guna Kedaipal 🛒 kedaipal.com`

Appended at the **send site** in [`convex/whatsapp.ts`](../convex/whatsapp.ts),
**not** inside the override-able `confirm` template — a retailer editing their
template can't strip it out. It lands as the **last** block of the message: the
normal confirm passes it as `sendPaymentMessage({ footerLine })`; the
mockup-pending and delivery-fee-pending confirms append it directly.

**Where it does NOT reach — and why that's an operator task, not code:**

- **The Meta-approved utility template** (`order_confirmation_utility`,
  `WHATSAPP_ORDER_CONFIRM_TEMPLATE`) is the buyer's one message on every
  production storefront order
  ([`one-message-per-order.md`](./one-message-per-order.md)). A template's body
  is fixed at approval time; nothing can be appended at send time, so the
  free-form line above only fires on the legacy / no-template paths. **To put
  the badge on the prod confirmation, add a template *footer* component
  ("Powered by Kedaipal · kedaipal.com", ≤ 60 chars) in Meta Business Manager
  and re-submit for approval** — an Arif-side change, tracked on the ticket.
  Until then, the order page the template's button opens carries the badge.
- **Counter-checkout confirmations** (`counterOrderConfirmed*`) deliberately do
  not carry the line: those buyers are physically at the store, where the
  printed Store QR Poster is the growth surface.
- **The seller-tapped payment reminder's** send site is mid-rework in
  `z8r3fddtkh` (PR #267); the line lands there in that PR, not in a parallel
  edit of the same lines.
- The WA line's URL is deliberately bare (`kedaipal.com`, no `?src=`): a query
  string inside a chat message reads as spam, and the path is legacy on prod.

## Where the click lands (Kedaipal's own acquisition)

[`src/lib/marketing-attribution.ts`](../src/lib/marketing-attribution.ts)
captures `?src=` **and `?store=`** on the marketing routes into sessionStorage.
The pair travels together: a later tagged hit without `store=` clears a stale
referrer (a spotlight link must not inherit a badge's store), and a `store=`
arriving without any tag is ignored. Both ride every GA4 funnel event (`src`,
`ref_store`) and land at `createRetailer` as `retailers.signupSource`
(re-sanitized) and **`retailers.signupReferrerId`** — the slug resolved to a
store id on the `by_slug` index, dropped when it names no store. An **id, not
the slug**: slugs are renameable and the admin console wants the referrer's
current name.

The admin sellers directory renders it inside the existing acquisition pill:
`via powered-by-track · /hermoolah`. That pill is the CAC ledger's "which
sellers bring us sellers" column. Funnel detail: [`analytics.md`](./analytics.md).

**GA4 operator step (once per property):** register `ref_store` as a custom
dimension if you want to report on it — the param is sent regardless.

## Tests

- [`convex/lib/poweredBy.test.ts`](../convex/lib/poweredBy.test.ts) — the href
  per surface, the store-less form, the slug sanitizer, every tag surviving the
  marketing sanitizer.
- [`src/components/storefront/storefront-footer.test.tsx`](../src/components/storefront/storefront-footer.test.tsx) —
  lockup, surface tag, store param, new tab + `noopener`, `aria-label`.
- [`convex/lib/pdf/render.test.ts`](../convex/lib/pdf/render.test.ts) — reads
  the produced PDFs back: receipt + invoice faces draw the mark and carry
  exactly one URI link annotation, the subscription invoice carries none, every
  label prints the plain line even at the seller-footer cap.
- [`src/lib/marketing-attribution.test.ts`](../src/lib/marketing-attribution.test.ts) /
  [`src/lib/ga-events.test.tsx`](../src/lib/ga-events.test.tsx) — the `store=`
  capture rules and the `ref_store` event param.
- [`convex/retailers.test.ts`](../convex/retailers.test.ts) /
  [`convex/admin.test.ts`](../convex/admin.test.ts) — slug → id resolution,
  unknown / forged slugs dropped, the console reading the CURRENT name and a
  purged referrer as none.
- [`convex/lib/whatsappCopy.test.ts`](../convex/lib/whatsappCopy.test.ts) —
  `poweredByLine` exact EN/BM copy, blank-line lead, independence from a
  retailer's `confirm` override.
