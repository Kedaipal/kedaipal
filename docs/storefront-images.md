# Storefront images — the resize proxy

**ClickUp `86eypxght`.** How a product photo gets from a seller's phone to a buyer's screen, and why it goes through `/img/` instead of straight from Convex storage.

## The problem this fixes

Product images were raw phone-camera originals served direct from Convex storage. Measured on production, 21 Aug 2026 (`/her-moolah-collective`):

| | |
|---|---|
| Photos on one store home | **38.3 MB** (avg 1 MB, largest **4.4 MB**) |
| One product page | 9.84 MB across 5 images |
| Stored dimensions | 1200×1600, painted into ~180 px grid tiles |
| `srcset` anywhere in the app | none |
| Convex cache header | `Cache-Control: private` — forbids shared caches, so **no CDN in front of storage** |
| Per-file fetch | 300 ms – 2.6 s from origin |
| Result | **10 of 42 images ended in the permanent broken-image state on one desktop load** |

A 7801×3001 / 2.7 MB store cover is a real, current example — for a header that is never wider than ~1280 px.

## The shape of the fix

```
buyer  →  kedaipal.com/img/<uuid>?w=320  →  [Cloudflare transform + edge cache]  →  <deployment>.convex.cloud/api/storage/<uuid>
```

Three pieces:

1. **`src/lib/image-proxy.ts`** — pure URL rewriting. Recognises `*.convex.cloud/api/storage/<uuid>` and rewrites to `/img/<uuid>?w=…`. Everything else (`blob:`/`data:` previews, bundled assets, third-party URLs) passes through untouched.
2. **`src/lib/image-route.ts`** — the Worker handler, mounted pre-router in `src/server-entry.ts` (the same custom entry that carries the `86eyheqzv` placeholder-link rescue).
3. **`AppImage`** — rewrites its own `src` and, when given `sizes`, emits a full `srcset`.

### No re-upload, ever

The proxy reads the **stored original on the fly**. The entire existing catalog — every store, every photo already uploaded — is fixed the moment this ships, with no backfill, no migration and no seller action. That is the single reason this design was chosen over the alternatives.

## Decisions worth not re-litigating

**Rewrite on the client, not at the ~45 `ctx.storage.getUrl()` call sites.** Every image in the app already flows through one component. Rewriting in `AppImage` covers all of them; rewriting server-side would mean touching 45 call sites and still missing any new one.

**A Worker route, not Cloudflare's `/cdn-cgi/image/<origin>` URL form.** The URL form only transforms same-zone sources unless the zone is opened to arbitrary origins — and doing that makes the endpoint an open image proxy anyone can bill to our account. Here the origin is **constructed** from a uuid server-side, so a caller can never point it at a host we didn't choose. It also keeps the Convex deployment host out of public HTML entirely (verified: the rendered storefront no longer contains the string `convex.cloud`).

**Image *Transformations*, not the Cloudflare *Images* product.** Same company, different product. CF Images is its own blob store: adopting it means migrating every blob out of Convex — a server-side re-upload of the whole catalog — then living with two sources of truth, since every cascade delete, blob GC and upload path assumes Convex storage. Transformations optimize blobs that never move.

**A width whitelist, because it is the billing cap.** Cloudflare bills per *unique* transformation (one source × one option set, per month). `IMAGE_WIDTHS = [160, 320, 640, 960, 1280]` bounds the option space no matter what a caller asks for. Unknown widths are **clamped, not rejected** — a 400 would turn a typo or a stale URL frozen in a WhatsApp preview into a broken image, while clamping keeps the bill equally bounded.

**The subrequest must say WebP is welcome.** Verified against the live zone once transformations were switched on: the identical `format=webp` transform returns `image/png` under `Accept: */*` and `image/webp` under `Accept: image/webp` — Cloudflare will not hand back a format the request didn't ask for. A Worker subrequest carries no `Accept` of its own, so the route sends a constant `image/webp,*/*`. Constant rather than forwarded from the buyer: Cloudflare sets `Vary: Accept`, so forwarding would split the cache per client and, under `cacheEverything`, risk serving a cached WebP to a client that never asked for one. Measured cost of getting this wrong: 15.9 KB vs 5.9 KB on one 320 px image — the resize still lands, the re-encode silently doesn't.

