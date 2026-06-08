# Bulk Product Upload — Improvement Roadmap

Review of the current bulk import flow and a prioritized list of features that would measurably help retailers. Not a plan — a reference menu to pull from when we pick up the next round of work.

## Shipped — variant-aware import/export (2026-06-04)

The importer + exporter were reworked for the variant schema (subtask of
[`product-variants.md`](./product-variants.md)). Key design, now live:

- **One row per variant.** Rows are grouped into a product by `product_handle`
  (falls back to `name`); option axes are inferred from `option1_*`/`option2_*`
  columns. Legacy 4-column sheets (`name,description,price,stock`) still import
  as single-variant products — fully back-compatible.
- **Auto-fill (full-grid guarantee).** Any cartesian combination the sheet omits
  is added as an **inactive** variant at 0 price / 0 stock, so the data always
  forms the complete grid the variant model requires. The seller re-activates
  them later. An ⓘ note in the importer explains this.
- **Upsert by variant SKU; never deletes.** A row whose SKU matches an existing
  variant **updates** it (price/stock/weight) + product fields; unlisted variants
  are left untouched (so a partial stock-update sheet is safe). A row with a new
  SKU aimed at an existing product is **skipped + warned** ("add new variants in
  the dashboard") — adding variants to an existing product via import is a
  deferred follow-up. Rows with no SKU create new products.
- **Price = 2 dp (rounded to sen); stock = whole number** — matches the dashboard
  editor; the parser rounds price and rejects non-integer stock.
- **Blank `weight_grams` = preserve on update.** A blank/omitted weight cell parses
  to `undefined` (not `0`), so on update the existing variant's weight is kept
  (`parcelWeightG ?? existing`); on insert it defaults to `0`. An explicit `0` is
  a real value. Exports always populate the column, so round-trips set it
  explicitly — only hand-blanked cells hit the preserve path.
- **Option values are matched case-insensitively** within a product (first casing
  wins for the axis). Two rows that differ only by case (`Cut=Fillet` /
  `Cut=fillet`) resolve to the **same** variant and are reported as a duplicate —
  never silently collapsed with one row's price/stock dropped.
- **Export = one row per *active* variant**, in the exact import column shape, so
  export → edit → re-import round-trips. Auto-filled inactive placeholders are
  omitted (re-auto-filled on import). *Limitation:* a manually-deactivated variant
  isn't exported (would need an `active` column on both sides — a follow-up).
- **Columns:** `product_handle, name, description, option1_name, option1_value,
  option2_name, option2_value, sku, price, stock, weight_grams`. Images are not
  imported (avoids a dual storage-id/URL model) — added per product in the editor.
- **Caps:** `MAX_BULK_IMPORT_BATCH = 50` now counts **variant rows** (the client
  chunks products to stay under it); `MAX_VARIANTS_PER_PRODUCT = 50`;
  `MAX_PRODUCTS_PER_RETAILER = 50` (beta).

**Files:** parser/grouping `src/lib/product-import.ts`; CSV `src/lib/csv.ts`; XLSX
`src/lib/xlsx.ts`; export `src/lib/product-export.ts`; UI
`src/routes/app.products.import.tsx`; backend `bulkUpsert`/`bulkUpsertPreview` in
`convex/products.ts`. Gated by `BULK_IO_ENABLED` in `src/lib/feature-flags.ts`.
**Deferred follow-ups:** image import (fetch-and-store), add-variant-to-existing
via import, full active-state round-trip.

The rest of this doc is the original pre-rework menu — kept for the richer-schema
ideas (column mapping UI, "clean up my sheet" AI, photo→product) not yet built.

## Current State (2026-04-20)

**Files:**
- UI: `src/routes/app.products.import.tsx`
- Parser: `src/lib/csv.ts`
- Backend: `convex/products.ts` (`bulkCreate` at line 188)

**What exists:**
- CSV-only, 4 columns: `name,description,price,stock`
- Client-side parse + per-row validation (Papaparse)
- Downloadable template, preview table, all-or-nothing import per chunk
- 100-row UI hint, 50-row Convex batch cap, 50-product beta cap per retailer
- No export, no update, no images in bulk, no AI assist

**Gaps:**
1. Outdoor-gear retailers have stock *with images* — CSV flow can't carry them
2. No way to **update** existing products in bulk (price/stock refreshes)
3. No export → no round-trip, no backup, no marketplace handoff
4. No Excel/XLSX — most small retailers use Excel or Google Sheets, not CSV
5. No AI — typing 50 descriptions is the real friction

---

## Feature Menu (ranked by retailer ROI)

### 1. AI Product Enrichment (highest leverage)
- **Generate descriptions** from just `name` — Convex action calling Claude Haiku 4.5 per row (or batched). Outdoor-gear-aware prompt ("emphasize weight, weatherproofing, use case").
- **Clean up my sheet** — paste messy CSV, AI normalizes: title-case names, strip " - RM120" from name column, infer missing `stock=0`, reconcile `price/harga` headers.
- **Photo → product** — upload a folder of images, Vision model extracts name + description + suggested price band. Match filename to row.
- **Translate toggle** — EN ↔ BM for storefront copy (paraglide i18n already wired).

### 2. Excel / XLSX / Google Sheets Support
- Add SheetJS (`xlsx`) — accept `.xlsx` and `.xls`, not just `.csv`.
- **Paste from spreadsheet** textarea — copy cells from Excel/Sheets, paste directly (TSV fallback parsing).
- Google Sheets URL import (public sheet → CSV export endpoint).

### 3. Bulk Export (missing entirely)
- Export active / all products to CSV + XLSX from `/app/products`.
- **Round-trip edit flow:** export → edit in Excel → re-upload as update (requires stable ID column — see #4).
- Marketplace-ready exports: Shopee template, TikTok Shop template (maps Kedaipal schema → their column names). Aligns with `docs/marketplace-integration.md`.

### 4. Bulk Update / Upsert (not just create)
- Add optional `id` or `sku` column. Present → update; absent → create.
- Partial column updates (sheet with just `id,stock` bumps inventory).
- Dry-run preview: "3 new, 12 price changes, 2 stock changes" before commit.

### 5. Richer CSV Schema
Fields retailers will ask for:
- `sku` — stable identifier, enables upserts and marketplace sync
- `category` / `tags` — filterable storefront
- `weight_grams`, `dimensions` — shipping calc (future)
- `image_urls` — pipe-separated; fetched + stored server-side via scheduled action
- `active` — publish/unpublish via sheet
- `variant_group` — size/color. **Variants have since shipped** ([`product-variants.md`](./product-variants.md)): products now own `productVariants` with per-variant price/stock/SKU. Bulk import currently creates **single-variant** products only and matches on the variant SKU; multi-variant CSV (one row per `optionValues` combination, grouped by `variant_group`/`sku`) is the dedicated bulk-import rework this feature blocks.

### 6. UX Polish
- **Column mapping UI** — if headers don't match, dropdown "your column `harga` → our field `price`". Kills the #1 onboarding support ticket.
- **Fix-in-place** — clickable error rows become editable inline (no re-upload loop).
- **Resumable imports** — persist parsed rows in localStorage so a refresh doesn't lose work.
- **Duplicate detection** — warn if `name` already exists; offer skip / overwrite / append-suffix.
- **Real progress bar** on mobile (text is fine, bar is nicer).
- Fix the "max 100 rows per import" hint — Convex cap is 50/batch, but client already chunks, so the copy is misleading.

### 7. Image Handling in Bulk
- Drop a **ZIP** with images + a CSV; filename in CSV matches files in ZIP.
- Or: CSV with public `image_urls` → Convex scheduled action downloads and stores.
- Background removal / auto-resize via Convex action + fal.ai or Cloudflare Images.

### 8. Templates by Vertical
Pre-filled CSV templates for outdoor gear (tents, backpacks, headlamps) with realistic examples — shortens time-to-first-product.

---

## AI Product Enrichment — How It Works

Expanded mechanics for Feature #1 so it's implementation-ready when its sprint comes up.

### 1a. Generate descriptions from `name`

**Retailer flow:**
- Upload CSV with `name,price,stock` (description blank)
- Preview table shows empty `description` column + "✨ Generate descriptions" button
- One click fills each row; inline-editable before final import

**Implementation:**
- New Convex **action** in `convex/ai.ts` (actions can call external APIs; mutations cannot)
- Signature: `{ names: string[], vertical: "outdoor" } → string[]`
- Single batched call to Claude Haiku 4.5 via `@anthropic-ai/sdk`
- Outdoor-gear-aware prompt: "emphasize weight, weatherproofing, use case, 2 short sentences, no marketing fluff"
- Cost: Haiku ≈ $0.25/1M input tokens → 50 products < $0.001 per import

### 1b. Clean up my sheet

**Retailer flow:**
- Retailer uploads a messy existing Excel export (headers in BM, prices with "RM" prefix, stock with " pcs" suffix)
- Click "AI clean up" → diff preview → accept/reject per column

**Implementation:**
- Action receives only **first 5 rows** + target schema (keeps cost + privacy in check)
- Claude returns a **transform JSON**: `{ "Nama Produk": { field: "name", transform: "strip_price_suffix" }, ... }`
- Client applies transforms locally against the full dataset — AI designs the transform, never sees full data

### 1c. Photo → product

**Retailer flow:**
- Drop folder of product photos
- AI returns `{ suggested_name, description, price_band, category }` per image
- Retailer reviews grid, tweaks, hits "Create all"

**Implementation:**
- Upload images to Convex storage → get URLs
- Convex action calls Claude Sonnet 4.6 (vision) with image URL per product
- Batched in parallel via `Promise.all` with concurrency cap (5–10)
- Result seeds same `parsed` state as CSV flow → reuses preview UI + `bulkCreate`

### 1d. Translate EN ↔ BM

**Retailer flow:**
- Toggle on preview: "Generate Bahasa Melayu version"
- Each product gets `name.en` + `name.ms`

**Implementation:**
- Requires **breaking schema change**: `name: string` → `{ en: string; ms?: string }` (migration needed)
- Storefront picks locale from paraglide runtime (`src/paraglide/runtime.js` already wired)
- One batched Claude call per import — cheap

### Shared AI Infrastructure

All AI features share these:

1. **`ANTHROPIC_API_KEY`** in Convex env — `npx convex env set ANTHROPIC_API_KEY sk-ant-...`
2. **Per-retailer rate limit** — new bucket `aiEnrichment` in `convex/lib/rateLimiter.ts`, e.g. 10 calls/hour
3. **Usage tracking table** — log tokens + cost per retailer (for future billing/caps)
4. **Actions, not mutations** — AI calls must be Convex actions; actions call `bulkCreate` mutation internally after AI fills rows
5. **Graceful fallback** — if AI fails, row stays with empty description + retry button; never blocks import
6. **Non-determinism rule** — AI output **must** route through the preview table with inline edit. Never write AI output directly to DB. Retailer stays in control.

---

## Priority Matrix

Scored on retailer ROI × effort × dependencies. Legend: 🟢 High / 🟡 Medium · S (≤1d) / M (1–2d) / L (3d+) · XS = pure content.

| # | Feature | ROI | Effort | Dep. | Why this slot |
|---|---------|-----|--------|------|---------------|
| 1 | **Bulk Export (CSV + XLSX)** | 🟡 Medium | 🟢 S (0.5d) | None | Unblocks round-trip, backup, marketplace. Smallest change; ships alone. |
| 2 | **XLSX Import + Paste-from-Sheet** | 🟢 High | 🟢 S (1d) | None | Kills #1 onboarding blocker ("how do I save as CSV?"). Pure client-side. |
| 3 | **`sku` Column + Upsert Logic** | 🟢 High | 🟡 M (2d) | #1 | Transforms import from one-shot → weekly inventory ops. Needs export to round-trip. |
| 4 | **AI: Generate Descriptions** | 🟢🟢 Very High | 🟡 M (2d) | None | Biggest perceived value. Needs `ANTHROPIC_API_KEY` + rate limiter. |
| 5 | **Column Mapping UI** | 🟢 High | 🟡 M (2d) | #2 | Removes last onboarding friction. Handles BM/EN header mismatches. |
| 6 | **AI: Clean Up My Sheet** | 🟢 High | 🟡 M (1.5d) | #4, #5 | Reuses #4 infra + #5 mapping engine. Almost free once both exist. |
| 7 | **Richer Schema (category, tags, active, weight)** | 🟡 Medium | 🟡 M (2d) | #3 | Needs SKU stability first so existing data migrates cleanly. |
| 8 | **Image URLs in CSV** | 🟢 High | 🟠 L (3d) | #7 | Scheduled action for download + storage. High value but heavier. |
| 9 | **AI: Photo → Product** | 🟢🟢 Very High | 🟠 L (3d) | #8 | Vision model + storage pipeline. Wow-factor demo. |
| 10 | **ZIP Bundle Upload** | 🟡 Medium | 🟠 L (3d) | #8 | Alternative to #8 for offline-first retailers. |
| 11 | **Marketplace Export Templates** | 🟡 Medium | 🟡 M (2d each) | #1, #7 | Only once marketplace connectors start landing (`docs/marketplace-integration.md`). |
| 12 | **UX Polish (duplicates, resumable, progress bar)** | 🟡 Medium | 🟢 S (1d) | — | Backlog — slot between bigger features when context-switching. |
| 13 | **AI: Translate EN↔BM** | 🟡 Medium | 🟠 L (3d) | Schema migration | Requires breaking `name` schema change. Do last. |
| 14 | **Vertical Templates (outdoor gear samples)** | 🟢 High | 🟢 XS (0.5d) | — | Pure content, no code. Ship anytime during polish. |

---

## Execution Order

### Sprint 1 — "Round-trip foundation" (3–4 days)
1. Bulk Export (CSV + XLSX) → #1
2. XLSX Import + Paste-from-Sheet → #2
3. `sku` + Upsert → #3
4. Vertical Templates → #14 *(during review cycles)*

**Outcome:** Export → edit → re-upload round-trip works. Inventory refresh becomes a real weekly workflow.

### Sprint 2 — "AI that pays for itself" (3–4 days)
5. AI: Generate Descriptions → #4
6. Column Mapping UI → #5
7. AI: Clean Up My Sheet → #6

**Outcome:** Retailer pastes their existing Excel, clicks two buttons, done. Marketable demo.

### Sprint 3 — "Images & richer data" (5–7 days)
8. Richer Schema → #7
9. Image URLs in CSV → #8
10. AI: Photo → Product → #9

**Outcome:** Full catalog from photos alone. Major wow factor.

### Backlog — do when relevant
- #10 ZIP Bundle — only if feedback demands offline-first
- #11 Marketplace Templates — pair with marketplace connector work
- #12 UX Polish — slot between sprints
- #13 Translate EN↔BM — only after confirming multilingual storefront demand

---

## Quick-Win (2-day budget)

If only 2 days available this week: ship **#1 (Export) + #14 (Vertical Templates)**. Tiny code surface, retailers immediately get backup + better onboarding, and every downstream feature unlocks.

---

## Constraints to Remember

- **Mobile-first** — most retailers will import from their phone; drop-zone and preview table must survive narrow viewports.
- **Multi-tenant from day one** — every feature must respect `retailerId` ownership checks already in `convex/products.ts`.
- **Beta caps** — `MAX_PRODUCTS_PER_RETAILER = 50` and `MAX_BULK_IMPORT_BATCH = 50` in `convex/products.ts` will need to lift before this roadmap is worth fully executing.
- **Channel field** — bulk-created rows currently hardcode `channel: "whatsapp"`. Leave room for marketplace channels as that schema evolves.
