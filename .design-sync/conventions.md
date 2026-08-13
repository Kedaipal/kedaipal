# Kedaipal design system — build conventions

Palette: **midnight navy** (primary) + **mint** (accent, the brand action color — primary buttons default to this). Mobile-first is a hard requirement: single-column by default, widen at `sm:`/`lg:`; never design desktop-first and shrink.

## No wrapper needed

These components read theme entirely from CSS custom properties scoped to `:root` / `.dark` — there is **no theme/context provider to wrap your composition in**. A `<div class="dark">` ancestor (or none, for light) is the only "setup" that exists. Every component must look correct in both — always build with real semantic tokens (below), never hardcoded hex, so dark mode is automatic.

## Styling idiom: Tailwind utility classes over semantic tokens

Never use a raw color (`bg-emerald-500`) or an arbitrary radius — every surface is `bg-<token>` / `text-<token>` / `border-<token>`, compiled from the theme in `styles.css` into real utility classes (`bg-accent`, `text-primary-foreground`, `border-input`, …). Always reach for the utility class on the semantic token name below, never a raw hex/oklch value:

| Token | Role |
|---|---|
| `background` / `foreground` | page base |
| `card` / `popover` (+ `-foreground`) | raised surfaces |
| `primary` (+ `-foreground`) | navy — dark surfaces, primary emphasis |
| `accent` (+ `-foreground`; `text-accent-emphasis` for stronger mint text) | **mint — the brand action color** |
| `secondary` (+ `-foreground`) | soft slate, low-emphasis fills |
| `muted` / `muted-foreground` | subtle bg / secondary text |
| `destructive` | errors, delete, red states |
| `border` / `input` / `ring` | hairlines, field borders, focus ring (ring = mint) |

Radius scale is off `--radius: 0.75rem` via `rounded-sm|md|lg|xl|2xl|3xl|4xl`: cards/dialogs use `rounded-xl`, buttons `rounded-lg`, pills `rounded-full`. Fonts: `font-sans` (Geist Variable, body — the default) and `font-heading` (Red Hat Display Variable — apply explicitly to display text; `h1`–`h6` already carry it).

**Every interactive touch target needs ≥44px.** `Button`'s own sizes top out at `h-9`/36px (even `size="lg"`/`size="icon"`) — for a primary *touch* target add the `tap-target` utility (or `min-h-11`) explicitly. `Input`'s `variant="field"` (`min-h-11`) is already the mobile-sized form field; `variant="default"` (`h-8`) is for compact desktop toolbars only.

Always compose forms with `Field` + `FieldLabel` + `FieldContent` + `FieldDescription` + `FieldError` (never hand-write a bare label+input+error stack) — see the `Field` component's authored preview for the exact composition, including the errored and horizontal-orientation shapes.

## Where the truth lives

- `styles.css` (bound copy) — the full token/utility closure every rendered design consumes; read it before inventing a new class.
- `guidelines/docs/design-system.md` (bound copy of the repo's `docs/design-system.md`) — the fuller prose spec: mobile-first rules, primitives table, patterns/anti-patterns (uniform card heights, disabled-with-reason, cap+clamp free text).
- Each component's own `.prompt.md` + `.d.ts` — the per-component API contract and usage examples.

## A build example

```tsx
import { Button, Field, FieldContent, FieldDescription, FieldLabel, Input } from "kedaipal";

function OrderNoteCard() {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
      <Field>
        <FieldLabel htmlFor="note">Note for the seller</FieldLabel>
        <FieldContent>
          <Input id="note" variant="field" placeholder="Any special requests?" />
          <FieldDescription>Optional — shown on the order ticket.</FieldDescription>
        </FieldContent>
      </Field>
      <Button variant="default" className="tap-target self-end">
        Place order
      </Button>
    </div>
  );
}
```
