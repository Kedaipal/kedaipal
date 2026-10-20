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

1. **Prove it renders by rendering it** — `new Image()` + `.decode()`, which succeeds exactly when an `<img>` would. Deliberately a **capability test, not a format allowlist**: an allowlist only ever knows the formats we thought of, and HEIC is exactly the format nobody thought of. A file that *declares* a non-image type is refused up front, but an **empty** type is not — some pickers and drag sources supply none, and judging on the label alone is the habit this module exists to break, so it goes to the decoder like everything else.
2. **Normalize** — resize to a 1600 px long edge and re-encode WebP q0.82. Fixes format *and* weight in one pass (a 2.5 MB phone photo → ~150 KB).

### Two traps in the normalize path (PR #225 review)

**The stored content type is whatever the encoder actually produced, never what we asked for.** `canvas.toBlob` is specified to fall back to **PNG silently** when it can't encode the requested type — the returned blob's `.type` is the only way to find out. Hardcoding `image/webp` would mean that on any browser without WebP encoding, every upload stores PNG bytes labelled WebP: the size win evaporates (a 1600 px PNG of a photo is megabytes, not ~150 KB) *and* the label is a lie at exactly the boundary where this module just made declared types load-bearing — `isStoredImageRenderable` trusts them, and the resize proxy may key off them. A blob with no type at all is refused rather than guessed at.

Where the fallback lands on PNG and the source has **no alpha to lose** (`ALPHA_FREE_SOURCE_TYPES` — JPEG, HEIC, HEIF), it re-encodes as JPEG q0.82 instead, which every browser can encode and which still gets most of the size win. A PNG/WebP/AVIF source keeps the encoder's output: flattening a transparent store logo onto black to save bytes is a worse outcome than the bytes.

**Keeping the original is a positive allowlist, not an exclusion.** If no resize was needed and re-encoding gained nothing, the original bytes may be kept — but only for `KEEP_ORIGINAL_TYPES` (JPEG, PNG, WebP, AVIF). An earlier version excluded `image/heic` *by name*, which is the same allowlist-shaped mistake the decode test exists to avoid: it only knows the format someone thought of. Safari decodes **HEIF and TIFF** too, so both would pass the decode test and then be stored as-is — unrenderable on Chrome, the exact bug this module was written to kill. Listing what is safe to keep makes the rule true by construction.
3. **Reject with the fix, not a shrug** — the message names HEIC and the menu that converts it, and names the file, so a rejected batch says *which* file to fix.
4. **`IMAGE_ACCEPT`** replaces `image/*` at all 12 file inputs, so the OS picker greys `.HEIC` out instead of offering a file we're about to refuse. The runtime check still stands behind it: drag-and-drop and the picker's "All Files" escape hatch bypass `accept` entirely.

**SVG and GIF pass through untouched** (`PASSTHROUGH_TYPES`): rasterizing a vector throws away the only reason to use one, and a canvas re-encode of an animated GIF silently keeps just the first frame — a worse bug than the weight it saves. Both are size-capped instead.

**Safari gets HEIC for free.** It *can* decode HEIC, so step 1 succeeds and step 2 converts it to WebP. Those users never see a refusal.

**Batches: the mockup is all-or-nothing, product photos are per-tile.** A mockup set is prepared whole before any of it is uploaded, and a mid-set failure discards what already went up — the buyer must never be asked to approve half a design. Product photos used to work the same way, for the same reason ("a partial upload leaves the seller guessing which photos made it"); since z8r3fdtk85 each photo has its own tile that says whether it made it, which answers that question directly, so a pick of five no longer fails whole because one file was bad.

## Every step has a deadline — `src/lib/storage-upload.ts` (z8r3fdtk85)

