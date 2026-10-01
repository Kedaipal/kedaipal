# Buyer questions — ask the buyer something at checkout (`z8r3fdkjek`)

A seller adds **up to 3 questions** to a product. The buyer answers them at
checkout; the answers **freeze onto the order line** with the wording they were
asked under, and show everywhere the order is read.

| Seller wants | Question |
|---|---|
| Helinox Community's *Into The Falls*: what each registrant brings | "What are you bringing?" — pick one: *2 Helinox furniture* / *Helinox tent*, required |
| …and, if a tent, which one | "Tent model" — short answer, required, **shown only when** *Helinox tent* is picked |
| A cake seller | "Message on the cake" — short answer, optional |

## Why a primitive, not an event field

Built for HCM's registration, but decided on 30 Sep 2026 (Arif) as a general
primitive: the same shape is "message on the cake", "spice level", "participant
name" for the made-to-order and class sellers on the paying roster. Nothing
else could carry it:

- **Not a third option axis.** `MAX_OPTION_AXES = 2`, HCM's listing is already
  7 × 8 sizes, and an axis multiplies variants — an answer has no price or
  stock of its own.
- **Not free text in the Note.** Tried and rejected: buyers skip optional free
  text, and the seller chases every miss.
- **Not two products.** An event's seat cap is per product; splitting the
  listing splits the 40-seat pool.

The variant-cap entry in `shipped-log.md` (29 Sep) recorded this feature as
"scoped and rejected as too large for the 3 Oct opening"; it was reinstated on
30 Sep.

## Schema (widen only, no migration)

```ts
products.buyerQuestions?: Array<{
  id: string                         // minted when the row is added; answers key on it
  label: string                      // ≤ 80
  type: "choice" | "text"
  options?: string[]                 // choice only, 2..6, each ≤ 40, deduped
  required?: true
  showWhen?: { questionId, option }  // an EARLIER choice question + one of its options
}>
orders.items[].answers?:        Array<{ questionId, label, answer }>  // frozen
orderClaims.lines[].answers?:   Array<{ questionId, label, answer }>  // frozen at send
counterCheckoutSessions.draft.items[].answers?: Array<{ questionId, answer }>
```

`[]` normalises to unset — one spelling for "no questions" (the `event.seats: 0`
posture). The validators live in `convex/lib/buyerQuestions.ts` (the
`paymentMethod.ts` precedent), so every table spells them the same way.

## The module — `convex/lib/buyerQuestions.ts`

Pure apart from `convex/values`; imported by the mutations **and** the seller
form / storefront, so the form can never offer a save the server refuses.

- `sanitizeBuyerQuestions` — caps, trims, case-insensitive option dedupe, id
  minting (a well-formed id is kept, so a "show only when" can point at a row
  that hasn't been saved yet). A **dangling** `showWhen` (trigger deleted, or
  its option renamed away) is cleared silently — that's an ordinary edit, and
  the form clears it live too. A **self**, **later**, or **text** trigger is
  refused — only a hand-built payload reaches those.
- `visibleQuestions` — a conditional question is visible only when its trigger
  is visible AND answered with its option (so a hidden trigger hides its
  dependents).
- `validateAnswers` → `{ answers, missing }`, and `freezeLineAnswers`, the ONE
  call every door makes: unknown id → dropped; hidden conditional answer →
  dropped; blank optional → no row; blank required → refused with the question
  AND the product named; a choice answer outside the options or a text answer
  over 120 characters → refused.

## The doors

| Door | Who answers | Where it's validated |
|---|---|---|
| RSVP form (`orders.create`) | the guest | create |
| Cart checkout (`orders.create`) | the buyer, **once per line** (qty 3 = one set) | create |
| Counter (`counterCheckout.createOrderFromSession`) | the seller, for the walk-in | create |
| Claim link (`orderClaims.sendClaim` → `commit`) | the seller, at the counter before sending | **send** — the claim is a frozen offer, so commit copies the answers verbatim and a question added after sending never retro-blocks a link already in the buyer's hands |
| Booking (`bookings.requestBooking`) | — | a booking listing can't carry questions (refused at `products.create`/`update`, card hidden) — its checkout has no line to hang answers on |

