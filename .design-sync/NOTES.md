# design-sync notes — Kedaipal

## Repo shape

Kedaipal is a TanStack Start **app**, not a publishable component library — no
`main`/`module`/`exports` in `package.json`, no `dist/index.*` with `.d.ts`.
The sync runs in **package shape, synth-entry mode**: `cfg.srcDir` is scoped
to `src/components/ui` (the shadcn/radix primitives directory `docs/design-system.md`
itself calls "Primitives"), so the synthesized entry only bundles that
directory — never the whole `src/` tree (which would drag in Convex-generated
API imports, TanStack Router hooks, and env-var-dependent code the converter
can't bundle standalone).

`--entry ./.design-sync/.cache/__no_dist_entry__.js` is a deliberately
**non-existent** path passed on every build/resync invocation — its `dirname`
walk-up finds the repo root's `package.json` (name "kedaipal"), which sets
`PKG_DIR` to the repo root, while `resolveDistEntry`'s `soft:true` path
returns `null` for the missing file and triggers synth-entry mode. This is
required scaffolding, not a typo — don't "fix" it to a real path.

## cssEntry pipeline (read before touching cfg.cssEntry)

`src/styles.css` is Tailwind v4 CSS-first (`@import "tailwindcss"` + `@theme`)
— it has NO utility classes until run through the real `@tailwindcss/vite`
plugin. The converter's static CSS copy can't do that, so `cfg.buildCmd`
(`pnpm build && bash .design-sync/compile-styles.sh`) runs the real
production build and `compile-styles.sh`:
1. copies the hashed `dist/client/assets/styles-<hash>.css` to a **stable**
   `.design-sync/.cache/compiled-assets/styles.css` (`cfg.cssEntry` points
   here — a fixed name so config doesn't need editing every build),
2. rewrites Vite's **root-absolute** font `url(/assets/…)` refs to relative
   `url(./…)` — the converter's font extractor does `path.resolve(srcDir, url)`,
   and a leading `/` makes Node treat it as an absolute filesystem path,
   silently failing to find the font and dropping it,
3. copies the referenced `.woff2` files alongside so the relative refs resolve.

**Always run `pnpm build` before a resync if `src/styles.css` or any `ui/`
component's Tailwind classes changed** — a stale `dist/` silently ships old
CSS. `compile-styles.sh` fails loudly if `dist/client/assets/styles-*.css`
is missing.

## Component scope

Synced: `src/components/ui/*` only — 60 exported components (many are
structural sub-exports: `DialogHeader`, `PopoverContent`, `FieldLabel`, etc.
— shadcn's one-file-many-exports shape). Domain components
(`dashboard/`, `storefront/`, `order/`, `settings/`, etc.) are Convex-data-bound
page compositions, not design-system primitives — deliberately out of scope
(confirmed with the user at scoping time).

Grouped via `cfg.docsMap` → `.design-sync/doc-stubs/<Name>.md` stub files
(`---\ncategory: <Group>\n---`, no real doc content) into 5 groups: Actions,
Forms, Overlays, Media, Data Display — `srcDir` is flat so every component
would otherwise land in one "general" bucket. **The doc-stubs are grouping
scaffolding, not documentation** — if the repo ever grows real per-component
docs, reconcile `docsMap` rather than leaving stale category-only stubs.

`InputGroup`/`InputGroupAddon`/`InputGroupButton`/`InputGroupInput`/
`InputGroupText`/`InputGroupTextarea` are **not used anywhere else in the
app** (verified via grep at sync time) — real shipped shadcn scaffold code,
kept in scope since it's genuinely in `ui/` and fully functional, but flag to
the team as a dead-code candidate if it's still unused next sync.

## Preview authoring scope

26 components got authored previews (the ones `docs/design-system.md` /
`CLAUDE.md` name as primitives: Button, Input, Field, Textarea, MyPhoneInput,
InputPrefixFrame, Dialog, Popover, DropdownMenu, Sheet, ConfirmDialog,
CopyButton, SortableList, Skeleton, Markdown, AppImage, ZoomableImage,
FilterChip, Calendar, Slider — plus the 4 InputGroup sub-parts, which needed
fixing anyway, see below). The remaining 34 structural sub-exports
(`Dialog*`, `Popover*`, `DropdownMenu*`, `Sheet*`, `Field*`, `InputGroupText`)
ship the honest floor card — authorable incrementally on any future re-sync,
per the base skill's standing offer.

**7 components originally failed the render-check gate** (`[RENDER_BLANK]`,
not floor cards — they rendered non-crashing but visually empty with the
auto-synthesized default props): `InputGroupAddon`, `InputGroupButton`,
`InputGroupInput`, `InputGroupTextarea` (need to be composed inside a real
`InputGroup`), `Slider` (needs a real controlled value), `DialogFooter` and
`DropdownMenuLabel` (only render meaningfully inside an open parent overlay).
Fixed by authoring real previews for all 7 — `DialogFooter.tsx` and
`DropdownMenuLabel.tsx` intentionally duplicate the `Dialog.tsx` /
`DropdownMenu.tsx` composition verbatim (per the skill: "a leaf that throws
outside its provider gets its preview written as the full parent
composition — that's the only render that's true anyway").

7 overlay components got `cfg.overrides.<Name>: {cardMode: "single", viewport: "WxH"}`
so their open state renders inside the card instead of collapsing/escaping:
`Dialog`, `DialogFooter`, `ConfirmDialog`, `Popover`, `DropdownMenu`,
`DropdownMenuLabel`, `Sheet`. Note: the individual solo `?story=` screenshot
capture (`_screenshots/review/raw/*.png`) appears to render at a fixed
~1200×800 regardless of the declared `viewport` override — cosmetic only
(everything still renders correctly, e.g. `Sheet` shows its desktop `sm:`
centered-modal variant rather than the mobile bottom-sheet framing); not
investigated further since render quality wasn't affected.

## Known render warns (accepted, not new)

- `[FONT_MISSING] "Microsoft YaHei"` — referenced by the shipped CSS's CJK
  system-font fallback stack (`docs`/CLAUDE.md: "CJK renders via a system-font
  fallback stack — PingFang SC/Microsoft YaHei/Noto Sans SC — deliberately no
  bundled webfont yet"). This is an intentional `zh`-locale fallback, not a
  Kedaipal brand font — Microsoft YaHei is proprietary and can't be bundled
  anyway. Accepted as a system-font substitute; do not chase this on re-sync.

## Re-sync risks

- **`cfg.cssEntry` is a generated copy, not source** — it goes stale the
  moment `pnpm build` output changes without `compile-styles.sh` re-running.
  `cfg.buildCmd` covers both in one command; if you ever run the converter
  manually without it, the CSS will be wrong or missing.
- **`.design-sync/doc-stubs/*.md`** are grouping-only stubs (60 tiny files) —
  don't mistake them for real component docs; they carry zero prose.
- **Playwright/chromium** was freshly installed into `.ds-sync/node_modules`
  for this sync (no prior repo pin) — on a fresh clone/CI box, expect to
  reinstall it (~200MB) before the render-check will run.
- **34 components remain on the floor card** — a good next-sync target for
  incremental preview authoring, but not required; they pass the gate by
  design.
