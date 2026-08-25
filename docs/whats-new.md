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
   and never finds the setting. Must be an in-app `/app…` path (test-enforced).
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