## Frozen labels

An answer is stored as `{ questionId, label, answer }`, like `variantLabel`.
Rewording, reordering or deleting a question — allowed at any time, even with
live orders — never rewrites what a past buyer answered (pinned by
`convex/buyerQuestions.test.ts`).

## Surfaces

- **Seller product form** — the *Ask the buyer* card, after *Event* and before
  *Order rules* (it's what the buyer is asked, not a limit on how they order).
  Empty state explains the feature; "N of 3" beside *Add question*, disabled at
  the cap with the reason; per-row *Pick one* / *Short answer*, option chips,
  *Required*, and *Show only when* (listing only earlier pick-one questions).
- **Wizard** — the same editor in the Review step's *More options* drawer, on
  every route (the drawer teaser names it so it's discoverable closed).
- **Buyer** — one shared control, `src/components/order/buyer-questions-fields.tsx`:
  - RSVP form: section *A few questions* between *Your seats* and the note; the
    CTA's blocked reason names the question (`Answer “…”`); the receipt echoes
    the answers.
  - Cart checkout: section *A few questions* after *Who's ordering?*, one block
    per line that asks something, read from the LIVE catalog (a question added
    after the buyer filled the basket is still asked; a deleted one isn't
    sent). Answers persist with the cart (`CartItem.answers`).
  - Counter: the line's edit sheet opens by itself when a line with a required
    question is added; the row shows the answers or "Needs an answer: …"; the
    primary action names the line while one is missing.
- **Order page + `/track`** — `Label: answer` rows under the item
  (`OrderItemLine`, plain text). Each row flows as **inline text** that wraps
  like a sentence. It was a flex row with a `shrink-0` label once, and a long
  question squeezed its answer into a one-letter-wide column. The prefix comes
  from `answerLabelPrefix`, so a label that is already a question keeps its own
  `?` ("Vehicle plate number? JJ7777J", never "number?: JJ7777J"). The CSV,
  claim ticket, counter and booking-request card use the same helper.
- **Claim ticket** — the seller's answers, read-only.
- **CSV + orders table** — an *Answers* column in the *Items* group, after
  *Note*: `Label: answer; Label: answer` per line. When more than one line
  answered, each is prefixed with its product and lines are joined with `" | "`
  (the pickup-notes precedent — `"; "` already separates answers within a
  line, so reusing it would make line boundaries ambiguous).
- **RSVPs panel** — each pick-one question tallied by **seats** from live
  orders ("Helinox tent 23 · 2 Helinox furniture 17"), current options first
  (zeros shown), then any option a guest picked that has since been renamed.
- **WhatsApp** — nothing new: the answers live on `/track`, which the
  confirmation already links.

## Tier

All tiers. Three questions is the lever, not the plan.

## Not built (deliberate)

- Per-guest answers (one set per line, whatever the quantity).
- More than 3 questions; multi-select answers; number/date types.
- Questions on booking listings.
- Two lines of the same variant with different answers in one cart (lines are
  keyed by variant).

## Tests

- `convex/lib/buyerQuestions.test.ts` — sanitizer, visibility, validation, CSV
  formatting.
- `convex/buyerQuestions.test.ts` — save/clear, booking refusal, public payload,
  every door (required refused, hidden/unknown dropped, frozen labels, relabel
  after an order), CSV column, RSVP tally (seat-weighted, cancelled excluded,
  renamed option kept), counter draft round-trip, claim freeze → commit.
- UI: `buyer-questions-card.test.ts`, `event-rsvp-checkout-form.test.tsx`,
  `checkout-form.test.tsx`, `order-item-line.test.tsx`,
  `event-rsvp-panel.test.tsx`, `product-create-payload.test.ts`.