**WebP explicitly, not `format: "auto"`.** Universal since Safari 14, and pinning one output per width keeps a single cache entry (and a single billed unique) per file per width rather than splitting by the caller's `Accept`. AVIF is a later tweak, not a requirement.

**`immutable` is true by construction.** Convex blobs are never rewritten in place — every replace path mints a new storage id (and a new uuid) and GCs the old blob. A given uuid's bytes can never change; they can only stop existing, and a deleted file's cached copies are no worse than the 30-day private cache the originals already carry. A 404 is edge-cached for only 60 s.

**`srcset` requires `sizes`.** A `srcset` without `sizes` makes the browser assume the image is 100vw and pull the **largest** candidate — on a grid of 180 px tiles that is worse than not proxying at all. `AppImage` therefore emits `srcset` only when a call site supplies `sizes`; without it the image is still proxied, just at one fixed width (`DEFAULT_IMAGE_WIDTH`).

**The lightbox keeps the original.** `ZoomableImage`'s zoom view renders the untouched storage URL — it zooms to 3×, exactly the case a resized derivative renders soft. Those bytes are fetched only when a buyer explicitly opens the zoom.

**The LCP preload must name the proxied candidate.** `$slug.tsx` preloads the store cover; `StorefrontHeader` renders it through `AppImage`. If the preload named the raw storage URL it would download a file the page never uses *and* leave the real LCP element unpreloaded — so the preload carries `imagesrcset`/`imagesizes` mirroring the component's own `sizes="100vw"`.

**og:image goes through the proxy too.** Link unfurlers are known to skip oversized images outright, so a 4 MB cover is exactly what they drop. This is a correctness fix for WhatsApp link previews, not only a weight one — absolute URLs, since an unfurler can't resolve a root-relative path.

## Failure behaviour — it degrades to today, never to broken

If the transform can't run — **the zone toggle is off**, the source is an SVG, the format is unsupported — Cloudflare returns the **original bytes** with a `Cf-Resized: err=…` header. That is exactly current behaviour. This is what makes the code safe to merge before the dashboard toggle is flipped.

Local `vite dev` runs the real Worker (the Cloudflare Vite plugin, `viteEnvironment: ssr`), so `/img/` works in dev; `cf.image` is simply ignored off-network and originals are served. **No dev middleware is needed** — verified: `/img/<uuid>` in dev returns bytes byte-identical to the origin.

## Setup — one manual step

Image Transformations must be enabled on the zone, and **were not as of 23 Aug 2026** (probing `/cdn-cgi/image/…` on prod returned a bare Cloudflare 404 with no `Cf-Resized` header):

> Cloudflare dashboard → the **kedaipal.com** zone → **Images → Transformations → Enable**

No "resize from any origin" toggle is needed — the Worker fetches the origin itself. Billing: 5,000 unique transformations/month free, then US$0.50 per 1,000.

`CONVEX_URL` needs no new wiring: `.github/workflows/deploy.yml` already passes it to the Worker via `wrangler deploy --var CONVEX_URL:…`, and `serverEnv.CONVEX_URL` covers `wrangler dev` / node.

## Adding a new image surface

1. Render it with `AppImage` (never a raw `<img>` — see [`design-system.md`](./design-system.md)).
2. Give it a `sizes` describing how wide it actually paints. Match the layout classes; if it's a fixed box, a plain `"176px"` is best.
3. That's all — the proxying is automatic.

Current hints: product grid tiles `(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw` (tracks `GRID_CLASS`), category rail `176px`, store logo `64px`, product thumbs `56px`, product hero `(min-width: 1024px) 45vw, 100vw`, store cover `100vw`.

## Not in scope

- **Compress on upload.** Every upload site posts the raw picker file (`product-images-field.tsx`, `variant-editor.tsx`, `variant-image-cell.tsx`, `category-edit-dialog.tsx`), and `products.generateUploadUrl` has no size or type guard. Worth doing to stop storage cost growing, but it only helps *new* uploads and does nothing for the live catalog — which is why it isn't the headline fix.
- AVIF / `Accept` negotiation.
- Retroactively shrinking stored originals — nothing requires it, and the originals double as the print/PDF-quality source.

## Related

- [`design-system.md`](./design-system.md) — the `AppImage` contract.
- `86eypxgff` — bounded retry on a failed image load. Complementary: the proxy makes failures rare, the retry makes the rare ones invisible.
