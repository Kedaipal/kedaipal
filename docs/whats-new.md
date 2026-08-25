# "What's new" — seller-facing release notes

ClickUp [`86eyqgxv9`](https://app.clickup.com/t/86eyqgxv9). Depends on calendar
versioning ([`86eyqgxna`](https://app.clickup.com/t/86eyqgxna), see
[`ci.md`](./ci.md#app-versioning--calendar-yyyymmn-2026-08-24-clickup-86eyqgxna)).

Sellers previously had **no way to know when we shipped something**. Features
landed and nobody was told — which contradicts the standing rule in `CLAUDE.md`
that a feature nobody is told about is a missing piece of UI, not a shipped one.

## Two surfaces, one source

| surface | when | why |
| --- | --- | --- |
| **Permanent panel** — "What's new" in the More menu (mobile) and sidebar footer (desktop) | always openable; carries a dot when something is unseen | a dismissed announcement must never become unreadable |
| **Modal** | opens unprompted **only** for a release marked `notable: true` | a modal on every release trains sellers to dismiss reflexively — and then the one that matters is dismissed too |

Both read the same entries and the same seen-state, so the dot and the modal
cannot disagree.

## Where things live

| | |
| --- | --- |
| `src/content/releases.ts` | The notes themselves. Authored prose. |
| `src/lib/releases.ts` | Pure decision logic — what's unseen, who gets interrupted. |
| `src/components/dashboard/whats-new.tsx` | Provider, dialog, nav entry. |
| `convex/releases.ts` | `getSeenVersion` + `markSeen`. |
| `convex/lib/appVersion.ts` | Version parsing + ordering, shared by client and server. |

### Why the notes are in the repo, not in Convex

A release note describes **the code in that build**. In the database it can
drift from what is deployed — announcing a feature that isn't live, or missing
one that is. In the repo it ships with the build it describes, and the note gets
written in the **same PR as the feature**: the existing "code + tests + docs
together" rule with one more item.

Trade-off accepted: fixing a typo needs a deploy.

### This is NOT `docs/shipped-log.md`

The shipped log is the **engineering** record — why a call was made, what was
rejected, which trap was found. This is what a **seller** reads. An entry here
that reads like a commit message (`fix(delivery): arm the dispatch button`) is
worse than no entry at all. Keep them apart.

## How to add an entry

1. Add to `RELEASES` in `src/content/releases.ts`, **newest first**, in the
   feature's own PR.
2. `version` must match the `package.json` version that ships it (`YYYY.MM.N`).
3. Write the **benefit**, not the change — *"Print four labels on one A4 sheet"*
   beats *"added a6-4up paperSize option"*.
4. Add an `href` wherever the feature has a home. **The deep link is what turns
   an announcement into adoption**; without it a seller reads the note, nods,
   and never finds the setting.

   **Link to the exact place, not the nearest page.** Most settings live behind
   a tab, so the page alone drops the seller somewhere they still have to
   hunt — which is barely better than no link. Include the query string:

   | feature | ✅ | ❌ |
   | --- | --- | --- |
   | Despatch labels | `/app/settings?tab=fulfilment` | `/app/orders` |
   | Opening hours | `/app/settings?tab=fulfilment` | `/app/settings` |

   Two tests guard this and **neither can check the tab**: one pins the `/app`
   prefix, the other pins that the path before `?` is a real route in
   `routeTree.gen.ts`. Both would pass a link to `/app/settings` that should
   have carried `?tab=fulfilment`. Pointing at the right *part* of a page is an
   authoring judgement — check it by tapping the link once before you merge.
5. Set `notable: true` only if the change alters how the seller works.
6. **Most releases earn no entry at all.** An empty release is simply absent
   from the array — nothing shown, nothing stamped.

Ordering, duplicate versions, non-empty English copy and in-app hrefs are all
pinned by `src/lib/releases.test.ts`, so a malformed entry fails the gate rather
than rendering badly.

## The rules that decide who gets interrupted

### Store a version, never a boolean

A boolean can only answer *"dismissed once"*, so the next release would be
suppressed by the previous release's flag — the exact bug this design exists to
avoid. `retailers.lastSeenReleaseVersion` holds a calendar version, and anything
newer is unseen.

### Unset means "caught up", not "has seen nothing"

The single most important rule here. Every existing seller on rollout day, and
every new signup afterwards, has no stored version. Treating that as *"has seen
nothing"* would replay a backlog of a dozen entries at someone who has been
using the product for months — it reads like the product is talking to somebody
else.

So a seller with no stored version is **stamped silently to the running version
and shown nothing**. Their first modal is the *next* release.

One rule covers both cohorts, with **no signup-flow change and no backfill**.

### Per-account, not per-device

Stored in Convex rather than `localStorage` so a seller on a phone and a tablet
isn't shown the same modal twice — and so we can see which sellers have actually
been told about a feature, which is the point of shipping an announcement.

No `localStorage` mirror is needed to prevent a flash: nothing renders against
unknown state (`seenVersion === undefined`), so there is nothing to show and
then retract.

### Admin act-as can't consume the seller's announcement

Both `getSeenVersion` and `markSeen` resolve the retailer from the **caller's
own identity** (`by_user` on `identity.subject`), never from an explicit
`retailerId` or the act-as target — the `markLinkShared` posture. This makes
act-as safe **by construction** rather than by a guard someone can forget: an
admin operating a seller's store reads and stamps their own state.

It is also the coherent semantic — *"have I read the release notes?"* is a
question about the person using the app, not the store they're looking at.

Pinned by a test that asserts the seller's row is untouched after an admin
stamps.

### Never over the counter checkout

`/app/checkout` is suppressed: the seller is standing in front of a paying
customer, which is the worst possible moment to interrupt. It waits for their
next visit and the dot persists, so nothing is lost.

### Buyers never see it

Structural — the provider mounts only inside the `/app` shell.

## Two implementation notes worth keeping

**The provider wraps the shell, not a nav component.** `Sidebar` and `BottomNav`
are *both* mounted at all times and merely hidden by breakpoint, so per-nav
state would auto-open two dialogs and fire two stamps.

**Version comparison parses, it does not compare strings.** Lexically
`"2026.08.9" > "2026.08.10"`, so the tenth release of a month would read as older
than the ninth and its notes would never appear — a bug that only surfaces in a
month with ten releases. An unparseable stored version sorts *below* every valid
one, so corruption degrades to "show the notes" rather than "suppress them
forever": a note shown twice is a papercut, a note never shown defeats the
feature.

## The visual design (2026-08-25)

Settled from a mockup canvas rather than in code. What was wrong with the first
pass and what each fix answers:

**The sidebar entry was painted like an active nav item.** `SidebarLink`'s
active state is `bg-accent/12` plus a mint rail; the entry's `hover:bg-accent/10`
landed close enough that it read as a destination the seller was currently on.
And the footer had grown to four unrelated stacked rows — user, Collapse,
What's new, Version.

It is now **one meta line**: "What's new" (with its unseen dot) on the left, the
version as a copy-on-tap pill on the right — the two questions that corner of
the chrome exists to answer. The **Collapse row is gone**; collapsing moved to a
24px chevron centred on the sidebar's right border, which rides the seam so it
never moves vertically between states.

That button is **always visible, not hover-revealed**. The sidebar renders from
`lg` up, which includes iPad landscape at exactly 1024px where there is no hover
at all — a hover-only control would simply not exist there.

Collapsed, the meta line degrades to a sparkle icon alone with its dot — no
label, since it wrapped to two lines and looked broken. The version drops out:
nobody reads a version off a 68px rail, and expanding is one click.

The **mobile More sheet uses the same meta pairing**, so both chromes answer
"what changed / what am I running" the same way instead of diverging by
breakpoint. The version pill's HIT AREA is not its visual size: the button
carries `min-h-11 min-w-11`, released at `lg`. Below `lg` its only host is that
touch-only sheet, where the ≥44px rule is hard and a miss lands on the adjacent
"What's new" button; from `lg` up its only host is the desktop sidebar, where a
44px row would bloat the footer. The breakpoint does the work because it exactly
matches where each host lives — the sheet is `lg:hidden`, the sidebar is
`hidden lg:flex` — so no call site passes a flag that could be forgotten.
Pinned by test (PR #218 review).

Opening the panel from the More sheet **closes the sheet**, so dismissing the
notes returns the seller to their page rather than a still-open menu — every
sibling row there already closes it.

**The panel** gained a full-bleed navy header (`p-0` on `DialogContent`, since
the default padding would inset the band and leave white gutters), entry cards
with tinted icon tiles, and a widening from `sm:max-w-sm` to `sm:max-w-lg` — an
icon column plus two lines of copy reads cramped at 384px.

**Every release carries a divider row, including the newest**, even though the
header already names it. One rule for every group means a one-release panel and
a six-release panel are the same object; the alternative formatted the newest
group differently, and since most releases will have exactly one group, its
divider would almost never have rendered. The repetition is what the "New" chip
earns back. Pinned by test so nobody "tidies" the duplicate away.

**Icons** come from a closed allowlist (`ReleaseIconName`), not a free lucide
name: it keeps the set coherent, makes a typo a compile error, and stops the
bundle carrying whatever any future entry names. Omit it — most entries should —
and the entry gets the neutral sparkle.

**Dates are parsed by hand**, not through `new Date(iso)`: that reads an ISO
date-only string as UTC midnight and renders it in the viewer's zone, so a MYT
seller would see the previous day.

### The caught-up state is a designed state, not a leftover

Opening the panel with nothing unseen is the *common* case — the dot is absent
most of the time — so it has to read as finished rather than broken:

- the header reframes to **"You're on 2026.08.1 · up to date"** instead of
  naming a release;
- the mint **"Got it"** softens to a quiet **"Done"**;
- the footer picks up a **"You've seen everything"** confirmation where the CTA
  used to sit, so the bar is not left half empty.

"Done" rather than "Close" is deliberate: the header's X already owns the
accessible name "Close", and two identically-named buttons inside one dialog
read as the same control twice to a screen reader.

## Locale

Entries are `{ en: "…" }` with optional `ms`/`zh` that fall back to English.

Deliberately **not** `Record<Locale, string>`: requiring three translations per
entry taxes each release enough that entries would quietly stop being written,
and a half-translated entry is worse than an English one. A locale can be added
per-entry, later, with no reshape — and `retailers.locale` already drives seller
emails and WhatsApp alerts, so a BM seller reading BM here is a real deferred
goal, not a hypothetical.

Today `/app` is English-only pending the dashboard i18n sweep, so entries ship
`en` only.

## Deferred

- Per-plan targeting of entries, A/B, adoption analytics.
- An in-app CMS for announcements.
- Push/email announcement of a release — this is in-app only.
- A one-line pointer in `CLAUDE.md`'s Definition of Done ("+ a release note when
  the change is seller-facing"), once the CLAUDE.md split lands.
