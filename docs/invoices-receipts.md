# Invoice & Receipt PDF Generation

**Status: implemented.** Two distinct PDF documents, plus a CSV bookkeeping
export:

- **A — Order receipt (buyer-facing):** a PDF of a shopper's order, generated
  **on demand** from the order data. The buyer self-serves it from the tracking
  page; the seller can pull it from order detail.
- **B — Subscription invoice (Kedaipal → seller):** the monthly platform-fee
  invoice. Rendered + **stored once at issue time** and downloadable from the
  billing tab (seller) and admin billing console (Kedaipal).
- **Bulk export:** the orders inbox exports the current filter (or a ticked
  selection) to **CSV** — the right tool for bookkeeping, where a stack of PDFs
  isn't.

ClickUp `86ext578n`. Needed before the first paid customer (~5 Jul 2026).

## Reconciliation with the existing codebase

The ticket was drafted assuming nothing existed. In reality the **subscription
billing spine already shipped** (`86expn2qg`, [`manual-subscription.md`](./manual-subscription.md)):
the `invoices` / `subscriptions` / `billingConfig` tables, `issueInvoice`,
`myInvoices`, `markPaid`, the billing tab + admin route. So **Use Case B was ~90%
built** — the only gap was rendering a PDF of an invoice row that already exists.

We therefore did **not** create the ticket's proposed generic
`invoices(type, sellerId, pdfStorageId)` table — it would collide with the live
subscription `invoices` table. We extended the real one with a single field.

## Storage decision (why A and B differ)

| | Generated | Stored? | Why |
|---|---|---|---|
| **A — order receipt** | on download | **No** | Deterministic from the order; storing a blob nobody may fetch is waste. Email/list-UI are out of scope, so an auto-stored receipt would just sit there. |
| **B — subscription invoice** | at issue time | **Yes** (`invoices.pdfStorageId`) | A financial document. `billingConfig` bank details are a mutable singleton, so regenerating later could produce *different* bytes than the seller received. Freeze at issue. |

## Code map

Pure, render-free (unit-tested):
- `convex/lib/pdf/document.ts` — money/date formatters (`formatMoney`,
  `formatDocDate`), the view-models, and the `Doc → view-model` mappers
  (`orderToReceiptData`, `invoiceToSubscriptionData`, `billingConfigToBlocks`…).
- `convex/lib/orderInboxFilter.ts` — the inbox filter predicate
  (`buildInboxPredicate`, `compareInboxOrder`), **extracted from `searchOrders`**
  so the export and the live inbox can't diverge.
- `convex/lib/orderCsv.ts` — CSV row mapping, RFC-4180 escaping, and
  **formula-injection defense** (a field starting `= + - @` is prefixed `'`).

Rendering (pdf-lib, runs in the default Convex runtime — no `"use node"`):
- `convex/lib/pdf/render.ts` — `buildOrderReceiptPdf` / `buildSubscriptionInvoicePdf`.
  A branded letterhead layout (logo lockup top-left, document type top-right, mint
  accent rule, tinted line-item table, highlighted green total bar, bordered
  payment card, centered footer) using the slate-900/mint palette from
  `src/styles.css`. Text is sanitized to WinAnsi (standard fonts throw on
  emoji/CJK), so a non-Latin store name degrades gracefully instead of crashing.
- `convex/lib/pdf/logo.ts` — the Kedaipal brand lockup (`public/logo-2.png`)
  inlined as base64 so `embedPng` needs **no network fetch** (deterministic render
  inside the action). To refresh after a logo change, regenerate it:

  ```bash
  node -e 'const fs=require("fs");const b=fs.readFileSync("public/logo-2.png");
    const w=b.readUInt32BE(16),h=b.readUInt32BE(20);
    fs.writeFileSync("convex/lib/pdf/logo.ts",
      `export const KEDAIPAL_LOGO_PNG_SIZE = { width: ${w}, height: ${h} } as const;\n`+
      `export function kedaipalLogoPngBytes(): Uint8Array {\n\treturn Uint8Array.from(atob(KEDAIPAL_LOGO_PNG_BASE64), (c) => c.charCodeAt(0));\n}\n`+
      `const KEDAIPAL_LOGO_PNG_BASE64 =\n\t"${b.toString("base64")}";\n`);'
  ```

  To eyeball the rendered output on macOS: build a PDF to `/tmp/x.pdf`, then
  `qlmanage -t -s 1000 -o /tmp /tmp/x.pdf` produces `/tmp/x.pdf.png`.

Backend:
- **A:** `orders.generateReceiptPdf` (public action) → returns PDF bytes +
  filename. Authorized through the same `resolveSharedOrder` seam as `orders.get`:
  buyer passes `token`, seller passes an owned `shortId`.
- **B:** `invoices.generateInvoicePdf` (internal action, scheduled from
  `issueInvoice`) renders + stores the blob; idempotent (skips if one exists).
  `invoices.getInvoicePdfUrl` returns an ownership-checked signed URL (owning
  retailer **or** admin; `null` while still rendering).
- **CSV:** `orders.exportOrders` (**action**) — same filter args as
  `searchOrders` (via the shared predicate), or an explicit `orderIds` selection.
  Unlike the reactive inbox (capped at a 1000-doc scan), the export **paginates
  the full result set** in 500-row pages via the internal `exportPage` query, so
  a bookkeeping export is never silently truncated to the latest 1000 orders. A
  hard `EXPORT_SCAN_CAP` (20,000 docs ≈ 10 months at the Scale tier) bounds the
  worst case and is surfaced as a `capped` flag — the inbox warns the seller
  ("Exported the latest N … narrow the date range") rather than returning
  silently-incomplete books. Returns `{ csv, count, capped }`. An action (not a
  query) because it's a one-shot file generation, not a subscription.

Frontend:
- `src/components/order/receipt-download-button.tsx` — used by the seller order
  detail (`shortId`) and the buyer tracking page (`token`).
- `src/components/settings/invoice-download-button.tsx` — used by the billing tab
  and admin billing console.
- `src/lib/download.ts` — `downloadPdfBytes` / `downloadCsv` (CSV gets a UTF-8 BOM
  so Excel reads non-ASCII).
- Orders inbox (`app.orders.index.tsx`) — an **Export CSV** button (label becomes
  "Export N" when rows are selected).

## Discoverability

Every surface is a visible button where the document is relevant — the seller's
order detail + inbox, the buyer's tracking page, the billing tab, and the admin
console. A just-issued invoice's button toasts "still being prepared" for the few
seconds before the async render lands, rather than failing silently.

## Schema

One additive optional field (`convex/schema.ts`, dev-only widen, no backfill):

```ts
// invoices
pdfStorageId: v.optional(v.id("_storage")),
```

## Out of scope (tracked separately)

Email delivery of invoices/receipts; a dedicated invoice-list UI; payment
reconciliation; SST/tax compliance.
