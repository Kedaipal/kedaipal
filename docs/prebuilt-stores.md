# Pre-built stores — an admin builds the shop, the vendor claims it later

Reference doc for **white-glove store handover** (ClickUp
[`z8r3fdm6up`](https://app.clickup.com/t/z8r3fdm6up)): a Kedaipal admin creates a
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
   setting up**, or **Create & add another** (see
   [Building a batch](#building-a-batch)). The first drops the admin straight
   into act-as, because an admin who clicked it is about to add products and
   finding the store in the directory first would be a step with no purpose; the
   second stays on the card with the form cleared.
2. **Build it** through the ordinary dashboard in act-as. The banner reads
   **"Admin · building {store}"** with a hammer, not "acting as" with an alarm —
   the warning inverts, and an admin told the wrong one of those two is exactly
   the mistake a loud banner exists to prevent.
3. **Name the handover email** from the seller directory's Manage menu → **Set
   handover email** (`retailers.setPendingOwnerEmail`), any time before handover.
4. **Send the invitation** from the same Manage menu → **Handover email → Send
   invitation** (`retailers.sendHandoverInvite`). The row reads "Handover —
   invite them" in amber until it has gone. The email carries an ordinary
   sign-in link and no token, so it is safe to forward and useless on its own —
   pasting the link by hand still works if you prefer.

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

## Building a batch

Pre-building twenty stores ahead of a vendor list is the same feature run twenty
times, and two things in the form were shaped for running it once.

### The handover email is optional

`createUnclaimedStore` always accepted an absent `pendingOwnerEmail` — *"built,
no email yet"* is a state the design named from the start. The **form** required
it in build mode (Zaki, 2 Oct): *"you are building this store FOR a specific
person, so name them now"*, on the reasoning that "I'll set it later" is a thing
an admin forgets.

A batch breaks that premise. Stores created ahead of the vendor list have no
address yet **by definition**, so the gate blocks the workflow it was meant to
protect — and the way past it is to type a throwaway address, which is **strictly
worse than a blank**:

| | blank | a placeholder address |
|---|---|---|
| Directory row | amber **Handover — invite them** | green **Handover email — set** |
| Act-as banner | "nobody can claim it" | names the wrong person |
| Twenty rows later | the unfinished ones are obvious | they all look finished |

The forgetting risk doesn't disappear with a placeholder, it goes **invisible**.
A blank is the only state the product can shout about, and it already does — the
**Unclaimed** chip, the amber Manage row, the act-as banner — so that is where
the reminding lives, not in a required field. The field says
`(optional)` and its helper line names where a nameless store waits.

### Create & add another

Two buttons, so the destination is chosen **before** the click and neither case
pays for the other:

| | **Create store & start setting up** | **Create & add another** |
|---|---|---|
| After the create | act-as + `/app` | stays on the card |
| The form | — | cleared, except the country |
| Right when | one store you're about to fill in | a batch built up front |

The **country survives** the reset: a batch is almost always one country, and
re-picking it twenty times is the friction the button exists to remove. A running
**Created here · n** receipt sits directly above the buttons, and links to
`/app/admin/sellers?status=unclaimed` rather than growing a second directory on
the billing card — that filter is already where a half-finished handover is
tracked, and one idea gets one control. The receipt is not persisted: it
describes this sitting at this card, and the durable record is the directory.

### One author for "is this address free?"

`findEmailConflict` (`convex/retailers.ts`) answers it, and **both** the admin's
pre-flight hint (`checkEmailHasStore`) and the write that enforces it
(`resolvePendingOwnerEmail`) ask it — including the sentence the admin reads. A
test asserts the hint's `message` is byte-identical to the thrown one, so neither
side can be re-worded alone.

That sharing is the fix for a real divergence: the hint checked `notifyEmail`
**alone**, which an unclaimed store never has, so typing one address into two
build forms showed no warning, left the button enabled, and failed on submit.
Exactly the class of bug the slug hint had before `checkSlugAvailability` took a
required `purpose` — a hint whose rule lives apart from its server drifts from
it, and the admin finds out on submit.

Two conflicts, because they have two different fixes:

- **`waiting`** — another pre-built store already names this address. Both would
  answer `myClaimableStore`, which reads `by_pending_owner_email` with
  `.first()`, so the vendor would silently get whichever the index returned first
  and the other store would be invisible to the claim door.
- **`owns`** — a live store **mails** this address, so that login most likely runs
  it. Best-effort, and the copy says so rather than asserting ownership (see
  [the claim](#the-claim)); the authoritative wall is `claimBlocker`, on the Clerk
  subject at claim time.

`checkEmailHasStore` returns `EmailConflict | null` — the conflict's presence IS
the answer, so there is no `exists` flag beside it to disagree with. Its **name**
now undersells it, but an exported query path is a deployed contract and renaming
it would leave a live bundle calling a function that no longer exists.

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

## The invitation email (z8r3fdmy7n)

`retailers.sendHandoverInvite` (admin only, in the **Handover email** dialog)
emails the address a store is waiting for. **One door for both handover paths**
— a store we pre-built and a store transferred off its previous owner are the
same state by the time this runs, so they get the same email rather than two
that drift apart.

**It carries no token, deliberately.** Claiming is proved by Clerk verifying the
address, never by holding a URL, so the email contains an ordinary `/app`
sign-in link. A forwarded invite gets the next person a sign-in page and nothing
else — the property a magic link would destroy. `handoverEmailCopy.test.ts`
fails on any token-shaped URL.

**It names nothing but the store's name.** The recipient has consented to
nothing yet, so the email must not ship them a catalogue, a buyer's details or a
phone number.

**`handoverInviteSentAt` is the LAST send, not a boolean**, because re-sending
is the fix for the two things that actually go wrong (an address named and never
told; an invite in spam). Both states are surfaced *outside* the dialog, on the
Manage row itself — "Handover — invite them" with an amber icon until it has
gone, "Handover email — set" after — so an unfinished handover is visible
without opening anything.

**Send first, stamp after — and the first cut got this wrong.** It was a
mutation that stamped and scheduled the send, with the provider error swallowed
by a `try/catch`. So a failed send showed the admin a success toast and a row
reading "sent" while nothing arrived — found on 3 Oct by an invite that never
landed. It is now an **action**: validate (and prove admin) through
`handoverInviteContext`, send, then stamp through `stampHandoverInvite`. The
provider's own message reaches the admin, because that message *is* the answer
("domain not verified", "recipient suppressed"), and a stamp now means Resend
accepted it. `prebuiltStore.test.ts` pins both halves — a success writes the
stamp, a 403 throws and leaves none.

The lesson generalises: fire-and-forget is right for the automatic emails, where
a cron must not fail on a bounced notice, and wrong for a button a person is
waiting on.

**The invite button refuses an unsaved edit** rather than sending to the typed
value: the dialog edits the address and sends to the saved one, and "I typed the
new address and pressed Send" is the mistake that layout invites.

## Transferring a store that already HAS an owner

`retailers.transferStoreOwnership` (admin only, Manage → **Transfer ownership**)
covers the case the pre-built path does not: a founder built and **claimed** a
store on their own login while setting a vendor up, and now has to give it away.

**It reuses this whole mechanism rather than inventing a second one.** The store
goes BACK to the unclaimed state — a fresh sentinel `userId` plus
`pendingOwnerEmail` — and the new owner takes it through the ordinary
`claimStore` door. There is no "pending transfer" state, no second protocol, and
every refusal, consent stamp and free-period rule the claim already enforces
applies unchanged. The old owner loses access the instant it runs, because the
owner branch of `requireRetailerAccess` compares against a `userId` no Clerk
subject can equal.

| Travels with the store | Does not |
| --- | --- |
| Products, orders, customers, settings, the team | The owner |
| **The subscription** — plan, period, founding rank | `notifyEmail`, cleared |
| `pendingOwnerEmail`, pointed at the new address | `claimedAt`, re-stamped at claim |
| — | An **open pending invoice**, voided |

**Why `notifyEmail` is cleared.** It is the old owner's address. A store in
handover must not keep mailing buyers' names and addresses to someone who no
longer runs it — nor to the new owner, who has accepted nothing yet (consent is
taken at claim, which is exactly why `createUnclaimedStore` leaves this field
unset too). The claim sets it. The gap is one sign-in long and orders stay
visible in the dashboard and the admin console throughout.

**Why the saved card is detached.** `autoRenew` / `autoRenewSessionId` live on
the SUBSCRIPTION row, which is store-scoped — so a handover would otherwise
leave the previous owner's tokenised card attached to a store they no longer
own, and the next renewal would charge them for somebody else's shop. A charge
nobody authorised, and the one genuine money risk in a transfer.
`detachAutoRenewForRetailer` (extracted from `cancelAutoRenew`, one author) runs
before the patch; the reconcile ordering it carries is load-bearing, which is
why it is a helper and not three field clears at each call site. The period the
old owner already paid for still stands — they paid for this store's service and
the store carries on; the new owner authorises their own method.

**Why an OPEN BILL is voided.** An invoice still `pending` when the store changes
hands cannot be collected through the product, and three of the handover's own
steps guarantee it: `notifyEmail` is cleared, so the invoice mail and all three
dunning mails drop at their `if (!meta.notifyEmail) return`; the card is
detached, so nothing can auto-pay it; and the daily pass skips an unclaimed
store, so it is never chased. It then **re-arms the moment the new owner
claims** — `overduePending` flips the store to `past_due` and sends them a "pay
to resume" demand for a month they did not own, which is the mirror image of the
wiped-paid-period bug below. It also holds the single-pending-invoice slot
(`issueInvoice` refuses a second), so their own first bill could not be issued.

So the bill stops at the handover, the same way every other lifecycle flow that
suspends a store's clock stops it: an admin comp (`setComp`) and the seasonal
hold both void the open plan invoice, through the same `voidPendingInvoice`
helper. **Nothing that was ever collected is forgiven** — a pending invoice is a
*request*, not money, and the row survives as `void` carrying `voidedBy` /
`voidReason`, so a genuine debt is still on the record to chase off-platform.
An admin who wants it paid settles it **before** transferring, which is what the
dialog's panel tells them. `voidPendingInvoiceOnHandover` is the one author, and
its number goes into the transfer's log line.

**Why a PAID subscription survives.** `startFreePeriodOnClaim` converts a claimed
store into a fresh 14-day Pro trial — correct for a pre-built store, catastrophic
for a transferred one, where it would wipe `currentPeriodEnd` / `periodPaidBy`
and hand back 14 free days for money already taken. It now returns early for a
subscription that is `active` **and not comped**. The `!comped` half is
load-bearing: a pre-built store's `internal` comp sits on an `active` row too,
and that one must still convert. "Paying" is *active and nobody is covering it*.

**Two refusals, both at the admin end** rather than at the vendor's sign-in:

- the store has **no owner yet** → set the handover email instead;
- the new address is **already on this store's team** → `claimBlocker` refuses
  anyone holding an active membership, so the handover would dead-end on the
  vendor's screen. Remove them from the team first.

**Known gap, deliberate:** the PREVIOUS owner is not told their store left
them. The new owner is — see [the invitation email](#the-invitation-email-z8r3fdmy7n) — but the
person losing the shop gets nothing. For the white-glove case (a founder handing
over their own build) there is nobody to tell; a genuine vendor-to-vendor sale
should notify both sides, and that is tracked separately rather than
half-built here.

## A store nobody owns has no billing clock

The pre-built design's safety argument was `insertSetupComp`'s own comment —
"nothing bills, nothing locks and nothing emails a store with no owner to read
it" — and that rested entirely on the `internal` comp. `transferStoreOwnership`
broke the assumption: it makes a store unclaimed **without** comping it, so the
daily pass's single `comped` exemption missed it.

Concretely, found in review: transfer on day 20 of a monthly period → the period
ends during the gap → `internalIssueRenewalInvoice` fires → the invoice email and
all three dunning mails drop at `if (!meta.notifyEmail) return` (the handover
cleared it) → the invoice goes overdue → the store flips `past_due` and **locks
itself**. The new owner would claim into a locked shop holding a bill neither
party was ever told about.

**Ownership is the real predicate, so it is now tested directly** rather than
through whatever happens to be comping the store:

- `subscriptions.internalDailyBillingStatus` skips an unclaimed row beside a
  comped one — no renewal, no dunning, no overdue lock;
- `invoices.issueInvoice` refuses one, because the manual path must refuse what
  the machine path skips, exactly as it already does for a comp.

The clock resumes at the claim, with somebody to read it. The period the store
already paid for is untouched throughout — see `startFreePeriodOnClaim`.

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

### The admin billing picker says "waiting for its owner", never "on the house"

An unclaimed store IS comped (the `internal` setup comp), so the issue-invoice
picker labelled it `on the house` and its refusal line read *"End the comp from
Admin · Sellers first"* — telling an admin to tear down the scaffolding instead
of finishing the handover. Exactly the lie the Sponsored pill told before
`tierPill` learned about unclaimed stores. `listRetailersForAdmin` now carries
`unclaimed`, the picker says **"waiting for its owner"**, and the note explains
that the 14-day Pro trial starts at the claim. Nothing about billing changed —
`issueInvoice` always refused these.

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
| the handover email is optional | its `(optional)` label + the helper line naming where a nameless store waits |
| what each create button does next | the consequence line above them, naming both |
| what this sitting has created | the **Created here · n** receipt, linking to the Unclaimed worklist |
| an address is already taken | the server's own sentence under the field — stated **once**, with the button's reason pointing at it rather than paraphrasing it |
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

**A pre-existing bug this feature would have started firing.** The setup
checklist's three progress stamps (`markLinkShared`, `markPickupSetupSeen`,
`markGreetingSetupDone`) take no arguments and resolve the store from the
CALLER's identity via `resolveMyRetailer` — which does not honour act-as, since
act-as is a client session passed per call as an explicit `retailerId`. Fired
from an act-as session they stamp the **admin's own store**, never the seller's,
and the server cannot defend itself: an admin sharing their own store's link is
legitimate.

Two of the five call sites already guarded it by hand, in two different
spellings, with comments assuming the rest did too. **Three did not** — including
the dashboard home's Copy-link button, which is the first thing an admin reaches
for after building a pre-built store (the flow literally tells them to open the
storefront). Nothing had fired on dev, so there was no data to clean up.

All five now go through `useChecklistStamp` (`src/hooks/useChecklistStamp.ts`),
which no-ops while acting-as and **reports that it is inert** (`active: false`)
rather than resolving silently. The first cut returned a bare function, and that
silence re-created the very bug this PR had already fixed in the consent banner:
the greeting row sets `saving` and deliberately never clears it on success,
expecting the stamp to flip `item.done` and unmount the row — inert, that flip
never comes and the button sits on "Saving…" for ever (PR review, 2 Oct). Both
its controls finish the step, so both are now disabled with the reason, which is
honest as well as safe: the greeting is pasted into the SELLER's own WhatsApp
app, from their phone, so it is not a step an admin can finish for them. A gate test fails on any direct
`useMutation(api.retailers.mark*)`, so a sixth call site cannot quietly
reintroduce it — a rule held by remembering is a rule that gets forgotten, and
this one had been forgotten three times out of five.

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
