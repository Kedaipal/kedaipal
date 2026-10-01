# Pre-built stores — an admin builds the shop, the vendor claims it later

Reference doc for **white-glove store handover**: a Kedaipal admin creates a
complete store — catalog, fulfilment, branding, settings — **before the vendor
has an account anywhere**, then hands it over by naming the email they will sign
up with. The vendor signs up, taps once, and the whole store is theirs.

This is the path for a high-value vendor who should be handed a finished shop
rather than a form.

> **TL;DR:** a store with no owner carries a **placeholder `retailers.userId`**
> that no Clerk subject can equal, so the existing owner-vs-admin gate refuses
> the world and lets admins in **with no new code path** — act-as already works.
> `retailers.pendingOwnerEmail` names who gets it; `retailers.claimStore` moves
> ownership when a **verified** Clerk identity with that address signs in, takes
> consent (which the admin could not give), and starts the 14-day free period
> **at the handover**, not at the build.

## Why this reverses an earlier decision

The admin billing card used to state the constraint as fact:

> *"A retailer is always owned 1:1 by the client's own Clerk login — we can't
> create it for them without an orphaned, un-loginable store."*

That held while the only two states were *owned* and *orphaned*. The missing
third state is **unclaimed** — a store with no owner **and a way out**. Once
"unclaimed" is a named state with a claim path, the objection dissolves: the
store isn't stranded, it is waiting.

The link-based flow (`src/lib/onboarding-link.ts`) is **not** replaced. Both
doors live in one card, `OnboardClientCard` on `/app/admin/billing#onboard`,
because it is one decision made at one moment with the same facts:

| | **Send them a link** | **Build it for them** |
|---|---|---|
| Who creates the store | the client | the admin, now |
| When | after they sign up | immediately |
| Founding rank | reservable at create | not at create — invoice after handover |
| Right when | the client will finish a form | they should be handed a finished shop |

## The ownerless state

`convex/lib/unclaimedStore.ts` is the only author.

```
retailers.userId = "unclaimed:<24 random chars>"
```

**Why the owner field, not a parallel boolean.** Every store-scoped read and
write already goes through `requireRetailerAccess`, whose owner branch is
`retailer.userId === subject`. Putting the placeholder *in that field* means the
existing gate refuses everyone by construction — there is no new branch to
forget. Admins still pass through the gate's admin branch, which never looked at
who the owner was. **That is why act-as needed no changes at all.**

**Why unique per store, not a shared constant.** `retailers.by_user` is read
with `.first()` everywhere on the assumption that a userId names at most one
store. A shared `"unclaimed"` value would make two pre-built stores collide on
that index and the second would become unreachable through it.

**Two separate facts, deliberately:**

- the placeholder `userId` — "nobody owns this yet";
- `pendingOwnerEmail` — "…and **this** address gets it".

An admin starts building before they have been given the vendor's email, so
*"built, no email yet"* must be representable. Keying unclaimed-ness on the
email would make that state impossible to write down. `isUnclaimed(store)` is
the one reader of the placeholder; nothing else tests the prefix by hand.

## What the admin does

1. **`/app/admin/billing#onboard`** → "Build it for them" → store name, slug,
   country, WhatsApp, and optionally the handover email → **Create store & start
   setting up**. Creating it drops the admin straight into act-as, because an
   admin who clicked this is about to add products and finding the store in the
   directory first would be a step with no purpose.
2. **Build it** through the ordinary dashboard in act-as. The banner reads
   **"Admin · building {store}"** with a hammer, not "acting as" with an alarm —
   the warning inverts, and an admin told the wrong one of those two is exactly
   the mistake a loud banner exists to prevent.
3. **Name the handover email** from the seller directory's Manage menu → **Set
   handover email** (`retailers.setPendingOwnerEmail`), any time before handover.
4. **Send them the sign-up link yourself.** Kedaipal never emails it — same
   posture as the existing invite link.

The directory carries an **Unclaimed** chip, placed straight after **Past due**:
both are buckets where *Kedaipal* owes an action, unlike the rest, which
describe a seller's own state. It outranks `comped` and `admin` in
`sellerBucket`, and must — a pre-built store always carries the `internal` setup
comp, so filing it under "Comped" would hide every half-finished handover inside
the sponsored-deals bucket.

## What the vendor does

They sign up at `/onboarding` with the named address and see **"{Store} is set
up — take it over"**. One tap.

That screen **replaces** the wizard, it is not a banner above it. Their store
already exists; offering "Name your store" beside it invites a second store this
login cannot have, and `createRetailer` would only refuse *after* they filled the
whole form. A dead end dressed as a choice is worse than no choice.

