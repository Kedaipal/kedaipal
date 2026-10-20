# Dark mode

ClickUp [`z8r3fdadub`](https://app.clickup.com/t/z8r3fdadub). Ships the seller app and the buyer storefront in a dark theme, with the choice remembered per device.

The palette was not invented for this ticket. `src/styles.css` has carried a complete `.dark` token block since the shadcn base layer went in, [`design-system.md`](./design-system.md) has required both-mode correctness the whole time, and 299 `dark:` variants were already written across the dashboard. All of it was dead code: nothing ever put the `dark` class on the DOM. This ticket is the switch, plus the gaps that only became visible once the switch existed.

## What a user sees

**Sellers** — Settings → **App → Appearance**: Light, Dark, or Match device, each with a preview swatch. Default is Match device.

**Buyers** — a quiet "Dark mode" / "Light mode" row low on **every** buyer page, in the footer above the powered-by badge and in the same language as "Discover more stores" (a bordered icon disc beside the badge was tried and read as clutter — Zaki, 21 Oct 2026): the storefront family, `/track`, and the open `/claim` checkout. Two states, not three: the page already matched their phone on arrival, so the only thing worth offering is "actually, the other one". Deliberately below the fold — a theme switch must never compete with the buy button.

It has to be on all of them, not just the storefront. A buyer who ordered over WhatsApp may never see a storefront at all: they get a tracking link and nothing else, so `/track` is their only chance to override what their phone picked. And keeping the slot consistent (bottom utility row, next to the privacy link or the powered-by badge) means someone who finds it once finds it everywhere. `theme-routes.test.ts` fails if a buyer route ships without one.

The expired / already-claimed / not-found screens are the deliberate exception: they are dead ends a buyer reads and leaves, and a theme control there is chrome on a page nobody dwells on.

**Sellers, in passing** — the same sun/moon rides the dashboard's mobile header (beside the account button) and the sidebar's foot (icon in the collapsed rail, with its verb when expanded). It writes the same preference the Appearance screen does; the two can never disagree, because `lib/theme.ts` is the one store both read. Appearance stays the home of "match device".

**Everyone else** — the marketing nav (beside the language switcher), the legal pages' header, and `/stores` (beside the region switch, in both the hero and the scrolled header). `theme-routes.test.ts` fails if a route ships with none of these and is not classified as a widget/redirect page that inherits.

Both write the same key, because they are the same browser on the same device. The Appearance screen says so in as many words ("Applies to this device only"), along with the fact that a seller's choice does not reach their buyers.

## How it works

| Piece | File |
| --- | --- |
| Store, resolution, persistence, pre-paint script | [`src/lib/theme.ts`](../src/lib/theme.ts) |
| React bindings (`useTheme`, `useThemeScope`) | [`src/hooks/useTheme.ts`](../src/hooks/useTheme.ts) |
| Seller UI | [`src/components/settings/appearance-tab.tsx`](../src/components/settings/appearance-tab.tsx) |
| Buyer UI | [`src/components/ui/theme-toggle.tsx`](../src/components/ui/theme-toggle.tsx) |
| Status/notice colours | [`src/lib/tone.ts`](../src/lib/tone.ts) |
| The gate | [`src/lib/dark-mode-coverage.test.ts`](../src/lib/dark-mode-coverage.test.ts) |

`localStorage["kedaipal:theme"]` holds `light | dark | system`. A module-level store publishes it through `useSyncExternalStore`, which also mirrors changes across browser tabs via the `storage` event and follows the OS live while the preference is `system`.

### Why localStorage and not Convex

It is a per-**device** preference, not a per-**account** one: a seller on a bright phone at the counter and a laptop in bed at night wants different answers, and syncing would fight that. Buyers have no account at all. It joins the existing `kedaipal:` client-preference family (`kedaipal:cart:*`, `kedaipal:src:*`, `kedaipal:lastAddress*`).

### Why not a cookie, given buyer routes SSR

Because the **default is `system`, and the server cannot resolve it.** `prefers-color-scheme` never reaches the server — no client hints are enabled and no SSR code reads request headers — so a cookie holding `"system"` leaves the server exactly as blind as it is now, and we would ship both mechanisms while still needing the script for the majority case. The one cookie-backed preference we do have, Paraglide's locale, pays for server resolution with a full page **reload** on change; fine for a language switch, unacceptable for a theme toggle.

*(Not an edge-caching argument. Nothing in this app caches SSR HTML today — no `_headers`, no cache rules, no `Vary`. If you find that reasoning in a review comment, it is wrong.)*

### The flash

`THEME_INIT_SCRIPT` runs synchronously in `<head>`, before the browser paints, reading storage and stamping `class="dark"` plus `style="color-scheme: dark"` on `<html>`. Without it every dark-mode visitor gets a white flash while React hydrates. `color-scheme` is not decoration — it is what makes native scrollbars, form controls and autofill paint dark, which CSS variables cannot reach.

It is a hand-written ES5 copy of `readStoredPreference` + `resolveTheme` + `applyResolvedTheme`, because it has to run before any bundle loads. A truth table in `theme.dom.test.ts` runs the real script text against the real module for all ten preference × OS combinations, so the copy cannot drift.

Two decisions worth knowing:

- **A raw `<script>` in the shell, not `head({ scripts })`.** TanStack's supported head-scripts API re-appends and re-runs the script after hydration, which is wrong for a one-shot. The raw tag in `RootDocument` has no such effect, and `suppressHydrationWarning` was already on `<html>` — it covers extra attributes, which is exactly what the script adds.
- **`useThemeScope` re-applies on every commit, in a layout effect.** Belt and braces for the case the script cannot cover: when hydration fails and React re-renders the root, it strips *every* attribute off `<html>`, class included, and a dark-mode seller would sit on a white page until they reloaded. The DOM write is idempotent, so this is free on the happy path.

### Inverted surfaces — the softened recipe

In light mode a handful of surfaces invert against the page: `bg-foreground text-background` on the sales hero, the welcome card, a promotion's header, the settings identity card, the primary action buttons, selected chips. Left alone, every one of them flips to a **near-white slab on a dark page**, which reads as a hole punched in the screen. Zaki's call (29 Aug 2026): soften, don't flip. Two recipes, chosen by what the surface IS:

| Surface | Light (unchanged) | Dark |
| --- | --- | --- |
| **CTA button, selected chip, rank badge** — something you tap or that marks a choice | `bg-foreground text-background` → written as `bg-primary text-background` (byte-identical fill: `--primary` IS navy in light) | `dark:text-primary-foreground` — mint fill, navy text, the same as every other primary control |
| **Emphasis panel** — a slab that carries content (hero, welcome card, identity card, promotion header) | unchanged | `dark:border dark:border-accent/30 dark:bg-accent/12 dark:text-foreground`, and every `text-background/NN` inside gets a `dark:text-foreground/NN` twin. Mint inside stays mint — it reads on the tinted panel as it did on navy |
| **Avatar tile** | unchanged | `dark:bg-accent/15 dark:text-accent-emphasis` — the icon-tile pattern the app already uses |

`text-background`, not `text-primary-foreground`, on the buttons: the two are not the same colour in light (`#fff` vs `hsl(210 40% 98%)`), and the rule is that adopting the recipe never repaints the theme every current user is in. The one sanctioned exception is `order-bulk-bar.tsx`: a transient floating toolbar is *supposed* to invert, and says so in its file.

Progress-bar fills and dots that use `bg-foreground` as a neutral ink (`customers-card`, `sources-card`) are left alone: a near-white bar on a dark card is a legible neutral, not a slab.

### Navy, never black

Black is not a Kedaipal colour. Arif named it first for the pill toggles (19 Oct 2026 — "use our navy blue, not black") and Zaki for the storefront badges and the countdown (20 Oct): `--primary` at 11% lightness reads **black** at badge size, so a `bg-primary` sale badge, a `bg-primary/90` sale strip and an 11% receipt-paper countdown all looked like black stickers on the product. The dark ink is **`--segment`**: the same navy hue a step lighter — 22% in light, 34% in dark — as `bg-segment text-segment-foreground`. Buttons stay `bg-primary`; the countdown's paper and cut moved up the same step. The coverage gate now **fails on any solid black-family surface** (`bg-black`, `bg-slate-900`…); a translucent scrim is fine, and the one legitimate black object — a phone bezel inside a product mockup — lives in exempt files.

## Scope: where dark mode applies

`isThemedRouteId` decides, keyed on matched **route ids** (not pathnames) so the router's own precedence settles `/pricing` vs `/$slug` — the same reason [`buyer-routes.ts`](../src/lib/buyer-routes.ts) does. The shell emits the pre-paint script only on themed routes and actively strips the class everywhere else.

| Surface | Themed? |
| --- | --- |
| Seller app (`/app/*`) | Yes |
| Storefront (`/$slug`, product, category, checkout) | Yes |
| Order tracking (`/track/$token`), claim links (`/claim/$token`) | Yes, with their own toggle |
| Marketing site (`/`, `/pricing`, `/cost`), legal pages | Yes — toggle in the nav / legal header |
| Sign-in / sign-up / onboarding | Yes — Clerk's widgets take the theme through `clerkAppearance` (no control of their own; they inherit) |
| Marketplace directory (`/stores`) | Yes — toggle beside the region switch, in the hero and the compact header |
| Team invites (`/join/$token`), referral landing (`/referral/$slug`) | Yes — inherit; one-tap pages with no chrome of their own |
| Store poster, QR codes (preview and exported PNG) | **No** — theme-immune by construction, and a QR on a dark ground does not scan |

The first cut (Aug 2026) themed only the app and the storefront and left the marketing site light, on the grounds that it was a designed brand surface with hardcoded mesh backgrounds and a `bg-primary` footer whose token flips hue to mint. That scope stopped at a seam every buyer footer linked straight across — "Discover more stores" landed a dark-mode buyer on a white directory — so on 20 Oct 2026 Zaki widened it to everything this repo renders. The blog is the only exception, and only because it is a separate repo. What that took: a `.dark` half for `bg-hero-mesh` in CSS, the landing footer and the seller-flow stage swapped to the card surface in dark (where `bg-primary` would have gone mint), the marquee onto the emphasis-panel recipe, Clerk handed our dark values on the one `<ClerkProvider>`, and the three acted-out product mockups exempted from the colour gate as what they are — pictures of the app on a phone, bezel and all.

## The buyer's brand surfaces

Turning the storefront dark broke Kedaipal's own marks, which is easy to miss because it is our branding rather than the seller's:

- **The header wordmark** was picked by cover image only (`/logo-3.svg` navy, or `/logo-dark.svg` when a cover photo sits behind it). On a dark storefront the navy wordmark hit **1.09:1** — the word "kedaipal" vanished, leaving a floating mint blob. Now both assets render and CSS picks one (`dark:hidden` / `hidden dark:block`), **not** a `useTheme()` src swap: buyer routes SSR, so a hook-driven `src` would serve the light asset from the server and only correct after hydration, whereas the class is already there pre-paint.
- **The footer lockup** had no light-ink variant at all, so `public/poster/kedaipal-lockup-dark.svg` was added (same file, `#0F172A` → `#F8FAFC`; the mint emblem is untouched, which is why `dark:invert` was not an option — it would turn the mint magenta).
- **The seller's own logo** sits on the one storefront image using `object-contain`, so its mat is visible. It is now `bg-white` in both themes: seller logos are routinely dark ink on transparency and would vanish into a dark mat.

**Product photos need no treatment.** They render `object-cover`, filling the box edge to edge, so there is no mat to glow — and the app already shows product photos against near-black in *light* mode via the lightbox overlay. Do not add brightness or dimming filters: they misrepresent the seller's product.

## Keeping it correct

`src/lib/dark-mode-coverage.test.ts` scans every themed `.tsx` and fails when a raw palette colour has no `dark:` counterpart on the same element. It answers the question every new component raises — no, you do not have to remember.

- Deliberate one-off? `dark-ok` in a comment on or just above the line, **with the reason**.
- Whole file legitimately invariant? `EXEMPT_FILES` in the test, also with the reason.
- **New component directory?** It must appear in `THEMED_COMPONENT_DIRS`, `UNTHEMED_COMPONENT_DIRS` (with the reason) or `EXEMPT_DIRS`, or the suite fails. This guard exists because the themed list went quietly stale between August and October: `home/`, `promotions/`, `vouchers/`, `counter/` and six more shipped without ever being scanned, and the gate reported "clean" the whole time. A list that states a completeness it does not check is worse than no list.
- Not worth a diff today? [`dark-mode-coverage-budget.ts`](../src/lib/dark-mode-coverage-budget.ts) records the remaining count per file. Counts are asserted **exactly**, so fixing a colour fails the test until you lower the number — that is the ratchet, and it only turns one way. Regenerate with:

```bash
KP_WRITE_DARK_BUDGET=1 pnpm vitest run src/lib/dark-mode-coverage.test.ts
```

## Known gaps

- The marketing site, sign-in and onboarding stay light (above).
- `theme-color` meta and `site.webmanifest` stay pinned to `#0F172A`. It is a dark navy that reads correctly against both themes; splitting it per theme is churn for a 2%-lightness seam in the browser chrome.
- The `/claim` dead-end screens (expired, already claimed, not found) carry no toggle — see the reasoning above. If a buyer ever needs one there, the same three lines drop in.
