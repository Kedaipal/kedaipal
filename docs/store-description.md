# Store Description on Storefront

**Status: implemented.** Lets a retailer set a short, public one-liner that
renders on the storefront header beneath the store name ("Home-based frozen
food, Semenyih — DM for bulk orders"). Before this, a storefront had a logo and
name but no space to say what the store *is* — shoppers landing on
`kedaipal.com/<slug>` got no context or trust signal. Source: Metalpix prospect
call, 1 Jun 2026 (parity-gap signal, universal to F&B core). ClickUp `86extzdmd`.

## Data

One optional field on `retailers` (`convex/schema.ts`):

```ts
storeDescription: v.optional(v.string()),
```

Additive optional field → no migration; legacy/unset rows read as "no
description". No index — only ever read alongside the retailer row.

## Flow

1. **Settings** (`app.settings.tsx`, Store tab) — a "Store description" card with
   a 3-row textarea (`maxLength` 280 + live counter), placed directly under
   "Business name" since both are store-identity copy. Clearing it (blank) is a
   valid edit that removes the line.
2. **Save** (`retailers.updateSettings`) — accepts `storeDescription`, trims
   outer whitespace (internal newlines preserved), treats blank as "clear"
   (`undefined`), and hard-caps at `STORE_DESCRIPTION_MAX = 280` (throws past it —
   defense-in-depth behind the client cap, never trust the client).
3. **Reads** — surfaced on both the owner read (`getMyRetailer`) and the public
   storefront payload (`getRetailerBySlug`). Public-safe.
4. **Storefront** (`$slug.tsx`) — rendered in the header under the store name.
   When set it **replaces** the generic "Browse & order on WhatsApp" tagline
   (the seller's own blurb is the stronger signal; showing both is redundant);
   when unset, the generic tagline stays. Empty → no empty block.
5. **SEO** (`$slug.tsx` loader/head) — the description also feeds the page's
   `<meta>`/OG/JSON-LD description (newlines collapsed to a single line),
   preferring the seller's words over the generated blurb. Near-free SEO/trust
   win.

## Safety

Plain text only. The header renders `{retailer.storeDescription}` in JSX (React
escapes by default — no markdown/HTML interpretation) with `whitespace-pre-line`
to preserve newlines and `line-clamp-4` to keep the header tidy even if the
seller stuffs the full 280 chars. No `dangerouslySetInnerHTML`.

## Tier

**Ungated — available on every plan.** A one-line "what I sell" blurb is basic
trust-signal table stakes; paywalling it would leave storefronts looking empty
and hurt conversion for exactly the sellers we want to land. (The roadmap ticket
labels it "Starter (RM79)" under *Tier impact* — that's the tier it landed in,
not a gate. There is no entitlement check on `storeDescription`.)

## See also

- [`store-cover-banner.md`](./store-cover-banner.md) — the wide cover/banner
  image (storefront hero + primary OG image), the other public storefront-header
  presentation add.
