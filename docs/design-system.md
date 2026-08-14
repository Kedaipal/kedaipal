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
| Phone | `MyPhoneInput` (plain state) / `TextField prefix={<MyPhonePrefix />}` (form-bound) | **every** Malaysian phone field — see below. |
| Composite control | `InputPrefixFrame` | one border owning a fixed plate + a `bare` input (the `+60` plate, an "RM"). |
| Modal | `Dialog*` | `DialogFooter` is full-bleed + reverses on mobile. Confirm-only flows → `ConfirmDialog`. |
| Popover / menu | `Popover`, `DropdownMenu*` (radix) | `DropdownMenu` = a keyboard-navigable action menu (trigger → items). Use to group related actions behind one control instead of a row of competing buttons (e.g. the counter-checkout header's "New order"). Open a `Dialog` from an item via controlled state in `onSelect` — the menu→dialog focus handoff is clean. |
| Copy-to-clipboard | `CopyButton` | one-tap copy w/ feedback (order IDs, bank details). |
| Reorderable list | `SortableList` | **the** sorting standard (@dnd-kit, mobile-safe). **Never** arrow-button reordering. |
| Loading state | `Skeleton` | prefer skeletons over spinners for content. |
| Rich text | `Markdown` | product descriptions etc. |
| Image | `AppImage` | **every** raw `<img>` of a Convex-hosted/user-uploaded photo — see below. |
| Zoomable image | `ZoomableImage` | product/mockup imagery; wraps `AppImage` internally, so it gets the same loading/error handling for free. |

If a primitive is missing, **add it to `src/components/ui/`** — don't inline a one-off in a route.

### Images always render via `AppImage` (2026-07-24)
`src/components/ui/app-image.tsx` — skeleton placeholder while loading → fade-in on load → a labelled, terminal fallback (muted box + icon + the alt text) on a dead URL or unset `src`, instead of a blank box. Two sizing modes: **`fill` (default)** — `aspect` is the wrapper's box, the image crops to fill it (`objectFit="cover"|"contain"`); use for photo thumbnails, avatars, banners. **`fill={false}`** — `aspect` becomes the image's OWN intrinsic-ratio classes (e.g. `"h-8 w-auto"`) instead of a box to stretch into; use for fixed-height, auto-width brand-mark SVGs (forcing those through `w-full` inside an auto-width wrapper is the classic "percentage width in an indefinite container" CSS trap). `priority` (LCP candidates — storefront cover, first product-grid row) skips the lazy-loading hint. Local upload previews (`blob:`/`data:` URLs) auto-skip the skeleton (already instant). **Exceptions:** `store-poster.tsx` (print/PDF-export surface — a lazy or opacity-0 image can print blank; has its own `new Image()` onload/onerror gating) and `landing/responsive-image.tsx` (a build-time `<picture>`/srcset wrapper for static optimized assets — a different concern from `AppImage`'s runtime Convex-hosted URLs).

### Every phone field wears the `+60` plate (2026-08-12, ClickUp `86eyknr2r`)
`src/components/ui/my-phone-input.tsx` — flag, fixed `+60`, a rule, then what the user types, as every payment/ride app in this market renders it (Grab, Shopee, Touch 'n Go, Stripe). Before this the repo had **three** shapes for one question: this plate (storefront checkout only), a bare `<input type="tel">` with a placeholder, and a 250-country searchable combobox — a control with one valid answer for a Malaysia-only product. The combobox and its `react-phone-number-input` + `cmdk` dependencies are gone.

**Two hosts, one plate, so they can't drift.** Form-bound fields use `TextField` with `prefix={<MyPhonePrefix />}`; plain-`useState` forms use `MyPhoneInput` (value/onChange). Both render through `InputPrefixFrame`, which owns the border, focus ring and invalid state — the inner control is `variant="bare"` and the `bare` variant deliberately paints **no** invalid ring of its own (it keeps `aria-invalid` for assistive tech, but a second destructive outline inside the frame is a bug, not emphasis).

**The plate is a promise about what the field accepts.** Only put it on a field whose server validator is `assertValidMyMobile` (`convex/lib/slug.ts`) — which takes the bare national number the plate asks for (`12-345 6789`), a local `012-…`, and a full `60…`, and rejects a landline. Adding the plate to a field that still accepts any country tells the user to do something the save then refuses. The loose `assertValidWaPhone` survives only where a number arrives from somewhere other than a Kedaipal form (inbound Meta messages, the counter's store-QR scan, the CRM rows keyed off them).

**Seeding from the DB goes through `toMyNationalInput`** (`src/lib/phone.ts`) — numbers are stored as `601159399791`, and rendering that beside the plate reads `+60 | 601159399791`. Comparisons ("is this dirty?") go through `normalizeMyDigits`, the same pure normalizer `myWaPhoneCheckoutSchema` runs, so a dirty-check and a validator can't disagree.

**Deliberate exception:** the counter checkout's manual buyer bind keeps a bare input. It normalizes through `assertValidMyWaPhone`, which passes a foreign number through by design — a cashier may be serving a walk-in who isn't Malaysian.

## Patterns & anti-patterns
- **Focus:** every interactive element needs the visible ring (`focus-visible:ring-3 ring-ring/50`) — primitives already do; preserve it on custom elements.
- **Form errors take you to the problem.** A `useAppForm` form's `onSubmit` must go through `submitThenFocusError(form, e)` ([`src/components/forms/focus-error.ts`](../src/components/forms/focus-error.ts)) instead of a bare `form.handleSubmit()`. On a failed submit it scrolls to and focuses the **first** invalid control (in DOM order, retrying a few frames so it never races React's commit) so the seller never hunts a long form for a red line. Field controls already set `aria-invalid` (via `isError`) and show their message beneath via `FieldError`. **Submit-time business rules must also be addressed to their exact input** — the pattern is the product variant grid's `VariantIssue` (`{where, index, field, message}` from `buildSubmitVariants`/`collectOptionIssues` → the editor marks that cell `aria-invalid` + message beneath, cleared on edit); same idea for the checkout pickup picker (`error` prop on the radio list) and the pickup dialog's address/fee. A `data-form-error` banner is the **fallback for true server errors only**, never for a validation the UI could point at.
- **Cap + clamp every free-text description.** Public-facing free text (store/product/category descriptions, pickup notes) needs BOTH a server-enforced length cap (shared const, e.g. `STORE_DESCRIPTION_MAX`) AND a display `line-clamp-*` wherever it renders in a card/list/header, so one long value can't break the layout. Rule of thumb: storefront header blurb → `line-clamp-2`; a 1-line label/subtitle → `line-clamp-1`; long-form product copy renders via `Markdown` only in a dedicated scrollable panel (the product detail sheet), never raw in a tight row.
- **Disabled-with-reason > wrong-but-enabled** (CTO lens). A disabled Button + one-line why beats an enabled button that errors.
- **Badges/urgency:** small pill, semantic color; count badges cap at `99+` (see bottom-nav).
- **Empty states** get a one-line hint pointing at the next action, never a blank panel (discoverability rule in `CLAUDE.md`).
- **Don't** introduce new raw colors, arbitrary radii, or a second modal/toast implementation. Extend the token/primitive instead.
- **Uniform cards (2026-07-13):** sibling cards on one page must be the SAME height with rows aligned across neighbours — variable content must never grow a card. The recipe: fixed zones, not free flow. (1) Reserve multi-line text zones (`line-clamp-2` + matching `min-h`) so a 1-line name doesn't lift the price row. (2) Meta lines **truncate, never wrap** (`truncate`, no `flex-wrap`) — give each fact its own fixed line (name / price·variants / stock word) instead of one wrapping row. (3) Pin actions with `mt-auto` in a `flex flex-col h-full` card so buttons align across a grid row. (4) Conditional badges overlay the image (`absolute` + scrim/backdrop) or sit in a fixed side column — never as an extra stacked row some cards have and others don't. (5) List rows get a `min-h` (e.g. `min-h-[84px]` category/product rows) so short content centers instead of shrinking. Live examples: `storefront/product-card.tsx`, `app.products.index.tsx` rows, `dashboard/customer-card.tsx`.

## Verifying UI changes (render → look → iterate)
Tailwind written blind is a guess. Use the preview MCP to *see* it:
1. Start once: preview server `web` (port 3000) — see [`.claude/launch.json`](../.claude/launch.json). Don't also run `pnpm dev` manually; let the preview own 3000.
2. `preview_resize` to **mobile (375px)** first — that's the primary viewport.
3. `preview_inspect` to read **computed** padding/color/tap-target size (more reliable than eyeballing a screenshot); `preview_screenshot` for layout/overflow.
4. Check `colorScheme: dark` for both-mode correctness.
5. For a structured critique, use the **design-review** agent (`.claude/agents/design-review.md`).
