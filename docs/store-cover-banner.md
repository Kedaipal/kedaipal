# Store Cover / Banner Image (storefront + OG)

**Status: implemented.** Lets a retailer upload one wide cover/banner image that
(1) renders full-bleed at the top of their storefront header — a real shopfront
hero above the logo + name — and (2) becomes the **primary** OG / social-share +
JSON-LD image, with the logo and first product image as fallbacks. Before this,
the storefront had only a square logo; the OG card fell back to that square (or a
product image), which renders poorly as a `summary_large_image` on
WhatsApp/FB/IG. A dedicated wide cover is the highest-leverage trust + SEO add for
the public storefront. ClickUp `86ey391dh`. Parallels the existing logo feature
end-to-end. See also [`store-description.md`](./store-description.md).

## Data

One optional field on `retailers` (`convex/schema.ts`):

```ts
coverImageStorageId: v.optional(v.string()),
```

Additive optional field → no migration; legacy/unset rows read as "no cover". No
index — only ever read alongside the retailer row, same as `logoStorageId`.

## Flow

1. **Settings** (`app.settings.tsx`, Store tab) — a "Cover image" card
   (`CoverImageForm`) placed **directly after** the logo card (both are
   store-identity visuals). Wide ~3:1 `object-cover` preview, upload / Replace /
   Remove, helper copy names the recommended size: *"Best size 1200 × 400 px
   (wide 3:1). Fills your storefront header and shows as the preview when you
   share your link. Max ~2MB."* Mirrors `LogoForm`.
2. **Upload** (`retailers.generateCoverImageUploadUrl`) — one-shot upload URL,
   rate-limited on the shared `productWrite` bucket (same as the logo/QR uploads).
   The client POSTs the file, then saves the returned `storageId` via
   `updateSettings({ coverImageStorageId })`.
3. **Save** (`retailers.updateSettings`) — accepts `coverImageStorageId`: a blank
   string **clears** (`undefined`), `undefined` means "no change". On **replace or
   clear** the previous blob is **garbage-collected** (`ctx.storage.delete`,
   best-effort — a missing/already-deleted blob must not abort the save), mirroring
   the payment-QR GC so storage never leaks on swaps.
4. **Reads** — resolved to `coverImageUrl` on both the owner read
   (`getMyRetailer` → `buildRetailerPublic`) and the public storefront payload
   (`getRetailerBySlug`). Public-safe.
5. **Storefront** (`$slug.tsx`) — when set, the cover becomes the **header
   background** (`object-cover` filling a `min-h-[14rem]`/`lg:min-h-[19rem]`
   header). The Kedaipal mark (light `logo-dark.svg` variant), store logo, name +
   blurb **overlay** on top over a bottom-weighted scrim
   (`bg-gradient-to-t from-black/80 …`) so text stays legible on any image —
   identity is bottom-anchored (`justify-between`), name/blurb switch to white with
   a drop-shadow. When **unset**, the header falls back to the original light
   gradient layout (top-anchored, dark text) — no empty gap. `hasCover` gates the
   two layouts in one `<header>`.
6. **OG / SEO** (`$slug.tsx` loader/head) — image precedence is
   **cover → logo → first product image**. `twitter:card` stays
   `summary_large_image` whenever any image resolves; the same resolved URL feeds
   `og:image`, `twitter:image`, and the JSON-LD `Store.image`.

## Account deletion

The deletion cascade (`retailers.deleteUser`) deletes the cover blob alongside
the logo and QR images (best-effort `deleteFile`).

## Logo replace-GC (fixed in passing)

While building this we closed a pre-existing leak: the **logo** upload never
garbage-collected the previous blob on replace/clear. `updateSettings` now applies
the same replace-GC to `logoStorageId` as it does to the cover. Covered by tests.

## Safety / limits

`accept="image/*"`, `object-cover` in a fixed-aspect container so tall/short
sources are cropped, not stretched. "Max ~2MB" is advisory copy (matching the
logo card) — Convex storage enforces its own hard limits. No user text is
rendered from this field; it's an image URL only.

## Tier

**Ungated — available on every plan.** Basic storefront presentation (the ticket
lists it under all paid tiers). No entitlement check on `coverImageStorageId`.