If a store is waiting but this login **can't hold it** (they already own a store,
or sit on another store's team), `myClaimableStore` answers `blocked` rather than
`none`, and `HandoverBlockedBanner` explains which and how to clear it. Answering
`none` would render the bare wizard and leave the vendor with no hint that the
store we built them exists.

## The claim

`retailers.claimStore({ acceptedLegal })`:

| | |
|---|---|
| **Proof of person** | the **verified** email on the Clerk identity, matched against `pendingOwnerEmail`. Identical to how a team invite binds (`convex/team.ts`) and for the identical reason — Clerk verifies addresses, so equality means the caller controls that inbox. `identityEmail` (`convex/lib/identity.ts`) returns `undefined` for an unverified address, so there is no branch to forget. |
| **One store per login** | the same wall `createRetailer` and `team.acceptInvite` enforce, with the same two refusals (`own_store`, `other_membership`) and the same way out — the explicit act. |
| **Consent** | stamped **here**, required. `createUnclaimedStore` deliberately stamps none: terms, privacy and the AUP bind the vendor, and recording our click as their acceptance would be a false record of consent. The claim screen carries the same not-pre-ticked checkbox as the wizard. |
| **Ownership** | `userId` → their subject, `pendingOwnerEmail` cleared, `notifyEmail` → their address, `claimedAt` stamped. |
| **Free period** | `startFreePeriodOnClaim` — see below. |

**"Remove the previously used email" is one field.** No Clerk account is ever
created during setup, so there is nothing to delete — the setup email exists only
as `pendingOwnerEmail` on the retailer row, and the claim clears it. That is what
makes the handover safe rather than fiddly.

The claim re-checks `isUnclaimed`, not just the index: the index only says an
address is *pending*, and a claimed store with a stale pending field would
otherwise hand a live business to a second person.

## Billing — why an `internal` comp and not a trial

A pre-built store runs on `comp.kind: "internal"` (`insertSetupComp`) while the
admin builds it, so nothing bills, nothing locks, and the daily cron has nothing
to flip.

**A store cannot simply be created `trialing` and handed over later.**
`trialEndsAt` is stamped at create, so a store built on the 1st and handed over
on the 20th would arrive with its free period already spent — and the vendor's
very first sign-in would be a past-due lockout screen.

At the claim, `startFreePeriodOnClaim` ends the comp **into a trial**. It is the
deliberate sibling of `endComp`, which lands on `past_due` with no invoice — an
*expired seller* — and emails the seller that sponsored access they never had has
ended. Both outcomes would be absurd on a vendor's first login.

**A real comp survives the handover.** Only `internal` is scaffolding; a
`partner`/`sponsor`/`pilot` comp set before handover is a commercial promise to
the vendor, and the claim leaves it alone.

## Visibility before the handover

| Surface | Before claim | Why |
|---|---|---|
| `kedaipal.com/<slug>` | **live** | so an admin can show the vendor their shop. Orders work — useful for a test run during setup. |
| `/stores` directory | **never** | `storeIsInternal` returns true for an unclaimed store **structurally**, not via the `internal` comp: a comp is a billing state an admin can edit, and pre-comping a partner deal ahead of handover must not publish a store with nobody behind it. |
| `sitemap.xml` | **never** | indexing a URL whose store may never be claimed (or may be renamed at handover) spends the slug's ranking on a page that could vanish. |

Joins both the moment it is claimed.

## Where every behaviour is surfaced

Per CLAUDE.md, no hidden behaviour. Each rule and the place it is stated:

| Behaviour | Told where |
|---|---|
| this door exists | the mode picker on `#onboard`, each option with its consequence |
| creating it enters act-as | the line above the button, before the click |
| no founding rank at build | the founding toggle, **disabled with reason** |
| the handover email is optional | its label and helper line in build mode |
| the handover mechanism | `HandoverDialog` — "whoever signs up with this becomes its owner" |
| nothing bills until claimed | the dialog, the `#onboard` card, and `sellerRail` → "Not billed until claimed" |
| the store is unlisted until claimed | the dialog and the claim screen |
| the trial starts at claim | the dialog, the `#onboard` card, the claim screen's footer |
| this store has no owner | the **Unclaimed** chip, the sheet's **Handover** row, the act-as banner |
| nobody is named yet | amber expiry tone + "No handover email yet" + the amber Manage item |
| a claim can't go through | `HandoverBlockedBanner`, naming the blocking store |
| it was pre-built, after the fact | the sheet's **Handover** row (`claimedAt`) and the CSV's **Claimed** column |

## What the hands-on test changed (2 Oct)

Driving it found four defects that the suite could not, two of them blockers.
Each one is now a test that goes red if the fix is reverted.

