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
4. **Sticky primary action** on long flows (`sticky bottom-0` + border + `bg-background`), not a button lost at the bottom of a scroll.
5. Bottom nav / desktop sidebar swap at `lg` (`lg:hidden` / `hidden lg:flex`).

## Primitives — reach for these first
Don't hand-roll what exists. From [`src/components/ui/`](../src/components/ui/):

| Need | Use | Notes |
| --- | --- | --- |
| Button | `Button` | variants: `default`(mint)/`outline`/`secondary`/`ghost`/`destructive`/`link`; sizes incl. `icon*`. `isLoading` shows a spinner; `asChild` to wrap a `Link`. |
| Text input | `Input` | `variant="field"` = **mobile form field (≥44px)**; `default` = compact toolbar; `bare` = child of a composite. `isError` sets `aria-invalid`. |
| Form row | `Field` + `FieldLabel` / `FieldContent` / `FieldDescription` / `FieldError` | **always** compose forms with these — don't hand-write label+input+error. `FieldError` takes an `errors` array (TanStack Form shape). |
| Textarea | `Textarea` | |
| Phone | `PhoneInput` | MY-aware; use everywhere a WA number is entered. |
| Modal | `Dialog*` | `DialogFooter` is full-bleed + reverses on mobile. Confirm-only flows → `ConfirmDialog`. |
| Popover / menu | `Popover`, `Command` (cmdk) | |
| Copy-to-clipboard | `CopyButton` | one-tap copy w/ feedback (order IDs, bank details). |
| Reorderable list | `SortableList` | **the** sorting standard (@dnd-kit, mobile-safe). **Never** arrow-button reordering. |
| Loading state | `Skeleton` | prefer skeletons over spinners for content. |
| Rich text | `Markdown` | product descriptions etc. |
| Zoomable image | `ZoomableImage` | product/mockup imagery. |

If a primitive is missing, **add it to `src/components/ui/`** — don't inline a one-off in a route.

## Patterns & anti-patterns
- **Focus:** every interactive element needs the visible ring (`focus-visible:ring-3 ring-ring/50`) — primitives already do; preserve it on custom elements.
- **Disabled-with-reason > wrong-but-enabled** (CTO lens). A disabled Button + one-line why beats an enabled button that errors.
- **Badges/urgency:** small pill, semantic color; count badges cap at `99+` (see bottom-nav).
- **Empty states** get a one-line hint pointing at the next action, never a blank panel (discoverability rule in `CLAUDE.md`).
- **Don't** introduce new raw colors, arbitrary radii, or a second modal/toast implementation. Extend the token/primitive instead.

## Verifying UI changes (render → look → iterate)
Tailwind written blind is a guess. Use the preview MCP to *see* it:
1. Start once: preview server `web` (port 3000) — see [`.claude/launch.json`](../.claude/launch.json). Don't also run `pnpm dev` manually; let the preview own 3000.
2. `preview_resize` to **mobile (375px)** first — that's the primary viewport.
3. `preview_inspect` to read **computed** padding/color/tap-target size (more reliable than eyeballing a screenshot); `preview_screenshot` for layout/overflow.
4. Check `colorScheme: dark` for both-mode correctness.
5. For a structured critique, use the **design-review** agent (`.claude/agents/design-review.md`).