**The bug:** during the Campfest admin pass a product photo tile sat on "Uploading…" forever, and DevTools showed no upload request. Prod was quiet at the time (7–8 uploads an hour store-wide; the 158-file bulk upload came *after* the report, and the same store's photos all uploaded fine the next day), so it was not a busy server. Every upload ran four **unbounded** awaits — prepare (`img.decode()` + `canvas.toBlob`), mint the upload URL, POST the bytes, read the storage id — so any one that never settled left a spinner with nothing behind it, and the `catch` never ran.

**Why "no request in the Network tab" points at the mint:** the upload-URL mint is a Convex **mutation**, which rides the WebSocket and never shows as an HTTP request. The Convex client *queues* a mutation while its socket is reconnecting or its auth token is refreshing, so the promise simply waits — no error, no request. Only the POST of the bytes is a visible request, and it never fired.

**The rule:** every image upload goes through `uploadImage(file, mintUrl)` (or `prepareImage` + `uploadPrepared` where a site must prepare a whole set first, or check the prepared size). Each step races a deadline — prepare 30s, mint 20s, POST 90s (the POST is also **aborted**, so the bytes stop going up once we've given up) — and the result is always `{ ok: true, storageId, blob }` or `{ ok: false, reason, retryable, message }`. It never throws and never hangs. Offline fails fast, before the mint.

**`retryable` is honest.** A file we refuse (HEIC, too large) and a server refusal that names its own fix (a view-only store) are *not* retryable — a Retry there is a wrong-but-enabled button. The rate limiter's refusal *is* ("try again in 30s"), and so are timeouts and transport failures. `reason` is machine-readable so a localized surface (the buyer's payment-proof dialog, BM/EN) can speak its own words instead of the English `message`.

**The product photo grid** gives every picked photo its own tile: "Uploading…" over the preview, then it joins the grid or becomes **"Didn't upload"** with a 44px **Retry** strip and a remove ×, plus one line under the grid per distinct reason. A non-retryable failure skips the tile and toasts the reason. Uploads run one at a time (keeps a five-photo pick inside the per-minute write limit; appends land in pick order), and photos still in flight count toward the 5-photo cap. The grid reports `{kind: "uploading"}` / `{kind: "failed", count}` / `{kind: "idle"}` to its parent: `uploading` holds Save, and `failed` counts as unsaved work so the leave guard asks before the photo is lost — and the parent's primary button says so. The edit form's Save bar and the wizard's Continue both read **"1 photo didn't upload"** (`failedPhotosLabel`, one author) and are disabled while a tile sits failed: a bar reading "All changes saved" beside a "Didn't upload" tile was lying, and an enabled Continue let the wizard create the product without the photo (both found in the /test-code pass). Refusals the grid makes itself (a HEIC, one over the 5-photo cap) are said **under the grid**, cleared by the next pick — routed to the form's error slot they landed two screens down beside Save, where nothing seemed to happen.

Before this, the same four awaits were copy-pasted at eleven sites — which is how none of them got a deadline. Add an image upload by calling the helper, never by writing the awaits again.

## Where it runs — 13 inputs

| Surface | Uploader |
|---|---|
| `forms/product-images-field.tsx` | seller |
| `forms/variant-editor.tsx` (×2) | seller |
| `forms/variant-image-cell.tsx` | seller |
| `dashboard/category-edit-dialog.tsx` | seller |
| `routes/app.settings.tsx` (logo, cover, payment QR) | seller |
| `routes/app.orders.$shortId.tsx` | seller → **buyer approves it** |
| `routes/app.admin.billing.tsx` | admin |
| `admin/showcase-editor.tsx` (event cover) | admin |
| `storefront/product-purchase.tsx` | buyer |
| `storefront/manual-payment-dialog.tsx` | buyer → **seller must read it** |

The last two in bold are why this matters beyond tidiness. An unreadable **payment proof** means a seller is asked to confirm money arrived against a broken box, with nothing telling either side why — that silently breaks the core payment handshake. An unreadable **mockup** is the mirror: the buyer is asked to approve a design they can't see.

## The one server-side check

`convex/lib/imageContentType.ts`, wired into **`orders.claimPayment` only**.

That is the single genuine trust boundary in the app: a **buyer** supplies the file and a **seller** has to look at it. Everywhere else a seller uploads to their own store, where the only person a bad file hurts is the uploader — not worth a system-table read on every write path.

It **fails open** on an unknown content type — and on a *malformed* id, which throws rather than returning null (the argument is `v.string()`, so a crafted direct call can pass anything; an abuser getting a raw internal error instead of the buyer-facing message helps nobody). The costs are asymmetric: wrongly blocking a claim stops a real payment from being recorded, while wrongly allowing one shows a broken image — the status quo, not a regression.

**Known test-harness gap:** `convex-test`'s storage doesn't record `contentType`, so `db.system.get()` returns no type and the rejection can't be exercised through the mutation. The logic is unit-tested against a stub context instead (`imageContentType.test.ts`), and the mutation test pins the half that *is* reachable — that a normal proof still goes through, which is the regression that matters given the fail-open default.

## Follow-ups

- **Server-side HEIC decode** (WASM libheif in a Convex action) would let Chrome users upload HEIC too, instead of being told to convert. Deferred — heavier, and the reject path with good copy covers the case.
- **Existing HEIC rows in prod are unverified.** Prod tooling here is read-only. If any exist, those sellers have broken photos right now and don't know.

## Related

- `86eypxgff` — bounded retry on a failed image load.
- `86eypxght` — the Cloudflare resize proxy (`docs/storefront-images.md`, once merged).