**The slug hint contradicted its own server.** `checkSlugAvailability` exempted
the CALLER's own slug — correct for a rename (re-saving the slug you have is a
no-op), wrong for a store being BORN. An admin building a store saw
"✓ Available" for their own store's slug, the button enabled, and the create
refused with "That slug is taken". The query now takes a **required** `purpose`
(`"create" | "rename"`), so a new call site has to state which question it is
asking rather than inherit the wrong answer. The bug was only reachable through
`createUnclaimedStore`, because `createRetailer` refuses one-store-per-login
before it ever looks at the slug — which is why it had survived.

Deliberately NOT fixed by removing the slug field: the slug is the vendor's
public identity and derives badly from a store name ("Mak Cik Kuih Homemade
Kuih & Catering" → `mak-cik-kuih-homemade-kuih-cat`), names and slugs move
independently, `renameSlug` + 90-day `slugHistory` already exist so editing is
safe, and a non-Latin store name slugifies to nothing. `slugify` DID get the
related fix: it cut mid-word at 32 chars, and now falls back to the last whole
word (`something-very-very-long-store`, not `…-store-n`).

**The consent banner asked an admin to accept the terms for the vendor.** A
pre-built store has no consent stamps by design, so the re-accept banner fired
on every page. Worse, `recordConsentAcceptance` resolves the store `by_user` on
the CALLER, so clicking it re-stamped the ADMIN'S OWN store, left the acted-on
store untouched, and parked the button on "Saving…" forever because the banner's
own condition never cleared. The banner is now **owner-only** (`role !==
"owner"` returns null), which closes the pre-built case and the pre-existing
act-as-any-seller case in one line, the way the server already works.

**A pre-built store called itself "Sponsored."** It runs on an `internal` comp,
and `tierPill`'s comped branch labelled it so — a false word on the
seller-facing chip an admin shows the vendor during the handover demo.
`unclaimed` now outranks `comped` there, exactly as it already did in the admin
directory's `sellerBucket`; the chip reads **Unclaimed**, wears the directory's
dashed-accent treatment, and links to the console rather than to a billing page
about nobody.

**The act-as banner nagged for finished work** — "Set a handover email in the
seller directory" even when one was set. It now names who the store is waiting
for, and only asks when nothing is set (in which case it says plainly that
nobody can claim it).

**Three more from the vendor-side run (Zaki, 2 Oct).** The claim itself was
clean — ownership moved, the email cleared, consent stamped, and `trialEndsAt −
claimedAt` was exactly 14 days — but the screens around it were not:

- **The wizard flashed before the claim screen.** `myClaimableStore` returned
  `none` for an anonymous caller, and Convex answers a query the instant it
  arrives — before the Clerk token attaches — so the client believed a timing
  state was a verdict and rendered "Name your store" at a vendor whose store was
  already built. It now returns a distinct **`anonymous`** state and the route
  holds the loading screen on it. Fixed server-side rather than with a client
  auth hook so there is no window where the two disagree; `useActAsViewer` in
  PR #325 solves the same trap for the admin check with `useConvexAuth`.
- **The vendor landed wearing the admin's banner.** `useActAs` lives in
  `sessionStorage`, which a sign-out does not clear, and the usual path to the
  claim screen is the admin's own tab. `claimStore` now clears the act-as
  session at the moment ownership transfers — the one instant that belongs to
  the handover itself. The general "act-as outlives a sign-in as someone else"
  case is PR #325's (it makes the session Clerk-session-keyed); this is not a
  duplicate of it and both are wanted.
- **The handover email is now REQUIRED in build mode.** "Optional, set it later"
  is a thing an admin forgets, and a store with nobody named cannot be claimed
  by anyone. You are building the store FOR a specific person, so you name them
  at create. It stays changeable afterwards (Manage → Handover email), which is
  what covers a typo. The server still accepts an absent one, so an admin can
  deliberately park a handover whose deal fell through — the directory shows
  that state in amber.

**Two more from the admin run.** The seats cell read "No team yet" in a column
sized for "1/3" and wrapped to three lines, so the COLUMN value is now "None"
(the "Seats" header already supplies the noun) while the mobile card, which
inlines it with no header, keeps "No team yet" — which is exactly why
`sellerSeatsLabel` and `sellerSeatsPhrase` are separate. And the Manage menu
still called the setup comp a sponsorship: a pre-built store is ALWAYS comped,
so the ordinary comped copy offered to "edit the sponsorship or turn it off"
for scaffolding. It now reads **"Comp upgrade — setup only"** and explains that
it ends at the claim. The item stays ENABLED, because pre-comping a real
partner deal before handover is supported and survives the claim — that case
keeps the ordinary copy. The decision lives in `sellerCompMenuItem`
(`admin-seller-view.ts`) beside the row's other derived sentences, so it is
testable rather than buried in a dropdown.

**And the fix that broke the thing it was fixing.** Clearing the act-as session
at the claim reached for `useActAs()`, but `ActAsProvider` wraps the `/app`
subtree only — `/onboarding` is a sibling route — so the hook threw and the
vendor's entire onboarding died on "useActAs must be used within an
ActAsProvider". The session is cleared through a provider-free
`clearStoredActAs()` instead, exported from `useActAs.tsx` so `STORAGE_KEY`
keeps one owner.

The test had MOCKED `useActAs`, which is exactly why it stayed green while the
screen was broken. It now runs the real module and asserts the real effect (the
key is gone from `sessionStorage`), plus a case that simply renders the screen —
reintroduce the hook and that one goes red. A mock that stands in for the thing
under test proves the mock works, not the code.

**From review (PR #332).** Two non-blocking notes, both acted on:

The "already runs a store" pre-check matches on `notifyEmail`, which the schema
explicitly allows a seller to re-point at a shared ops inbox — so it can name a
different person than the one who signs in. The guard stays (it is correct for
every store that never changed it, and the authoritative wall is `claimBlocker`
on the Clerk subject at claim time), but the refusal no longer asserts that the
address "runs" a store. It states the match it actually made and how to clear
it, because a flat refusal on a proxy signal with no way out is a dead end.
Kedaipal never stores a login address, so no stronger check is available.

Three mutation-test comments said the guarded test "goes green" when the guard
is deleted. It goes **red** — measured. Those comments exist to tell the next
person how to verify a guard, so a backwards instruction is worse than none;
all three now name the failure, and each was re-run against its mutation to
confirm the claim.

### Which email is which

Three different addresses, and only one of them is ever a key:

| | What it is | Who changes it, where |
|---|---|---|
| **Clerk login email** | the vendor's sign-in | the vendor, via Clerk's own `<UserButton>` → Manage account. Never in our Settings. |
| **`retailers.notifyEmail`** | where order + billing mail goes | the seller, Settings → Store. Set to the claimer's address at handover. |
| **`retailers.pendingOwnerEmail`** | the claim target, used once | an admin, Manage → Handover email. Cleared by the claim. |

**Ownership is keyed on the Clerk USER ID (`identity.subject`), never on the
email.** So a vendor can change their login address afterwards and keep their
store — the email is only how the claim finds them, once.

Still open, deliberately: **the pre-handoff tier picker.** An admin should
choose what the vendor lands on before handover — default Enterprise (a custom
tier whose limits the admin sets), switchable to a comp or to Pro/Starter with
those tiers' limits locked. `Plan` here is still `"starter" | "pro" | "scale"`;
Enterprise lives on `zaki/z8r3fdkp8h-enterprise-tier` and is in neither staging
nor this branch's base, so building the picker now would stack this PR three
deep for a feature it does not need. Its own ticket once Enterprise lands.

## Audit

Both admin acts drop `adminAuditLog` rows against the store —
`retailers.createUnclaimedStore` and `retailers.setPendingOwnerEmail` — so
`recentAuditForRetailer` answers "where did this store come from, and who built
it?". Every ordinary white-glove edit already audits via `logAdminAction`
(`actingAsAdmin` is true, since the admin is not the owner).

The **claim** is the vendor's own act, not an admin's, so it is not in the admin
audit log: `retailers.claimedAt` is its record, plus a server log line.

## Tests

`convex/prebuiltStore.test.ts` (35 cases). Each covers a guard such that
**deleting the guard turns it red** — mutation-verified:

| Guard | The case that bites |
|---|---|
| `emailVerified` check in `lib/identity.ts` | "an UNVERIFIED email cannot claim, however exactly it matches" |
| `isUnclaimed` re-check in `claimStore` | "a CLAIMED store with a stale pending email cannot be claimed again" |
| `startFreePeriodOnClaim` call | "the 14-day free period starts AT THE CLAIM" |
| `isUnclaimed` guard in `setPendingOwnerEmail` | "a CLAIMED store refuses it — this is not a store-takeover primitive" |
| `isUnclaimed` in `storeIsInternal` | `marketplace.test.ts` → "comping it `partner` does NOT put it on the rail" |

Plus `src/lib/admin-seller-view.test.ts` for the directory's derived facts, and
`convex/sellerLockCoverage.test.ts`, which **required** `claimStore` to be
classified — a public write that is deliberately not subscription-locked, since
the caller is not a seller yet.

## Not built

- **Transferring a CLAIMED store** to a different owner. `setPendingOwnerEmail`
  refuses a store that has an owner, on purpose: a mutation that can re-point a
  live store's owner email is a store-takeover primitive. A real transfer needs
  the current owner's consent and is its own feature.
- **Emailing the vendor the sign-up link.** The admin pastes it, same as the
  existing invite link.
- **A founding rank at build time.** A slot held by a store that may never be
  claimed would eat one of ten. Issue the founding invoice after handover.
