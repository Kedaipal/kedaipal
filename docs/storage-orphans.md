# Orphaned storage blobs — inventory + safe-sweep design

Every file upload in Kedaipal follows Convex's standard two-step pattern:

1. Client requests a one-time upload URL (`generateUploadUrl()` / a
   `generate*UploadUrl` mutation) — this reserves a `storageId` and the bytes land
   in Convex file storage.
2. Client POSTs the file to that URL.
3. Client "attaches" the `storageId` by saving it onto a document (e.g.
   `updateSettings({ logoStorageId })`, `products.create`, `orders.create`).

A blob only becomes **referenced** at step 3. If a caller completes steps 1–2 but
never reaches step 3 — closes the tab, picks a different file before saving,
hits a validation error — the bytes sit in storage with **no document pointing
to them**. Nothing in the app can find, show, or delete them again.

**This is not a security or correctness issue.** An orphan is unreferenced: it
can't be served (no URL is stored anywhere), can't leak, and can't break any
feature. The only cost is a slow storage-size drip. Tracked here purely as a
hygiene/cost item, not a bug.

## Current inventory of `storageId`-bearing fields (as of 2026-07-02)

Anything that can leave an orphan on an abandoned upload:

| Table.field | Kind | GC'd on replace/clear today? |
| --- | --- | --- |
| `retailers.logoStorageId` | single | ✅ (`updateSettings`) |
| `retailers.coverImageStorageId` | single | ✅ (`updateSettings`) |
| `retailers.paymentMethods[].qrImageStorageId` | per-array-item | ✅ (method removed/replaced) |
| `retailers.paymentInstructions.qrImageStorageId` | single (deprecated field) | partial — legacy path |
| `billingConfig.qrImageStorageId` | singleton | ✅ (`updateBillingConfig`) |
| `products.imageStorageIds` | array | ✅ on product update; not on abandoned create |
| `productVariants.imageStorageIds` | array | ✅ on variant update; not on abandoned create |
| `orders.customerImageStorageId` | single | N/A (set once at order create) |
| `orders.paymentProofStorageId` | single | N/A (set once at payment claim) |
| `orders.mockupImageStorageId(s)` | single + array | N/A (set once at submit) |
| `invoices.pdfStorageId` | single | N/A (system-generated, one-time) |

Excluded from the sweep (self-cleaning by design, not part of this problem):
the transient receipt/invoice PDF blobs created in `orders.deliverOrderDocument`
— these are never attached to a document at all; they're deleted by a
`ctx.scheduler.runAfter(10 * 60 * 1000, ...)` job unconditionally, whether or
not the WhatsApp send succeeded.

## Where orphans actually accumulate

Only the **upload-before-save** flows are exposed to this: retailer logo,
retailer cover image, payment-method QR, billing-config QR, and product/variant
images during **create** (an edit's replace path already GCs the old blob — see
the "single" rows above). A seller who uploads a photo, then abandons the
"Add product" form, leaves one orphaned image blob.

## Why we're not sweeping yet

A cleanup job is inherently a **destructive, whole-storage** operation: list
every blob in the deployment, compute the set actually referenced by walking
every table above, and delete anything unreferenced past an age threshold.
The risk is asymmetric — a single omission in the "referenced" walk (an
existing field renamed, a new upload feature added and forgotten here) deletes
a **live** file, not an orphan. Given the low current cost (pre-launch, small
file counts), the safer call today is to defer the sweep until it can be built
deliberately, with its own tests.

## Design for the future sweep (when we build it)

- **Age-gated, never same-day.** Only consider blobs older than e.g. 48h —
  guards against deleting something mid-upload-flow (upload done, save not yet
  committed).
- **Exhaustive reference walk.** One function that enumerates every
  `storageId`-bearing field above (kept in sync with this table) and returns
  the referenced-id set. Any new upload feature must add its field here in the
  same PR — call this out in a CLAUDE.md convention.
- **Dry-run first.** Ship it logging "would delete N blobs, ~X MB" for a
  release or two before enabling actual deletion.
- **Exclude the transient PDF path** explicitly (already self-cleaning) so the
  sweep doesn't fight the scheduled cleanup.
- **Scheduled cron**, low frequency (daily/weekly) — this is a slow leak, not
  urgent.

## Non-goals

- Not a backfill/migration — no existing data changes as part of writing this
  doc.
- Not blocking any current feature work.
