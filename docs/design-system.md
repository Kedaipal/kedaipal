# Design System — Kedaipal

The shared visual language for the dashboard, storefront, and landing. Read this before building or changing UI so we stay consistent instead of re-deriving the system every session. **Mobile-first is a hard requirement** (see [`CLAUDE.md`](../CLAUDE.md) → Architectural Constraints).

Source of truth for tokens: [`src/styles.css`](../src/styles.css). Primitives: [`src/components/ui/`](../src/components/ui/).

## Stack
- **Tailwind v4** (CSS-first `@theme`, no `tailwind.config.js`) + **shadcn** base layer + **radix-ui** for behaviour.
- **Fonts:** `Geist Variable` (body, `--font-sans`), `Red Hat Display Variable` (headings, `--font-heading`). Use the `font-heading` utility on display text; headings `h1–h6` already get it via base CSS.
- **Icons:** `lucide-react` only. Default icon size in buttons is `size-4` (auto-applied) — don't hardcode unless deviating.
- **Animation:** `framer-motion` is available; always gate motion behind `prefers-reduced-motion` (see the marquee example in `styles.css`).
- Class merging: **always** `cn()` from [`#/lib/utils`](../src/lib/utils.ts). Polymorphism: radix `Slot` via the `asChild` prop (Button supports it).

## Color tokens (semantic, never raw hex)
Defined as HSL CSS vars in `:root` + `.dark` and exposed as Tailwind colors (`bg-*`, `text-*`, `border-*`). **Use the semantic token, never a literal color** (`bg-accent`, not `bg-emerald-500`). Palette = **midnight navy** (primary) + **mint** (accent).

| Token | Role |
| --- | --- |
| `background` / `foreground` | page base |
| `card` / `popover` | raised surfaces |
| `primary` | navy — primary emphasis, dark surfaces |
| `accent` | **mint — the brand action color** (primary buttons default to this) |
| `secondary` | soft slate — low-emphasis fills |
| `muted` / `muted-foreground` | subtle bg / secondary text |
| `destructive` | errors, delete |
| `border` / `input` / `ring` | hairlines, field borders, focus ring (ring = mint) |
| `sidebar-*` | dashboard chrome |

Dark mode: `.dark` class on an ancestor; **mint becomes `primary`**. Every new surface must read correctly in both — use tokens and it's automatic.

## Radius & spacing
- Radius scales off `--radius: 0.75rem`: `rounded-sm/md/lg/xl/2xl…`. Cards/dialogs use `rounded-xl`; buttons `rounded-lg`; pills `rounded-full`.
- Spacing: Tailwind default scale. Forms breathe (`gap-2`–`gap-4`); toolbars are compact.

## Desktop density — three traps (2026-08-31)

Mobile-first is the rule, but "desktop" is not one size, and the seller's
booking calendar shipped too tall for the most common laptop before these were
understood. All three cost a round trip:

1. **A 13" laptop is `xl`, not `lg`.** 1280–1440px logical width lands in `xl`
   (≥1280). Tuning density at `lg:` and stopping there does nothing for the
   machine you were trying to help — it only affects the 1024–1279 band, which
   almost nobody is on. Verify which breakpoint your target screen is in before
   writing the class.
2. **`min-h-*` is a floor, not a size.** A card that grows to fit its content
   ignores the minimum entirely; shrinking the box means shrinking the CONTENT
   (font sizes, avatar sizes, gaps, padding). Measure the real element and
   subtract the parts rather than assuming the minimum won.
3. **A flex item needs `min-w-0` to shrink at all.** Its default
   `min-width: auto` refuses to go below the content's min-content width, so a
   wide child — a data table, a long unbroken string — pushes the *whole* row
   past the viewport instead of scrolling inside its own box. The dashboard
   shell's main column lacked it, so switching on two orders-table columns at
   1281px made the page scroll sideways and pushed the toolbar's right-hand
   controls off screen (z8r3fdff97 test round; `src/routes/app.tsx`, pinned by
   `src/routes/app-shell-layout.test.ts`). Put `min-w-0` on every flex item
   whose content can outgrow it, and let an inner `overflow-x-auto` scroll.
