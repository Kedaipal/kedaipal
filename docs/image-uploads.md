# Image uploads — validate and normalize before storing

**ClickUp `86eyr6zm8`.** Why every image upload in the app goes through one function, and what it refuses.

## The bug

A seller uploaded `IMG_0056.HEIC` — 2.5 MB, straight from a Mac's Downloads folder — as a product photo. It stored fine and then rendered as the broken-image fallback.

**HEIC is not a web image format.** No browser except Safari can decode it in an `<img>`. macOS Finder shows a perfectly good thumbnail because the OS decodes it natively, so the file looks fine right up to the moment it hits the page. And `accept="image/*"` does **not** exclude it — macOS offers `.HEIC` under that filter.

It is a *format* problem, not a size problem: a 2.5 MB JPEG renders fine; a 2.5 MB HEIC cannot render in Chrome at any size.

Confirmed in the dev DB at the time: two files stored with `contentType: image/heic`.

## Why the other two image tickets can't fix it

- **`86eypxgff` (retry)** correctly retries and then shows the fallback. There is nothing to recover — the bytes are undecodable.
- **`86eypxght` (Cloudflare resize proxy)** must **not** be relied on. Its whole safety property is that an un-runnable transform returns the **original** bytes, and the original is precisely the thing that doesn't render. HEIC also isn't among Cloudflare's documented transformation input formats.

The fix has to be at upload, before the bytes are ever stored.

## The rule

> We never store bytes we haven't proven this browser can decode.

`src/lib/image-upload.ts` → `prepareImageUpload(file)`, in front of **every** upload:

1. **Prove it renders by rendering it** — `new Image()` + `.decode()`, which succeeds exactly when an `<img>` would. Deliberately a **capability test, not a format allowlist**: an allowlist only ever knows the formats we thought of, and HEIC is exactly the format nobody thought of.
2. **Normalize** — resize to a 1600 px long edge and re-encode WebP q0.82. Fixes format *and* weight in one pass (a 2.5 MB phone photo → ~150 KB). If re-encoding would produce *more* bytes than we were handed and no resize was needed, the original is kept — the point is never to ship more than we were given.
3. **Reject with the fix, not a shrug** — the message names HEIC and the menu that converts it, and names the file, so a rejected batch says *which* file to fix.
4. **`IMAGE_ACCEPT`** replaces `image/*` at all 12 file inputs, so the OS picker greys `.HEIC` out instead of offering a file we're about to refuse. The runtime check still stands behind it: drag-and-drop and the picker's "All Files" escape hatch bypass `accept` entirely.

**SVG and GIF pass through untouched** (`PASSTHROUGH_TYPES`): rasterizing a vector throws away the only reason to use one, and a canvas re-encode of an animated GIF silently keeps just the first frame — a worse bug than the weight it saves. Both are size-capped instead.

**Safari gets HEIC for free.** It *can* decode HEIC, so step 1 succeeds and step 2 converts it to WebP. Those users never see a refusal.

**Batches are all-or-nothing** (product images, mockups): every file is prepared before any is uploaded, because a partial upload leaves the seller guessing which photos actually made it.

## Where it runs — 12 inputs

| Surface | Uploader |
|---|---|
| `forms/product-images-field.tsx` | seller |
| `forms/variant-editor.tsx` (×2) | seller |
| `forms/variant-image-cell.tsx` | seller |
| `dashboard/category-edit-dialog.tsx` | seller |
| `routes/app.settings.tsx` (logo, cover, payment QR) | seller |
| `routes/app.orders.$shortId.tsx` | seller → **buyer approves it** |
| `routes/app.admin.billing.tsx` | admin |
| `storefront/product-purchase.tsx` | buyer |
| `storefront/manual-payment-dialog.tsx` | buyer → **seller must read it** |

The last two in bold are why this matters beyond tidiness. An unreadable **payment proof** means a seller is asked to confirm money arrived against a broken box, with nothing telling either side why — that silently breaks the core payment handshake. An unreadable **mockup** is the mirror: the buyer is asked to approve a design they can't see.

## The one server-side check

`convex/lib/imageContentType.ts`, wired into **`orders.claimPayment` only**.

That is the single genuine trust boundary in the app: a **buyer** supplies the file and a **seller** has to look at it. Everywhere else a seller uploads to their own store, where the only person a bad file hurts is the uploader — not worth a system-table read on every write path.

It **fails open** on an unknown content type. The costs are asymmetric: wrongly blocking a claim stops a real payment from being recorded, while wrongly allowing one shows a broken image — the status quo, not a regression.

**Known test-harness gap:** `convex-test`'s storage doesn't record `contentType`, so `db.system.get()` returns no type and the rejection can't be exercised through the mutation. The logic is unit-tested against a stub context instead (`imageContentType.test.ts`), and the mutation test pins the half that *is* reachable — that a normal proof still goes through, which is the regression that matters given the fail-open default.

## Follow-ups

- **Server-side HEIC decode** (WASM libheif in a Convex action) would let Chrome users upload HEIC too, instead of being told to convert. Deferred — heavier, and the reject path with good copy covers the case.
- **Existing HEIC rows in prod are unverified.** Prod tooling here is read-only. If any exist, those sellers have broken photos right now and don't know.

## Related

- `86eypxgff` — bounded retry on a failed image load.
- `86eypxght` — the Cloudflare resize proxy (`docs/storefront-images.md`, once merged).
