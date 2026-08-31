# Dark mode

ClickUp [`z8r3fdadub`](https://app.clickup.com/t/z8r3fdadub). Ships the seller app and the buyer storefront in a dark theme, with the choice remembered per device.

The palette was not invented for this ticket. `src/styles.css` has carried a complete `.dark` token block since the shadcn base layer went in, [`design-system.md`](./design-system.md) has required both-mode correctness the whole time, and 299 `dark:` variants were already written across the dashboard. All of it was dead code: nothing ever put the `dark` class on the DOM. This ticket is the switch, plus the gaps that only became visible once the switch existed.

## What a user sees

**Sellers** — Settings → **App → Appearance**: Light, Dark, or Match device, each with a preview swatch. Default is Match device.

**Buyers** — a sun/moon button low on **every** buyer page: the storefront family (in the footer, beside the powered-by badge), `/track`, and the open `/claim` checkout. Two states, not three: the page already matched their phone on arrival, so the only thing worth offering is "actually, the other one". Deliberately below the fold — a theme switch must never compete with the buy button.

It has to be on all of them, not just the storefront. A buyer who ordered over WhatsApp may never see a storefront at all: they get a tracking link and nothing else, so `/track` is their only chance to override what their phone picked. And keeping the slot consistent (bottom utility row, next to the privacy link or the powered-by badge) means someone who finds it once finds it everywhere. `theme-routes.test.ts` fails if a buyer route ships without one.

The expired / already-claimed / not-found screens are the deliberate exception: they are dead ends a buyer reads and leaves, and a theme control there is chrome on a page nobody dwells on.

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

## Scope: where dark mode applies

`isThemedRouteId` decides, keyed on matched **route ids** (not pathnames) so the router's own precedence settles `/pricing` vs `/$slug` — the same reason [`buyer-routes.ts`](../src/lib/buyer-routes.ts) does. The shell emits the pre-paint script only on themed routes and actively strips the class everywhere else.

| Surface | Themed? |
| --- | --- |
| Seller app (`/app/*`) | Yes |
| Storefront (`/$slug`, product, category, checkout) | Yes |
| Order tracking (`/track/$token`), claim links (`/claim/$token`) | Yes, with their own toggle |
| Marketing site (`/`, `/pricing`, `/cost`, legal) | **No** |
| Sign-in / sign-up / onboarding | **No** |
| Store poster, QR codes (preview and exported PNG) | **No** — theme-immune by construction, and a QR on a dark ground does not scan |

The marketing site is out of scope by decision, not oversight: it is a designed brand surface with hardcoded mesh backgrounds (`bg-hero-mesh` is literally `hsl(0 0% 100%)`) and a `bg-primary` footer whose token flips hue to mint in dark. Doing it properly is its own ticket. `theme-routes.test.ts` pins all of the above.

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
- Not worth a diff today? [`dark-mode-coverage-budget.ts`](../src/lib/dark-mode-coverage-budget.ts) records the remaining count per file. Counts are asserted **exactly**, so fixing a colour fails the test until you lower the number — that is the ratchet, and it only turns one way. Regenerate with:

```bash
KP_WRITE_DARK_BUDGET=1 pnpm vitest run src/lib/dark-mode-coverage.test.ts
```

## Known gaps

- The marketing site, sign-in and onboarding stay light (above).
- `theme-color` meta and `site.webmanifest` stay pinned to `#0F172A`. It is a dark navy that reads correctly against both themes; splitting it per theme is churn for a 2%-lightness seam in the browser chrome.
- The `/claim` dead-end screens (expired, already claimed, not found) carry no toggle — see the reasoning above. If a buyer ever needs one there, the same three lines drop in.