4. **A CSS grid row stretches every cell to its tallest sibling.** One cell with
   an extra line makes the whole row taller, so a rare state can cost height on
   every screen. Prefer a FIXED number of content lines (drop one item to make
   room for the "+N more") over a variable one — the height becomes
   deterministic and the layout stops depending on the data.

**Never wrap a token in `hsl()`.** Our tokens are already complete colour
functions (`--muted: hsl(210 40% 96%)`), so the shadcn-idiomatic
`hsl(var(--muted))` expands to `hsl(hsl(...))` — invalid, which drops the WHOLE
declaration. In an arbitrary value that means the entire gradient computes to
`background-image: none`. Write `var(--muted)`. A blocked-day hatch shipped
broken this way for weeks because a flat fill sat beside it and hid the loss.

## Mobile-first rules (non-negotiable)
1. **≥44px tap targets** for anything interactive. ⚠️ **`Button`'s own sizes top out at `h-9` = 36px** — even `size="lg"` and `size="icon"` do **not** clear 44px. For any primary *touch* target, add the **`tap-target`** utility (or `min-h-11`) to the button, or use the Input `field` variant for fields. (Mouse-only desktop controls may stay compact — 44px is a touch rule.) Icon-only buttons should use `size="icon"` + `tap-target`, not a text size like `lg`.
2. **Single-column by default**, widen at `sm:`/`lg:`. Never design desktop-first and shrink.
3. **Safe areas:** bottom-anchored bars use `pb-[max(0.75rem,env(safe-area-inset-bottom))]` (or the `safe-bottom` utility). See [`bottom-nav.tsx`](../src/components/dashboard/bottom-nav.tsx).
4. **Bottom-anchored primary action** on long flows (border + `bg-background`), not a button lost at the bottom of a scroll. **`fixed inset-x-0 bottom-0`** — every action bar in the app does this ([`cart-bar.tsx`](../src/components/storefront/cart-bar.tsx), the product page's purchase bar, [`checkout-form.tsx`](../src/components/storefront/checkout-form.tsx), the cost calculator, the orders bulk bar). Out of flow means the page's own footer renders as ordinary content **above** the floating bar, so every page stacks the same way — a `sticky` bar sits IN flow and shoves the footer below it, which reads as welded and inconsistent with its sibling pages.
   - A fixed bar is out of flow, so **the page must reserve its height**: measure it with [`usePublishedHeight`](../src/hooks/usePublishedHeight.ts) and pad with `pb-[var(--storefront-bar-h,…)]` rather than hardcoding a guess that rots as the bar's content wraps. A `display:none` bar measures `0px` and `var(…, fallback)` only fires when the property is *unset*, so pair it with a breakpoint override (`lg:pb-10`).
   - `sticky bottom-0` is for a bar that's the **last element in its own scroll container with nothing after it** — the dashboard [`bottom-nav.tsx`](../src/components/dashboard/bottom-nav.tsx), which has no footer to stack against.
5. Bottom nav / desktop sidebar swap at `lg` (`lg:hidden` / `hidden lg:flex`).

## Primitives — reach for these first
Don't hand-roll what exists. From [`src/components/ui/`](../src/components/ui/):

| Need | Use | Notes |
| --- | --- | --- |
| Button | `Button` | variants: `default`(mint)/`outline`/`secondary`/`ghost`/`destructive`/`link`; sizes incl. `icon*`. `isLoading` shows a spinner; `asChild` to wrap a `Link`. |
| Text input | `Input` | `variant="field"` = **mobile form field (≥44px)**; `default` = compact toolbar; `bare` = child of a composite. `isError` sets `aria-invalid`. |
| Form row | `Field` + `FieldLabel` / `FieldContent` / `FieldDescription` / `FieldError` | **always** compose forms with these — don't hand-write label+input+error. `FieldError` takes an `errors` array (TanStack Form shape). |
| Textarea | `Textarea` | |
| Phone — seller / platform | `MyPhoneInput` (plain state) / `TextField prefix={<MyPhonePrefix />}` (form-bound) | a **fixed** plate for the store's country — the store's own numbers. See below. |
| Phone — buyer | `BuyerPhoneInput` (plain state) / `TextField prefix={<BuyerPhonePrefix />}` (form-bound) | the same plate **with a country picker** — every number a buyer gives. See below. |
| Composite control | `InputPrefixFrame` | one border owning a plate + a `bare` input (the `+60` plate, the buyer picker, an "RM"). |
| Modal | `Dialog*` | `DialogFooter` is full-bleed + reverses on mobile. Confirm-only flows → `ConfirmDialog` — **never `window.confirm`/`alert`**: a native dialog is unstyled, theme-blind, and BLOCKS the renderer until it is dismissed (the product wizard's discard froze the page for as long as it stood, found in the z8r3fdff97 test round). **`DialogContent` caps itself at `calc(100dvh-2rem)` and scrolls** — put long content straight in, no hand-rolled `max-h`; see below. |
| Popover / menu | `Popover`, `DropdownMenu*` (radix) | `DropdownMenu` = a keyboard-navigable action menu (trigger → items). Use to group related actions behind one control instead of a row of competing buttons (e.g. the counter-checkout header's "New order"). Open a `Dialog` from an item via controlled state in `onSelect` — the menu→dialog focus handoff is clean. |
| Copy-to-clipboard | `CopyButton` | one-tap copy w/ feedback (order IDs, bank details). |
| Reorderable list | `SortableList` | **the** sorting standard (@dnd-kit, mobile-safe). **Never** arrow-button reordering. |
| Loading state | `Skeleton` | prefer skeletons over spinners for content. |
| Rich text | `Markdown` | product descriptions etc. |
| Image | `AppImage` | **every** raw `<img>` of a Convex-hosted/user-uploaded photo — see below. |
| Zoomable image | `ZoomableImage` | product/mockup imagery; wraps `AppImage` internally, so it gets the same loading/error handling for free. |

If a primitive is missing, **add it to `src/components/ui/`** — don't inline a one-off in a route.

### Images always render via `AppImage` (2026-07-24)
`src/components/ui/app-image.tsx` — skeleton placeholder while loading → fade-in on load → a labelled fallback (muted box + icon + the alt text) on a dead URL or unset `src`, instead of a blank box. A failed load is **retried twice with jittered backoff before that fallback is shown** (2026-08-21, ClickUp `86eypxgff` — see below). Two sizing modes: **`fill` (default)** — `aspect` is the wrapper's box, the image crops to fill it (`objectFit="cover"|"contain"`); use for photo thumbnails, avatars, banners. **`fill={false}`** — `aspect` becomes the image's OWN intrinsic-ratio classes (e.g. `"h-8 w-auto"`) instead of a box to stretch into; use for fixed-height, auto-width brand-mark SVGs (forcing those through `w-full` inside an auto-width wrapper is the classic "percentage width in an indefinite container" CSS trap). `priority` (LCP candidates — storefront cover, first product-grid row) skips the lazy-loading hint. Local upload previews (`blob:`/`data:` URLs) auto-skip the skeleton (already instant). **Exceptions:** `store-poster.tsx` (print/PDF-export surface — a lazy or opacity-0 image can print blank; has its own `new Image()` onload/onerror gating) and `landing/responsive-image.tsx` (a build-time `<picture>`/srcset wrapper for static optimized assets — a different concern from `AppImage`'s runtime Convex-hosted URLs).

#### A failed load retries before it gives up (2026-08-21, ClickUp `86eypxgff`)
Buyers were intermittently seeing the broken-image fallback on a live storefront. The images were fine — they were just **big**: 38 MB of product photos on one store home, individual files up to 4.4 MB, served straight from Convex storage with `Cache-Control: private` (so no CDN, no shared cache) at 300 ms–2.6 s per file. Under that weight the browser queues dozens of multi-MB requests against one host and some die. `AppImage`'s error state was terminal by design, so **one dead request meant a permanently broken box for that page view** — and because a cached image loads instantly forever, the same page looked fine on the next visit. That is what made it read as random.

The policy now:

- **Bounded** — `MAX_LOAD_RETRIES = 2` (three attempts total), then the error state is terminal for good. The original rule existed so a genuinely dead storage URL could never become a request loop hammering storage; that still holds.
- **Jittered** — delay is `700ms * 3^attempt * (0.5 + random)`. The jitter is load-bearing, not a nicety: these failures are congestion-driven, so retrying every failed image on the same timer rebuilds the exact pile-up that broke them.
- **Retries keep the skeleton up** — flipping to the broken box and back would read as a glitch on a photo that is simply still arriving.
- **Same URL, remounted** — the retry bumps a key so a fresh `<img>` issues a fresh request. No cache-busting param: a failed load leaves no cache entry to bust, and a unique URL would re-download the full bytes *and* poison the 30-day cache with a duplicate entry.
- **Local previews are exempt** — a `blob:` URL fails because it was revoked, and no number of retries brings a revoked object URL back.
- A new `src` gets a fresh budget and drops any retry still queued for the old one; unmounting disarms a pending retry.

**No tap-to-retry affordance, deliberately.** `AppImage` is nested inside a `<button>` at real call sites (the product-page thumbnail strip, `category-edit-dialog`), so putting a button in the fallback would emit invalid nested-interactive HTML app-wide. Offering one needs those call sites made safe first.

**No load timeout, deliberately.** These images genuinely take 10–25 s on a mobile connection; aborting a slow-but-progressing download would break loads that would otherwise have succeeded.

This makes failure *recoverable* — it does not make the images small. The payload itself is ClickUp `86eypxght` (Cloudflare resize proxy + `srcset`), which fixes the existing catalog in place with no re-upload.

**Convex-hosted images are automatically routed through the resize proxy** (2026-08-23, ClickUp `86eypxght`): `AppImage` rewrites any `*.convex.cloud/api/storage/<uuid>` src onto our own `/img/<uuid>?w=…` Worker route, so Cloudflare resizes + re-encodes it and the result is edge-cached — fixing the whole existing catalog with no re-upload. **Give every new image surface a `sizes` prop** describing how wide it actually paints (e.g. `sizes="176px"`, or `sizes="(min-width: 1024px) 25vw, 50vw"`): that's what turns on the full `srcset`. Without `sizes` the image is still proxied, just at one fixed width — deliberately, because a `srcset` with no `sizes` makes the browser assume 100vw and fetch the LARGEST candidate, which on a grid of 180px tiles is worse than not proxying at all. Full rationale + the one-time dashboard step: [`storefront-images.md`](./storefront-images.md).

### Every phone field wears the plate — fixed for the seller, a picker for the buyer (2026-08-12, ClickUp `86eyknr2r`; buyer picker 2026-09-23, `z8r3fdh274`)
`src/components/ui/my-phone-input.tsx` — flag, dial code, a rule, then what the user types, as every payment/ride app in this market renders it (Grab, Shopee, Touch 'n Go, Stripe). Before `86eyknr2r` the repo had **three** shapes for one question: this plate (storefront checkout only), a bare `<input type="tel">` with a placeholder, and a 250-country searchable combobox — a control with one valid answer for the store's own number. The combobox and its `react-phone-number-input` + `cmdk` dependencies are gone and stay gone.

**Two variants, split by whose number it is** (the full rules: [`phone-numbers.md`](./phone-numbers.md)):

- **Seller / platform numbers** — the store's contact, the alert number, a pickup point's manager, admin fields — wear `MyPhonePrefix` / `MyPhoneInput`: a **fixed** plate for the store's country (`+60` or `+65`, default `"MY"` for Kedaipal's own Malaysia-fixed fields). A store has one country, so here the plate really is the one valid answer.
- **Buyer numbers** — storefront and booking checkout, the track page's number repair, the counter's manual bind — wear `BuyerPhonePrefix` / `BuyerPhoneInput`: the same plate carrying a **native `<select>`** laid invisibly over it (the whole 44px plate is the tap target; 16px text so iOS doesn't zoom), defaulting to the store's country. A buyer's number is per-person — a Singaporean at a Johor shop, a tourist at the counter — so for them the store's country is only the likeliest answer. The OS list (iOS wheel, Android sheet, desktop type-ahead) is the accessible, zero-dependency control; this is **not** the combobox coming back. MY/SG show their flag; every other country a same-size ISO badge, so the plate never changes width. **The plate carries the picker's keyboard focus state**: the select is invisible, so a Tab onto it paints the hover wash plus an inset ring on the plate (`peer-focus-visible`) — the frame's own ring can't say whether the picker or the number has focus. Order: the store's country, a **Nearby** group, then **All countries** A–Z. A `+CC` arriving at the start of the number (typed on, pasted, autofilled — never a `+` slipped in front of digits already there) switches the picker and leaves only the national part in the box; bare digits never switch anything.

**Two hosts per variant, one plate, so they can't drift.** Form-bound fields use `TextField` with `prefix={<MyPhonePrefix />}` or `prefix={<BuyerPhonePrefix />}` (route the buyer field's `onChange` through `applyBuyerPhoneKeystroke`); plain-`useState` forms use `MyPhoneInput` / `BuyerPhoneInput` (value/onChange). All four render through `InputPrefixFrame`, which owns the border, focus ring and invalid state — the inner control is `variant="bare"` and the `bare` variant deliberately paints **no** invalid ring of its own (it keeps `aria-invalid` for assistive tech, but a second destructive outline inside the frame is a bug, not emphasis). **The invalid state keeps its red border and ring under focus** — the frame's `focus-within` mint used to repaint it exactly while the user was fixing the error. The buyer picker's `<select>` never carries `aria-invalid`: the error belongs to the number, and focus-on-error must land in the input.

**The plate is a promise about what the field accepts — the country it shows is the country the save judges by.** A seller plate pairs with `assertValidMobileForCountry` (`convex/lib/slug.ts`) under the store's country: it takes the bare national number the plate asks for (`12-345 6789`), a local `012-…`, and a full `60…`, and rejects a landline. A buyer plate pairs with `assertValidBuyerWaPhone` / `parseBuyerWaPhone` (`convex/lib/buyerPhone.ts`) under the **picked** country, sent to the server as `waDialCountry`. Never put a fixed plate on a buyer's number (it tells a foreign buyer to type something the save refuses), and never put the picker on a store's own number. The loose `assertValidWaPhone` survives only where a number arrives from somewhere other than a Kedaipal form (inbound Meta messages, the counter's store-QR scan, the CRM rows keyed off them).

**Seeding a seller field from the DB goes through `toNationalPhoneInput`** (`src/lib/phone.ts`) — numbers are stored as `601159399791`, and rendering that beside the plate reads `+60 | 601159399791`. Comparisons ("is this dirty?") go through `normalizeMobileDigits`, the same pure normalizer the seller schemas (`waPhoneCheckoutSchema` & co., `src/lib/schemas.ts`) run, so a dirty-check and a validator can't disagree. Buyer fields are never seeded: they start empty on the default country.

**Buyer-field states to keep:** the placeholder is a real example for MY/SG and "Mobile number" elsewhere (a made-up foreign example is a format the buyer can't match); the rejection waits for blur or submit — on the plain-state hosts via `buyerPhoneRejection` (`src/lib/buyer-phone-rejection.ts`), which speaks at once when it carries a one-tap **Switch to Singapore (+65)** (that button unmounts the moment it fixes the number, so it takes the input's `inputId` and hands focus back to the field); the form-bound storefront checkout via TanStack's `isTouched`; the echo line under a parsed number carries `MASK_PII`. The counter's dialog adds a help line naming the picker ("Serving a visitor? Tap +60 to pick their country.") because the cashier is keying someone else's number, and labels its select "Country of the buyer's WhatsApp number".

## Patterns & anti-patterns
- **Focus:** every interactive element needs the visible ring (`focus-visible:ring-3 ring-ring/50`) — primitives already do; preserve it on custom elements.
- **Form errors take you to the problem.** A `useAppForm` form's `onSubmit` must go through `submitThenFocusError(form, e)` ([`src/components/forms/focus-error.ts`](../src/components/forms/focus-error.ts)) instead of a bare `form.handleSubmit()`. On a failed submit it scrolls to and focuses the **first** invalid control (in DOM order, retrying a few frames so it never races React's commit) so the seller never hunts a long form for a red line. Field controls already set `aria-invalid` (via `isError`) and show their message beneath via `FieldError`. **Submit-time business rules must also be addressed to their exact input** — the pattern is the product variant grid's `VariantIssue` (`{where, index, field, message}` from `buildSubmitVariants`/`collectOptionIssues` → the editor marks that cell `aria-invalid` + message beneath, cleared on edit); same idea for the checkout pickup picker (`error` prop on the radio list) and the pickup dialog's address/fee. A `data-form-error` banner is the **fallback for true server errors only**, never for a validation the UI could point at.
- **A server error reaches a person as a sentence, never as a stack trace.** Every `toast.error` / inline server error goes through `convexErrorMessage` ([`src/lib/format.ts`](../src/lib/format.ts)) — never `err.message`, which is the raw `[CONVEX M(x:y)] [Request ID: …] Server Error / Uncaught Error: … / at …` blob the Convex client builds. What survives is decided by the error's CLASS, not by how its words read: `ConvexError` is copy we wrote for a human and is shown as-is (**so throw `ConvexError`, not `Error`, for anything a user can trigger**); a plain `Error` that crossed the wire has its wrapper stripped; a `TypeError`/`RangeError`/… is a bug of ours and becomes one generic line, because "Cannot read properties of undefined" is not something a seller can act on. Pinned by `src/lib/format.test.ts` — the wrapper, the request id and the frames can never appear on screen. This became a rule after a refused teammate was shown `Uncaught Error: Forbidden at requireRetailerAccess (convex/lib/auth.ts:156)` (26 Sep, `86exr91r4`).
- **Cap + clamp every free-text description.** Public-facing free text (store/product/category descriptions, pickup notes) needs BOTH a server-enforced length cap (shared const, e.g. `STORE_DESCRIPTION_MAX`) AND a display `line-clamp-*` wherever it renders in a card/list/header, so one long value can't break the layout. Rule of thumb: storefront header blurb → `line-clamp-2`; a 1-line label/subtitle → `line-clamp-1`; long-form product copy renders via `Markdown` only in a dedicated scrollable panel (the product detail sheet), never raw in a tight row.
- **Disabled-with-reason > wrong-but-enabled** (CTO lens). A disabled Button + one-line why beats an enabled button that errors.
- **Badges/urgency:** small pill, semantic color; count badges cap at `99+` (see bottom-nav).
- **Empty states** get a one-line hint pointing at the next action, never a blank panel (discoverability rule in `CLAUDE.md`).
- **A dialog is never taller than the screen.** `DialogContent` caps at
  `calc(100dvh-2rem)` — a 1rem gutter, the same rule its `max-w` already used —
  and scrolls the y-axis; `Sheet` has always done the same. Long content goes
  straight in. Reach for your own `max-h` only when you want a *region* to
  scroll while the rest holds still, and put it on that region, not the shell.
  This is a rule because the shell used to have `overflow-hidden` and no cap:
  a dialog is centred with `-translate-y-1/2`, so oversized content overflowed
  at BOTH ends and was clipped, not scrolled, and `DialogFooter`'s Cancel and
  confirm buttons became unreachable with nothing to scroll back. Measured on a
  375x667 viewport: a 1457px dialog spanning -395 to 1062, its confirm button
  at 1006 and failing a hit test. 17 of the app's 20 shared-shell dialogs were
  exposed. `overflow-x` stays `hidden` — that is what rounds the full-bleed
  footer's corners — so never collapse the pair back to bare `overflow-hidden`.
  **Machine-enforced** by `src/lib/dialog-shell-overrides.test.ts`: `cn()` is
  `twMerge`, so a call site passing `overflow-hidden` or `max-h-none` would
  silently strip the shell's own classes and restore the bug. A *different*
  `max-h-*` is fine — it is still a cap.
- **Centred dialog: `calc(100dvh-2rem)`. Bottom sheet: `max-h-[90dvh]`.** Both
  appear in the codebase and that is not drift. A centred modal is pushed off
  BOTH edges by `-translate-y-1/2`, so it wants the same 1rem gutter its
  `max-w` already uses; a sheet anchored to the bottom edge only has a top edge
  to keep clear, and 90dvh leaves the header behind it visible. `Sheet` and the
  eight hand-rolled bottom sheets take the second; anything through
  `DialogContent` gets the first for free.
- **A scrolling dialog shows its scrollbar, deliberately.** On classic-scrollbar
  platforms (Windows/Linux Chrome; macOS uses overlay scrollbars) that inset
  stops the full-bleed footer ~15px short of the right rounded corner while the
  dialog is scrolling. Left alone on purpose: `scrollbar-gutter: stable` would
  reserve the strip permanently — an unexplained gap on dialogs that never
  scroll — and hiding the bar removes the only signal that there is more content
  below, which is the exact failure the cap was added to fix.
- **Don't** introduce new raw colors, arbitrary radii, or a second modal/toast implementation. Extend the token/primitive instead.
- **Uniform cards (2026-07-13):** sibling cards on one page must be the SAME height with rows aligned across neighbours — variable content must never grow a card. The recipe: fixed zones, not free flow. (1) Reserve multi-line text zones (`line-clamp-2` + matching `min-h`) so a 1-line name doesn't lift the price row. (2) Meta lines **truncate, never wrap** (`truncate`, no `flex-wrap`) — give each fact its own fixed line (name / price·variants / stock word) instead of one wrapping row. (3) Pin actions with `mt-auto` in a `flex flex-col h-full` card so buttons align across a grid row. (4) Conditional badges overlay the image (`absolute` + scrim/backdrop) or sit in a fixed side column — never as an extra stacked row some cards have and others don't. (5) List rows get a `min-h` (e.g. `min-h-[84px]` category/product rows) so short content centers instead of shrinking. Live examples: `storefront/product-card.tsx`, `app.products.index.tsx` rows, `dashboard/customer-card.tsx`.

## Verifying UI changes (render → look → iterate)
Tailwind written blind is a guess. Use the preview MCP to *see* it:
1. Start once: preview server `web` (port 3000) — see [`.claude/launch.json`](../.claude/launch.json). Don't also run `pnpm dev` manually; let the preview own 3000.
2. `preview_resize` to **mobile (375px)** first — that's the primary viewport.
3. `preview_inspect` to read **computed** padding/color/tap-target size (more reliable than eyeballing a screenshot); `preview_screenshot` for layout/overflow.
4. Check `colorScheme: dark` for both-mode correctness.
5. For a structured critique, use the **design-review** agent (`.claude/agents/design-review.md`).
